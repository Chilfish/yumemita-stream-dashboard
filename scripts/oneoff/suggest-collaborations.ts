#!/usr/bin/env bun
/**
 * 联动场次候选清单。
 *
 * pack 与 YouTube 都不提供结构化的共演信息，参与者只能人工确认后登记。
 * 这里按本地 manifest 的标题扫成员别名与组合名 tag，列出候选，供人工剔除假阳性后
 * 写入 `content/collaborations.json`。只读：不改数据、不连数据库。
 *
 * 用法：
 *   bun scripts/suggest-collaborations.ts                       # 控制台表格
 *   bun scripts/suggest-collaborations.ts --markdown > temp/x.md # Markdown 表格
 *   bun scripts/suggest-collaborations.ts --json                # 机器可读
 *   bun scripts/suggest-collaborations.ts --dataset ritsu       # 只看一位成员
 *   bun scripts/suggest-collaborations.ts --include-registered  # 含已登记场次
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import process from 'node:process'
import { loadCollaborations, suggestParticipants } from './lib/collaborations.ts'

interface ManifestStream {
  videoId: string
  title: string | null
  date?: string
  startedAt?: string | null
  availability?: string | null
}

interface Manifest {
  streams?: ManifestStream[]
}

interface DataSource {
  id: string
  label: string
  manifest?: string
  datapackDir?: string
}

interface CandidateRow {
  videoId: string
  ownerId: string
  ownerLabel: string
  date: string
  title: string
  participants: string[]
  registered: boolean
}

interface Args {
  dataset?: string
  json: boolean
  markdown: boolean
  includeRegistered: boolean
  help: boolean
}

const USAGE = `用法：bun scripts/suggest-collaborations.ts [选项]

按本地 manifest 标题扫成员别名，输出联动场候选；只读，不写登记文件。

选项：
  --dataset <id>         只扫指定成员
  --include-registered   连已登记的场次一起列出
  --json                 输出 JSON
  --markdown             输出 Markdown 表格
  -h, --help             显示本帮助`

function parseArgs(argv: string[]): Args {
  const args: Args = { json: false, markdown: false, includeRegistered: false, help: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--dataset') args.dataset = argv[++index]
    else if (arg === '--include-registered') args.includeRegistered = true
    else if (arg === '--json') args.json = true
    else if (arg === '--markdown') args.markdown = true
    else if (arg === '--help' || arg === '-h') args.help = true
    else console.warn(`[collab] 忽略未知参数：${arg}`)
  }
  return args
}

function readManifestStreams(source: DataSource): ManifestStream[] {
  if (source.manifest) {
    const file = resolve(source.manifest)
    if (existsSync(file)) {
      const manifest = JSON.parse(readFileSync(file, 'utf8')) as Manifest
      if (Array.isArray(manifest.streams)) return manifest.streams
    }
  }

  const dir = resolve(source.datapackDir ?? resolve('data', source.id))
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(name => name.endsWith('.datapack.json'))
    .map(name => {
      const pack = JSON.parse(readFileSync(resolve(dir, name), 'utf8')) as {
        video?: { id?: string, title?: string | null, startedAt?: string | null }
      }
      return {
        videoId: pack.video?.id ?? basename(name, '.datapack.json'),
        title: pack.video?.title ?? null,
        startedAt: pack.video?.startedAt ?? null,
      }
    })
}

function formatDate(stream: ManifestStream): string {
  const raw = stream.startedAt ?? stream.date ?? ''
  return raw.slice(0, 10)
}

function renderText(rows: CandidateRow[], knownLabels: Map<string, string>): string {
  const lines: string[] = []
  for (const row of rows) {
    const names = row.participants.map(id => knownLabels.get(id) ?? id).join(' × ')
    lines.push(`${row.date}  ${row.videoId}  ${names}${row.registered ? '  [已登记]' : ''}`)
    lines.push(`  ${row.ownerLabel}：${row.title}`)
  }
  return lines.join('\n')
}

function renderMarkdown(rows: CandidateRow[], knownLabels: Map<string, string>): string {
  const lines = ['| 日期 | videoId | 候选参与者 | 标题 |', '| --- | --- | --- | --- |']
  for (const row of rows) {
    const names = row.participants.map(id => knownLabels.get(id) ?? id).join(' / ')
    const title = row.title.replace(/\|/g, '\\|')
    const flag = row.registered ? '（已登记）' : ''
    lines.push(`| ${row.date} | \`${row.videoId}\` | ${names}${flag} | ${title} |`)
  }
  return lines.join('\n')
}

function main(): void {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(USAGE)
    return
  }

  const { datasets } = JSON.parse(readFileSync('data-sources.json', 'utf8')) as { datasets: DataSource[] }
  const selected = datasets.filter(item => !args.dataset || item.id === args.dataset)
  if (selected.length === 0) throw new Error(`找不到 dataset: ${args.dataset}`)

  const knownIds = datasets.map(item => item.id)
  const knownLabels = new Map(datasets.map(item => [item.id, item.label]))
  const registered = loadCollaborations({ knownDatasetIds: knownIds }).byVideo

  const rows: CandidateRow[] = []
  let scanned = 0
  for (const source of selected) {
    const streams = readManifestStreams(source)
    scanned += streams.length
    for (const stream of streams) {
      if (!stream.videoId || !stream.title) continue
      const participants = suggestParticipants(stream.title, source.id, knownIds)
      if (participants.length === 0) continue
      const isRegistered = registered.has(stream.videoId)
      if (isRegistered && !args.includeRegistered) continue
      rows.push({
        videoId: stream.videoId,
        ownerId: source.id,
        ownerLabel: source.label,
        date: formatDate(stream),
        title: stream.title,
        participants,
        registered: isRegistered,
      })
    }
  }

  rows.sort((a, b) => a.ownerId.localeCompare(b.ownerId) || a.date.localeCompare(b.date))

  if (args.json) {
    console.log(JSON.stringify({ scanned, registered: registered.size, rows }, null, 2))
    return
  }

  const pairCounts = new Map<string, number>()
  for (const row of rows) {
    for (const participant of row.participants) {
      const key = [row.ownerId, participant].sort().join('-')
      pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1)
    }
  }

  console.error(`[collab] 扫描 ${selected.length} 位成员 / ${scanned} 场，命中 ${rows.length} 场候选（已登记 ${registered.size} 场）`)
  for (const [key, count] of [...pairCounts].sort((a, b) => b[1] - a[1])) {
    const [left, right] = key.split('-')
    console.error(`[collab] ${knownLabels.get(left) ?? left} × ${knownLabels.get(right) ?? right}：${count} 场`)
  }

  if (args.markdown) {
    console.log(renderMarkdown(rows, knownLabels))
    return
  }

  let currentOwner = ''
  for (const row of rows) {
    if (row.ownerId !== currentOwner) {
      currentOwner = row.ownerId
      console.log(`\n== ${row.ownerLabel}（${row.ownerId}）==`)
    }
    console.log(renderText([row], knownLabels))
  }
}

main()
