export const CONTENT_TYPES = ["sing", "event", "talk", "game"] as const;

export type ContentTypeKey = (typeof CONTENT_TYPES)[number];

export const CONTENT_TYPE_LABELS: Record<ContentTypeKey, string> = {
  sing: "弹唱",
  event: "活动",
  talk: "杂谈",
  game: "游戏",
};

export function isContentType(value: unknown): value is ContentTypeKey {
  return typeof value === "string" && (CONTENT_TYPES as readonly string[]).includes(value);
}

interface Rule {
  key: ContentTypeKey;
  pattern: RegExp;
}

/**
 * 顺序即优先级：先识别信号最强的标题前缀，再退到泛化关键词。
 * 未命中的标题归入「杂谈」，并单独计数，避免静默丢弃。
 */
const RULES: Rule[] = [
  { key: "sing", pattern: /弾き語り|弾き騙り|歌枠|アコギ|歌って|カバー|演奏|リサイタル/ },
  { key: "game", pattern: /ゲーム|実況|プレイ|あそぶ|魔女裁判|SSR|ガチャ|引くまで|ノベル|RPG/ },
  {
    key: "event",
    pattern: /振り返り|イベント|リリイベ|特番|記念|お知らせ|コラボ|ありがとう|新宿着陸|ライブ/,
  },
  { key: "talk", pattern: /雑談|おしゃべり|トーク|質問|相談|待機|ざつだん|ぬしゅうかい|ふつおた|アワーノーツ|スパチャ/ },
];

export interface ClassifiedTitle {
  key: ContentTypeKey;
  matched: boolean;
}

export function classifyTitle(title: string | null | undefined): ClassifiedTitle {
  const text = title ?? "";
  for (const rule of RULES) {
    if (rule.pattern.test(text)) return { key: rule.key, matched: true };
  }
  return { key: "talk", matched: false };
}

export interface ContentTypeBreakdown {
  key: ContentTypeKey;
  label: string;
  count: number;
  share: number;
}

export function classifyTitles(titles: (string | null | undefined)[]): {
  types: ContentTypeBreakdown[];
  unclassified: number;
} {
  const counts = new Map<ContentTypeKey, number>(CONTENT_TYPES.map(key => [key, 0]));
  let unclassified = 0;

  for (const title of titles) {
    const result = classifyTitle(title);
    counts.set(result.key, (counts.get(result.key) ?? 0) + 1);
    if (!result.matched) unclassified += 1;
  }

  const total = titles.length;
  return {
    types: CONTENT_TYPES.map(key => ({
      key,
      label: CONTENT_TYPE_LABELS[key],
      count: counts.get(key) ?? 0,
      share: total > 0 ? (counts.get(key) ?? 0) / total : 0,
    })),
    unclassified,
  };
}
