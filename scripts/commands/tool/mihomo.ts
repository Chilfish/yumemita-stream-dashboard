/**
 * 由机场订阅生成 CI 用的 mihomo 配置：只保留指定地区的节点，开本地 7890 混合端口与 9099 控制端口。
 *
 *   bun run ymmt tool mihomo <subscription.yaml> <config.yaml>
 *   MIHOMO_REGION=香港 bun run ymmt tool mihomo <订阅> <config>
 *
 * 生成的 `<config.yaml>.proxy-node` 是本次选中的节点名，工作流启动 mihomo 后用它切到 PICK。
 * 订阅每次运行都重新拉：节点域名/节点名会变，写死在 secret 里迟早失效。
 *
 * 默认日本优先、香港兜底：YouTube 认 cookie 的签发地区，cookie 在哪个地区签的，
 * 出口就得在哪个地区，跨区（日本 cookie + 香港出口）会直接撞 bot 检查。
 */
import { readFile, writeFile } from 'node:fs/promises'
import { Option } from 'commander'
import type { CommandSpec } from '@scripts/lib/cli/runtime.ts'
import { CliError, UsageError } from '@scripts/lib/cli/exit.ts'
import { createLogger, type Logger } from '@scripts/lib/cli/logger.ts'

interface ClashProxy {
  name: string
  server?: string
  type?: string
}

interface ClashConfig {
  proxies?: ClashProxy[]
  dns?: {
    'nameserver-policy'?: Record<string, string | string[]>
    [key: string]: unknown
  }
  ipv6?: boolean
  udp?: boolean
}

/** 订阅里这几条线路实测最稳，优先用；都没有再按地区/协议挑。 */
const PREFERRED_NODES = ['日本JP-A', '日本JP-HY2', '香港HK-A', '香港HKT-A', '香港HK-HY2']
/** 地区别名：订阅里的节点名不统一，同一个地区可能有「日本 / JP / 东京」几种写法。 */
const REGIONS: Record<string, RegExp> = {
  日本: /日本|JP|东京|大阪/i,
  香港: /香港|HK/i,
  新加坡: /新加坡|SG/i,
  台湾: /台湾|TW/i,
  美国: /美国|US/i,
}
/** 默认按顺序取第一个有节点的地区。 */
const DEFAULT_REGIONS = ['日本', '香港']
/** 订阅里混着「剩余流量 / 套餐到期」这类信息节点，不是真线路。 */
const PSEUDO_NODE = /剩余流量|套餐到期/

export interface MihomoOptions {
  /** 位置参数 `订阅`：机场订阅 YAML。 */
  subscription?: string
  /** 位置参数 `config`：输出的 mihomo 配置。 */
  config?: string
  /** 覆盖 `MIHOMO_REGION`（逗号分隔的地区顺序）。 */
  region?: string
  /** 全局 --dry-run：解析订阅、选节点，但不写 <config> 与 <config>.proxy-node。 */
  dryRun?: boolean
  log?: Logger
}

export interface MihomoData {
  input: string
  output: string
  region: string
  regions: string
  nodes: number
  proxyNode: string
  written: boolean
}

export interface MihomoResult {
  exitCode: number
  data: MihomoData
}

/** MIHOMO_REGION=日本,香港 覆盖默认的地区顺序（逗号分隔，先写的先选）。 */
function regionMatchers(raw: string | undefined): RegExp[] {
  const wanted = (raw ?? '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
  const labels = wanted.length > 0 ? wanted : DEFAULT_REGIONS
  return labels.map((label) => {
    const match = REGIONS[label]
    if (!match) {
      throw new CliError(`MIHOMO_REGION 里有未知地区「${label}」`, {
        code: 'UNKNOWN_REGION',
        hint: `可用：${Object.keys(REGIONS).join(' / ')}`,
        context: { region: label, available: Object.keys(REGIONS) },
      })
    }
    return match
  })
}

/** 按地区顺序取节点，先出现的地区优先；同一地区内保持订阅顺序。 */
function nodesByRegion(nodes: ClashProxy[], matchers: RegExp[]): ClashProxy[] {
  const usable = nodes.filter(node => !PSEUDO_NODE.test(node.name))
  const picked: ClashProxy[] = []
  const seen = new Set<string>()
  for (const match of matchers) {
    for (const node of usable) {
      if (!match.test(node.name) || seen.has(node.name))
        continue
      seen.add(node.name)
      picked.push(node)
    }
  }
  return picked
}

function pickNode(candidates: ClashProxy[]): string {
  const preferred = PREFERRED_NODES.find(name => candidates.some(node => node.name === name))
  if (preferred)
    return preferred

  const fast = candidates.find(node => node.type === 'anytls' || node.type === 'hysteria2')
  const picked = fast ?? candidates[0]
  if (!picked) {
    throw new CliError('订阅里没有可用节点', {
      code: 'NO_USABLE_NODE',
      hint: '检查 MIHOMO_REGION 与订阅的地区写法，或换一份订阅',
    })
  }
  return picked.name
}

/**
 * 订阅里的 nameserver-policy 只覆盖部分节点域名；节点域名换掉后，
 * runner 用默认 DNS 可能解析不到。把本次选中的节点域名补进同一组 DoH。
 */
function extendNameserverPolicy(dns: ClashConfig['dns'], servers: string[]): void {
  const policy = dns?.['nameserver-policy']
  if (!policy)
    return

  const doh = Object.values(policy).flat()
  if (!doh.length)
    return

  const covered = new Set(Object.keys(policy).flatMap(key => key.split(',')))
  const missing = [...new Set(servers)].filter(server => server && !covered.has(server))
  if (missing.length)
    policy[missing.join(',')] = doh
}

/**
 * 业务主体：读订阅 → 按地区挑节点 → 补 DNS 覆盖 → 写 mihomo 配置与 `.proxy-node`。
 *
 * `dryRun` 为真时只解析并报告选中的节点，不写文件。
 */
export async function runMihomoConfig(options: MihomoOptions): Promise<MihomoResult> {
  const log = options.log ?? createLogger({ name: 'tool.mihomo' })
  const inputPath = options.subscription?.trim()
  const outputPath = options.config?.trim()
  if (!inputPath || !outputPath) {
    throw new UsageError('需要两个位置参数：<订阅> <config>', {
      hint: 'bun run ymmt tool mihomo subscription.yaml config.yaml',
      context: { subscription: inputPath ?? null, config: outputPath ?? null },
    })
  }

  const region = options.region ?? process.env.MIHOMO_REGION ?? DEFAULT_REGIONS.join(',')
  const source = Bun.YAML.parse(await readFile(inputPath, 'utf8')) as ClashConfig | null
  const regionOrder = regionMatchers(region)
  const proxies = nodesByRegion(source?.proxies ?? [], regionOrder)
  if (!proxies.length) {
    throw new CliError('订阅里没有可用节点（检查 MIHOMO_REGION 与订阅的地区写法）', {
      code: 'NO_USABLE_NODE',
      hint: `MIHOMO_REGION=${region} bun run ymmt tool mihomo ${inputPath} ${outputPath}`,
      context: { region },
    })
  }

  const proxyNode = pickNode(proxies)
  extendNameserverPolicy(source?.dns, proxies.map(node => node.server ?? ''))

  const config = {
    'mixed-port': 7890,
    'allow-lan': false,
    'mode': 'rule',
    'log-level': 'info',
    'unified-delay': true,
    'external-controller': '127.0.0.1:9099',
    'ipv6': source?.ipv6 ?? true,
    'udp': source?.udp ?? true,
    'dns': source?.dns,
    'proxies': proxies,
    'proxy-groups': [{ name: 'PICK', type: 'select', proxies: proxies.map(node => node.name) }],
    'rules': ['MATCH,PICK'],
  }

  const written = !options.dryRun
  if (written) {
    // JSON 是合法的 YAML，缩进输出比 Bun.YAML.stringify 的 flow 风格更便于排查。
    await writeFile(outputPath, JSON.stringify(config, null, 2), 'utf8')
    await writeFile(`${outputPath}.proxy-node`, proxyNode, 'utf8')
  }

  const regions = region
  log.info(
    `${written ? 'mihomo config ready' : 'dry-run：将写入 mihomo config'}`
    + `: ${proxies.length} node(s) [${regions}], default ${proxyNode}`,
  )

  return {
    exitCode: 0,
    data: {
      input: inputPath,
      output: outputPath,
      region,
      regions,
      nodes: proxies.length,
      proxyNode,
      written,
    },
  }
}

export const toolMihomoSpec: CommandSpec = {
  id: 'tool.mihomo',
  description: '由机场订阅生成 CI 用的 mihomo 配置（只留指定地区节点）',
  details: [
    '生成 `<config>.proxy-node`（本次选中的节点名），工作流启动 mihomo 后用它切到 PICK。',
    '订阅每次运行都重新拉：节点域名 / 节点名会变，写死在 secret 里迟早失效。',
    '默认日本优先、香港兜底（`MIHOMO_REGION=日本,香港` 覆盖；先写的地区先选）。',
    'YouTube 认 cookie 的签发地区，跨区出口（日本 cookie + 香港出口）会直接撞 bot 检查。',
    '全局 `--dry-run` 只解析订阅并报告选中的节点，不写 <config> 与 <config>.proxy-node。',
  ].join('\n'),
  examples: [
    'bun run ymmt tool mihomo subscription.yaml config.yaml',
    'MIHOMO_REGION=香港 bun run ymmt tool mihomo subscription.yaml config.yaml',
    'bun run ymmt tool mihomo subscription.yaml config.yaml --json',
  ],
  options: [new Option('--region <列表>', '覆盖 MIHOMO_REGION，逗号分隔的地区顺序，如 日本,香港')],
  arguments: [
    { name: '订阅', description: '机场订阅 YAML 路径（每次运行重新拉）' },
    { name: 'config', description: '输出的 mihomo 配置路径；会同时写 <config>.proxy-node' },
  ],
  async run(ctx) {
    const region = ctx.options.region
    const result = await runMihomoConfig({
      subscription: ctx.args[0],
      config: ctx.args[1],
      region: typeof region === 'string' ? region : undefined,
      dryRun: ctx.dryRun,
      log: ctx.log,
    })
    return { exitCode: result.exitCode, data: result.data }
  },
}
