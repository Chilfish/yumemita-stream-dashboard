/**
 * 归档侧逐字稿的路径发现与归属推断。
 *
 * 归档目录有两种形状：
 * - 成员目录：`<成员>/配信/*.md`，顶层还有档案与专题文档；
 * - 团体目录：`団体配信/*.md`，顶层就是待导入稿件。
 *
 * 这里只做纯文件系统判断；团体场次的 owner 要查数据库，放在命令里。
 */
import { existsSync, readdirSync, statSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'

/** 成员目录里真正存放逐字稿的子目录。 */
export const TRANSCRIPT_STREAM_DIR = '配信'

/** 索引 / 草稿 / 说明文件：`_`、`.` 开头，以及 `00_` / `01_` 这类编号索引。 */
export function isIgnoredTranscriptName(name: string): boolean {
  return name.startsWith('_') || name.startsWith('.') || /^\d{2}[_-]/.test(name)
}

function markdownFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.md') && !isIgnoredTranscriptName(entry.name))
    .map(entry => join(dir, entry.name))
    .sort((left, right) => left.localeCompare(right))
}

/**
 * 找出一个路径下要导入的 Markdown：
 *
 * - 传单个文件 → 就它；
 * - 目录里有 `配信/` → 只取 `配信/*.md`（成员目录顶层是档案与专题，不能全导）；
 * - 目录顶层有 `*.md` → 取这些（如 `団体配信/`）；
 * - 否则递归子目录，跳过 `raw/` 与以 `_` / `.` / `00_` 开头的项（如成员根目录）。
 */
export function collectTranscriptSources(inputPath: string): string[] {
  const absolute = resolve(inputPath)
  if (!existsSync(absolute)) return []
  if (statSync(absolute).isFile()) return [absolute]

  const entries = readdirSync(absolute, { withFileTypes: true })
  if (entries.some(entry => entry.isDirectory() && entry.name === TRANSCRIPT_STREAM_DIR))
    return markdownFiles(join(absolute, TRANSCRIPT_STREAM_DIR))

  const files = markdownFiles(absolute)
  if (files.length > 0) return files

  const collected: string[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (entry.name === 'raw' || isIgnoredTranscriptName(entry.name)) continue
    collected.push(...collectTranscriptSources(join(absolute, entry.name)))
  }
  return collected
}

/** 成员名 → dataset id。同时接受 id 本身，方便目录直接叫 `nonoka`。 */
export function datasetLabelIndex(datasets: { id: string, label?: string }[]): Map<string, string> {
  const index = new Map<string, string>()
  for (const dataset of datasets) {
    index.set(dataset.id, dataset.id)
    const label = dataset.label?.trim()
    if (label) index.set(label, dataset.id)
  }
  return index
}

/** 从文件所在目录往上找成员目录；找不到返回 null（团体配信交给数据库）。 */
export function datasetFromPath(filePath: string, index: Map<string, string>): string | null {
  let dir = dirname(resolve(filePath))
  for (let depth = 0; depth < 8; depth += 1) {
    const match = index.get(basename(dir))
    if (match) return match
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}
