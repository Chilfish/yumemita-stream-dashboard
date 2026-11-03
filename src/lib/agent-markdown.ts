import type { StreamDatapack } from '@/types/datapack'
import type { StreamSummary } from '@/types/dataset'
import { SITE_NAME } from '@/lib/seo'

export interface AgentMarkdownInput {
  datasetId: string
  datasetLabel: string
  summary: StreamSummary
  pack: StreamDatapack | null
  transcript: string | null
  hasTranscript: boolean
  origin: string
  includeTranscript: boolean
  full: boolean
}

const numberFormat = new Intl.NumberFormat('zh-CN')

function num(value: number | null | undefined): string {
  return value == null ? '—' : numberFormat.format(value)
}

function cell(value: string | number | null | undefined): string {
  if (value == null) return '—'
  return String(value).replace(/\|/g, '\\|').replace(/\n/g, ' ')
}

function duration(seconds: number | null | undefined): string {
  if (seconds == null || seconds <= 0) return '—'
  const total = Math.round(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const rest = total % 60
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
    : `${minutes}:${String(rest).padStart(2, '0')}`
}

function jstDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(date)
}

function money(amount: number | null | undefined): string {
  if (amount == null) return '—'
  return numberFormat.format(Math.round(amount))
}

export function renderStreamMarkdown(input: AgentMarkdownInput): string {
  const {
    summary,
    pack,
    datasetId,
    datasetLabel,
    transcript,
    hasTranscript,
    origin,
    includeTranscript,
    full,
  } = input
  const pageUrl = `${origin}/${datasetId}/stream/${summary.videoId}`
  const markdownUrl = `${pageUrl}.md`
  const image = summary.thumbnail ? `${origin}/${datasetId}/${summary.thumbnail}` : null
  const description = `${datasetLabel} ${summary.date} 的直播数据总览：时长 ${duration(summary.durationSec)}，峰值同接 ${num(summary.maxConcurrent)}。`

  const frontmatter = [
    '---',
    `title: ${JSON.stringify(summary.title)}`,
    `description: ${JSON.stringify(description)}`,
    ...(image ? [`image: ${JSON.stringify(image)}`] : []),
    `canonical: ${JSON.stringify(pageUrl)}`,
    `dataset: ${datasetId}`,
    `member: ${JSON.stringify(datasetLabel)}`,
    `video_id: ${summary.videoId}`,
    `date: ${summary.date || jstDate(summary.startedAt)}`,
    `duration: ${JSON.stringify(duration(summary.durationSec))}`,
    `youtube: ${JSON.stringify(summary.url)}`,
    `generated_at: ${JSON.stringify(summary.generatedAt)}`,
    `markdown_url: ${JSON.stringify(markdownUrl)}`,
    '---',
    '',
  ].join('\n')

  const lines: string[] = [frontmatter]
  lines.push(`# ${summary.title}`, '')
  lines.push(
    `> ${datasetLabel} · ${summary.date || jstDate(summary.startedAt)} · ${duration(summary.durationSec)} · ${summary.availability === 'subscriber_only' ? '会员限定' : '公开'}`,
    '',
  )

  lines.push('## 概览', '', '| 指标 | 值 |', '| --- | --- |')
  lines.push(`| 平均同接 | ${num(summary.avgConcurrent)} |`)
  lines.push(`| 峰值同接 | ${num(summary.maxConcurrent)}${summary.maxConcurrentAt ? `（${summary.maxConcurrentAt}）` : ''} |`)
  lines.push(`| 播放（VSTATS） | ${num(summary.vstatsViews)} |`)
  lines.push(`| 点赞（VSTATS） | ${num(summary.vstatsLikes)} |`)
  lines.push(`| 弹幕 | ${num(summary.chatTotal)} |`)
  lines.push(`| SC | ${num(summary.superchats)} 笔 |`)
  lines.push(`| 贴纸 | ${num(summary.stickers)} |`)
  lines.push(`| 会员里程碑 | ${num(summary.memberships)} |`)
  lines.push(`| 评论（抓取） | ${num(summary.commentsCaptured)} |`, '')

  const tenMinute = pack?.chat.density.perTenMinute ?? []
  if (tenMinute.length > 0) {
    lines.push('## 时间轴', '', '| 区间 | 弹幕 | SC |', '| --- | ---: | ---: |')
    const offsetLabel = (minutes: number) => {
      const hours = Math.floor(minutes / 60)
      return `${String(hours).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
    }
    for (const bucket of tenMinute) {
      lines.push(`| ${offsetLabel(bucket.offsetMin)}–${offsetLabel(bucket.offsetMin + 10)} | ${num(bucket.messages)} | ${num(bucket.superchats)} |`)
    }
    const peak = pack?.chat.density.peakMinute
    if (peak) {
      lines.push('', `峰值：第 ${peak.offsetMin} 分钟（${peak.at ?? '—'}），${num(peak.count)} 条。`)
    }
    lines.push('')
  }

  lines.push('## 弹幕与互动', '')
  lines.push(`- 弹幕总量：${num(summary.chatTotal)}`)
  lines.push(`- 纯表情：${num(summary.pureEmojiOnly)}`)
  lines.push(`- 发言人数：${num(summary.uniqueAuthors)}`)
  lines.push(`- 每千同接弹幕：${summary.chatPer1000AvgViewers == null ? '—' : summary.chatPer1000AvgViewers.toFixed(1)}`, '')

  const topWords = pack?.chat.topWords.slice(0, full ? undefined : 40) ?? []
  if (topWords.length > 0) {
    lines.push('### 高频词', '', '| 词 | 次数 |', '| --- | ---: |')
    for (const word of topWords) lines.push(`| ${cell(word.word)} | ${num(word.count)} |`)
    lines.push('')
  }

  const topAuthors = pack?.chat.topAuthors.slice(0, full ? undefined : 20) ?? []
  if (topAuthors.length > 0) {
    lines.push('### 发言者 Top 20', '', '| 发言者 | 条数 | SC | 贴纸 | 会员 |', '| --- | ---: | ---: | ---: | ---: |')
    for (const author of topAuthors) {
      lines.push(`| ${cell(author.author)} | ${num(author.messages)} | ${num(author.superchats)} | ${num(author.stickers)} | ${num(author.memberships)} |`)
    }
    lines.push('')
  }

  const paid = pack?.chat.paid
  if (paid) {
    const currencies = Object.entries(paid.scTotalsByCurrency)
    lines.push('## 付费', '')
    if (currencies.length > 0) {
      lines.push('### 币种合计', '', '| 币种 | 笔数 | 金额 |', '| --- | ---: | ---: |')
      for (const [currency, total] of currencies) {
        lines.push(`| ${cell(currency)} | ${num(total.count)} | ${money(total.amount)} |`)
      }
      lines.push('')
    }

    const sc = full ? paid.superchats : paid.superchats.slice(0, 20)
    if (sc.length > 0) {
      lines.push('### 最近 SC', '', '| 时刻 | 金额 | 发言者 | 留言 |', '| --- | --- | --- | --- |')
      for (const item of sc) {
        lines.push(`| ${cell(item.at)} | ${cell(item.amountText)} | ${cell(item.author)} | ${cell(item.message)} |`)
      }
      lines.push('')
    }
  }

  const commentItems = pack?.comments?.items.slice(0, full ? undefined : 20) ?? []
  if (commentItems.length > 0) {
    lines.push('## 评论', '', '| 赞 | 作者 | 内容 |', '| ---: | --- | --- |')
    for (const item of commentItems) {
      lines.push(`| ${num(item.likes)} | ${cell(item.author)} | ${cell(item.text)} |`)
    }
    lines.push('')
  }

  lines.push('## 逐字稿', '')
  if (!includeTranscript) {
    lines.push('已按 `?transcript=0` 省略。', '')
  }
  else if (transcript) {
    lines.push(transcript.trim(), '')
  }
  else if (hasTranscript) {
    lines.push('逐字稿暂时不可用。', '')
  }
  else {
    lines.push('这场直播还没有逐字稿。', '')
  }

  lines.push('## 数据说明', '')
  lines.push('- 时间一律 JST（UTC+9）。')
  lines.push('- 同接来自 VSTATS；`vstats` 缺失时相关指标显示「—」。')
  lines.push('- SC / 贴纸金额按币种分列，不做汇率换算。')
  lines.push('- 评论是抓取上限内的条数，不等于视频总评论数。', '')

  lines.push('## 链接', '')
  lines.push(`- HTML 页面：${pageUrl}`)
  lines.push(`- YouTube：${summary.url}`)
  lines.push(`- 数据台：${origin}/`)
  lines.push('')
  lines.push(`<sub>${SITE_NAME} · ${markdownUrl}</sub>`)
  lines.push('')

  return lines.join('\n')
}
