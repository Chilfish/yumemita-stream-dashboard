/**
 * `/llms.txt` 的内容生成。
 *
 * 结构按 llmstxt.org v2 提案（2026-08-10）：H1 → 摘要 blockquote → 无标题的说明段
 * → 若干 H2 文件列表 → 可跳过的 `## Optional`。条目一律写成 `- [name](url): notes`，
 * 正文只放在第一个 H2 之前，H2 段里全部是链接——解析器把 H2 段里的非链接条目视为失效。
 */

export interface LlmsMemberInput {
  id: string
  label: string
  /** 含联动场；与场次列表、成员页同一口径。 */
  streamCount: number
}

export interface LlmsStreamInput {
  datasetId: string
  videoId: string
  title: string
  /** JST `YYYY-MM-DD`。 */
  date: string
  /** `subscriber_only` 的场次不公开明细，不进「最近场次」。 */
  availability: string | null
}

export interface LlmsTxtInput {
  /** 站点根地址，无尾斜杠。 */
  origin: string
  members: LlmsMemberInput[]
  /** 全部场次的标题级字段，按成员分组后各取最新几条。 */
  streams: LlmsStreamInput[]
}

const MAX_TITLE_CHARS = 48
const PER_MEMBER = 4

/** 标题里的方括号会让 `- [a](b)` 提前结束，换成全角。 */
function linkText(value: string): string {
  const chars = Array.from(
    value
      .replace(/[[\]]/g, char => (char === '[' ? '［' : '］'))
      .replace(/\s+/g, ' ')
      .trim(),
  )
  if (chars.length <= MAX_TITLE_CHARS) return chars.join('')
  return `${chars.slice(0, MAX_TITLE_CHARS - 1).join('')}…`
}

/** 条目一律 `- [name](url): notes`，缺冒号会被解析器当作没写 notes。 */
function item(url: string, text: string, notes: string): string {
  return `- [${text}](${url}): ${notes}`
}

function recentByMember(streams: LlmsStreamInput[]): Map<string, LlmsStreamInput[]> {
  const grouped = new Map<string, LlmsStreamInput[]>()
  for (const stream of streams) {
    const list = grouped.get(stream.datasetId)
    if (list) {
      if (list.length < PER_MEMBER) list.push(stream)
    }
    else {
      grouped.set(stream.datasetId, [stream])
    }
  }
  return grouped
}

export function renderLlmsTxt(input: LlmsTxtInput): string {
  const origin = input.origin.replace(/\/+$/, '')
  const members = input.members
  // 会员限定的 .md 只返回标题与封面，列出来会误导读者，直接跳过。
  const publicStreams = input.streams.filter(stream => stream.availability !== 'subscriber_only')
  const grouped = recentByMember(publicStreams)
  const sample = publicStreams[0] ?? null

  const lines: string[] = [
    '# ゆめみた 配信数据台',
    '',
    '> 夢限大みゅーたいぷ 五位成员已结束直播的公开数据台，覆盖同接、弹幕、SC、贴纸、会员里程碑、评论与逐字稿，可按成员、场次与趋势浏览。',
    '',
    '本站把成员已结束直播的公开数据整理成图表与结构化数据，供人与 Agent 读取。界面为简体中文，直播标题与逐字稿原文为日文。',
    '',
    '统计口径：',
    '',
    '- 时间一律 JST（UTC+9），日期写作 `YYYY-MM-DD`。',
    '- 同接、视听时间、播放、点赞来自第三方统计 VSTATS；没有数据时字段为 `null`，不是 0。',
    '- SC 与贴纸按币种分别累计，不做汇率换算，不同币种不能相加。',
    '- 评论只统计抓取到的条数，不等于 YouTube 侧的总评论数。',
    '- 高频词与 Top 发言者每场都有截断，跨场相加只是近似值。',
    '',
    '推荐读取顺序：',
    '',
    '1. 从「成员」拿到数据集 id，再按成员取 `/<datasetId>/stream/<videoId>.md` 读单场明细。',
    '2. 需要精确数值或跨场计算时，用「结构化接口」的 JSON 端点。',
    '3. 需要全量页面清单时读 sitemap。',
    '',
    '单场 URL 形如 `/<datasetId>/stream/<videoId>`，把后缀换成 `.md` 即得 Markdown 视图；联动场从任一参与成员的路径都能打开。',
    '',
    '会员限定场次（`availability` 为 `subscriber_only`）照常计入列表与聚合，但弹幕、SC、评论与逐字稿默认不公开：Markdown 只返回标题与封面，JSON 端点返回 `403`。',
    '',
    '本站是非官方粉丝项目，与 夢限大みゅーたいぷ、所属事务所、Bushiroad 均无隶属或合作关系；引用请注明来源「ゆめみた 配信数据台」并链接原页面。',
    '',
    '## 成员',
    '',
  ]

  for (const member of members) {
    lines.push(
      item(
        `${origin}/${member.id}`,
        member.label,
        `数据集 id \`${member.id}\`，${member.streamCount} 场公开直播（含联动场）`,
      ),
    )
  }

  // 空库时这一段也不留空列表，否则解析器当作空段。
  if (members.length === 0) {
    lines.push(item(`${origin}/about`, '数据说明', '尚未收录任何成员'))
  }

  lines.push('', '## 最近场次', '')

  let recentCount = 0
  for (const member of members) {
    for (const stream of grouped.get(member.id) ?? []) {
      lines.push(
        item(
          `${origin}/${stream.datasetId}/stream/${stream.videoId}.md`,
          linkText(stream.title),
          `${member.label} · ${stream.date} · Markdown`,
        ),
      )
      recentCount += 1
    }
  }

  if (recentCount === 0) {
    lines.push(item(`${origin}/about`, '数据说明', '当前没有可公开的场次'))
  }

  if (sample) {
    const markdownUrl = `${origin}/${sample.datasetId}/stream/${sample.videoId}.md`
    lines.push(
      '',
      '## 数据格式',
      '',
      item(
        `${origin}/schemas/stream-datapack.v2.json`,
        'datapack JSON Schema',
        '`/api/packs` 响应的结构（draft-07）。v2 是 v1 的超集，`chat.authors` / `chat.wordCounts` / `topAuthors[].authorId` 等 v1 缺失的字段都是可选的，同一份 schema 也能校验旧 pack',
      ),
      item(
        `${origin}/schemas/transcript.v1.json`,
        '逐字稿 JSON Schema',
        '`/api/transcripts` 响应的结构（draft-07）',
      ),
      item(
        `${origin}/schemas/densities.v1.json`,
        '弹幕密度 JSON Schema',
        '`/api/densities` 响应的结构（draft-07）',
      ),
      '',
      '## Markdown 视图',
      '',
      item(
        `${markdownUrl}?full=1`,
        '单场 Markdown 完整形态',
        '显式写出全部参数。frontmatter 固定含 `title` / `description` / `canonical` / `dataset` / `member` / `video_id` / `date` / `duration` / `youtube` / `generated_at` / `markdown_url`（有封面时另有 `image`）；正文依次是概览表、时间轴、弹幕与互动、付费、评论、逐字稿、数据说明、链接',
      ),
      item(
        `${markdownUrl}?transcript=0`,
        '单场 Markdown 省略逐字稿',
        '`transcript=0` 不展开逐字稿正文。默认（不带参数）会带逐字稿；`full=1` 不截断高频词、SC 与评论列表（默认各取前 40 / 20 / 20 条）',
      ),
      '',
      '## 结构化接口',
      '',
      item(
        `${origin}/api/packs/${sample.datasetId}/${sample.videoId}`,
        '单场完整 datapack',
        'GET，返回 `yumemita.stream-datapack/v2` 的 JSON，响应头 `Link: rel="describedby"` 指向 schema。SC、贴纸、会员事件与评论是全量，`chat.topWords` 最多 40 条、`chat.topAuthors` 最多 20 位。换成目标成员与场次即可；未知场次 404，会员限定 403，读库失败 503',
      ),
      item(
        `${origin}/api/densities/${sample.datasetId}?ids=${sample.videoId}`,
        '逐分钟弹幕密度',
        'GET，`ids` 逗号分隔、最多 8 个场次，返回 `{ densities: { <videoId>: number[] }, locked: string[] }`；数组下标即开播后第几分钟，`locked` 是被会员限定挡下的场次，与「没有数据」区分开',
      ),
      item(
        `${origin}/api/transcripts/${sample.datasetId}/${sample.videoId}`,
        '逐字稿正文',
        'GET，返回 `yumemita.transcript/v1` 的 JSON：`frontmatter`（videoId / date / title / members / tags / summary）+ `markdown`（保留 `[hh:mm:ss]` 时间码）。没有逐字稿 404，会员限定 403，对象存储不可用 503',
      ),
    )
  }

  lines.push(
    '',
    '## 站点',
    '',
    item(`${origin}/about`, '数据说明与免责', '数据来源、统计口径、已知限制、版权与非官方声明'),
    item(
      `${origin}/sitemap.xml`,
      'sitemap',
      '全部可收录 HTML 页面的 URL 清单；单场路径换成 `.md` 即得 Markdown 视图，`lastmod` 为对应场次的开播日期',
    ),
    item(
      'https://github.com/Chilfish/yumemita-stream-dashboard',
      '源码',
      '抓取、入库与页面实现；数据纠错与删除请求走 Issues',
    ),
    '',
    '## Optional',
    '',
    item(`${origin}/gallery`, '全组封面墙', '按 JST 自然月排列的直播封面，仅浏览用'),
    item(`${origin}/calendar`, '全组直播日历', '未来日程与近期场次，含预定与直播中，仅浏览用'),
    item(`${origin}/compare`, '全员对比', '按同一时间段与内容类型横向对比成员，noindex，仅浏览用'),
    '',
  )

  return lines.join('\n')
}
