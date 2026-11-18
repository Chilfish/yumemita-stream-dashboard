/**
 * AI 训练 / 整站抓取类机器人。
 *
 * 这些 bot 按 sitemap 全站巡爬，每条都是请求期 SSR + 一次数据库查询，其中不少（Bytespider、
 * 部分 Perplexity 抓取）根本不看 robots.txt；只有 Worker 层阻断才真的有效。
 *
 * 刻意放行：传统搜索引擎（Googlebot / Bingbot / Yandex）与 AI 搜索索引类
 * （OAI-SearchBot、Claude-SearchBot、PerplexityBot、Applebot、GoogleOther 之外的 Googlebot 家族），
 * 否则站点会从 AI 回答的引用里消失。清单参考 ai-robots-txt/ai.robots.txt（2026-11）。
 */
const BLOCKED_BOT_UA = [
  // Meta
  'meta-externalagent',
  'meta-externalfetcher',
  'meta-webindexer',
  'facebookbot',
  // OpenAI（训练档；OAI-SearchBot / ChatGPT-User 放行）
  'gptbot',
  'oai-adsbot',
  // Anthropic（训练档；Claude-SearchBot / Claude-User 放行）
  'claudebot',
  'claude-web',
  'anthropic-ai',
  // Google / Apple / Amazon / Microsoft
  'google-extended',
  'googleother',
  'applebot-extended',
  'amazonbot',
  'amzn-searchbot',
  'bedrockbot',
  // 国内厂商
  'bytespider',
  'chatglm-spider',
  'erniebot',
  'deepseekbot',
  'hunyuan',
  'qwenbot',
  'tongyibot',
  // Mistral / Cohere / Allen AI
  'mistralai-training',
  'mistralai-index',
  'cohere-ai',
  'cohere-training-data-crawler',
  'ai2bot',
  'ai2bot-dolma',
  // 公开数据集与图库抓取
  'ccbot',
  'img2dataset',
  'laion-huggingface-processor',
  'laiondownloader',
  'imagesiftbot',
  'timpibot',
  // 聚合 / 检索类
  'diffbot',
  'omgili',
  'youbot',
  'velenpublicwebcrawler',
  'panscient',
  // 通用爬虫框架与爬取服务
  'scrapy',
  'crawl4ai',
  'firecrawlagent',
  'apifybot',
  'apifywebsitecontentcrawler',
  'lightpanda',
] as const

/** UA 缺失（健康检查、curl、部分 RSS 阅读器）时一律放行，不能误伤正常请求。 */
export function isBlockedBot(userAgent: string | null): boolean {
  if (!userAgent) return false
  const ua = userAgent.toLowerCase()
  return BLOCKED_BOT_UA.some(pattern => ua.includes(pattern))
}

/** 机器人拦截响应：不带任何 SSR 产物，也不进缓存。 */
export function blockedBotResponse(): Response {
  return new Response('本站不允许 AI 训练 / 索引抓取。\n', {
    status: 403,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex, nofollow',
    },
  })
}
