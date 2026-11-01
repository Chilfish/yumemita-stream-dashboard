#!/usr/bin/env bun
/**
 * 由机场订阅生成 CI 用的 mihomo 配置：只保留指定地区的节点，开本地 7890 混合端口与 9099 控制端口。
 *
 *   bun scripts/mihomo-config.ts <subscription.yaml> <config.yaml>
 *   MIHOMO_REGION=香港 bun scripts/mihomo-config.ts <订阅> <config>
 *
 * 生成的 `<config.yaml>.proxy-node` 是本次选中的节点名，工作流启动 mihomo 后用它切到 PICK。
 * 订阅每次运行都重新拉：节点域名/节点名会变，写死在 secret 里迟早失效。
 *
 * 默认日本优先、香港兜底：YouTube 认 cookie 的签发地区，cookie 在哪个地区签的，
 * 出口就得在哪个地区，跨区（日本 cookie + 香港出口）会直接撞 bot 检查。
 */
import { readFile, writeFile } from 'node:fs/promises'

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

/** MIHOMO_REGION=日本,香港 覆盖默认的地区顺序（逗号分隔，先写的先选）。 */
function regionMatchers(): RegExp[] {
  const wanted = (process.env.MIHOMO_REGION ?? '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
  const labels = wanted.length > 0 ? wanted : DEFAULT_REGIONS
  return labels.map((label) => {
    const match = REGIONS[label]
    if (!match)
      throw new Error(`MIHOMO_REGION 里有未知地区「${label}」，可用：${Object.keys(REGIONS).join(' / ')}`)
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
  if (!picked)
    throw new Error('订阅里没有可用节点')
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

const [inputPath, outputPath] = process.argv.slice(2)
if (!inputPath || !outputPath) {
  console.error('用法：bun scripts/mihomo-config.ts <subscription.yaml> <config.yaml>')
  process.exit(1)
}

const source = Bun.YAML.parse(await readFile(inputPath, 'utf8')) as ClashConfig | null
const regionOrder = regionMatchers()
const proxies = nodesByRegion(source?.proxies ?? [], regionOrder)
if (!proxies.length)
  throw new Error('订阅里没有可用节点（检查 MIHOMO_REGION 与订阅的地区写法）')

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

// JSON 是合法的 YAML，缩进输出比 Bun.YAML.stringify 的 flow 风格更便于排查。
await writeFile(outputPath, JSON.stringify(config, null, 2), 'utf8')
await writeFile(`${outputPath}.proxy-node`, proxyNode, 'utf8')
const regions = (process.env.MIHOMO_REGION ?? DEFAULT_REGIONS.join(','))
console.log(`mihomo config ready: ${proxies.length} node(s) [${regions}], default ${proxyNode}`)
