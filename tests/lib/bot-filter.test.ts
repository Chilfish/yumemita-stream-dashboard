import { describe, expect, it } from "vitest";
import { blockedBotResponse, isBlockedBot } from "@/lib/bot-filter";

const BLOCKED = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36 (compatible; meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler))",
  "Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)",
  "CCBot/2.0 (https://commoncrawl.org/faq/)",
  "Mozilla/5.0 (compatible; Bytespider; spider-feedback@bytedance.com)",
  "Mozilla/5.0 (compatible; Google-Extended)",
  "Mozilla/5.0 (compatible; Applebot-Extended/0.1; +http://www.apple.com/go/applebot)",
  "Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)",
  "Mozilla/5.0 (compatible; MistralAI-Training/1.0)",
  "Scrapy/2.11.1 (+https://scrapy.org)",
];

const ALLOWED = [
  "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
  "Mozilla/5.0 (compatible; Applebot/0.1; +http://www.apple.com/go/applebot)",
  "Mozilla/5.0 (compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot)",
  "Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)",
  "Mozilla/5.0 (compatible; ChatGPT-User/1.0; +https://openai.com/bot)",
  "Mozilla/5.0 (compatible; Claude-User/1.0; +Claude-User@anthropic.com)",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
];

describe("isBlockedBot", () => {
  it("拦住 AI 训练 / 整站抓取 UA（大小写不敏感）", () => {
    for (const ua of [...BLOCKED, ...BLOCKED.map(value => value.toUpperCase())]) {
      expect(isBlockedBot(ua), ua).toBe(true);
    }
  });

  it("放行搜索引擎、AI 搜索索引与普通浏览器", () => {
    for (const ua of ALLOWED) {
      expect(isBlockedBot(ua), ua).toBe(false);
    }
  });

  it("UA 缺失时不拦", () => {
    expect(isBlockedBot(null)).toBe(false);
    expect(isBlockedBot("")).toBe(false);
  });
});

describe("blockedBotResponse", () => {
  it("返回 403 且不进缓存、不可索引", async () => {
    const response = blockedBotResponse();
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(await response.text()).toContain("不允许");
  });
});
