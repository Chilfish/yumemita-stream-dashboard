/**
 * 组级视图的传输格式。只保留组首页 / 全组相册真正渲染的字段，
 * 避免为了 1,900 行摘要去拉五份完整 manifest。
 */

export const GROUP_SUMMARY_SCHEMA = "yumemita.dashboard.group-summary/v1";
export const GROUP_GALLERY_SCHEMA = "yumemita.dashboard.group-gallery/v1";

/** 「最近更新」预生成的行数；页面实际只展示前 8 条。 */
export const GROUP_RECENT_LIMIT = 20;

/** 成员全期汇总：不随“今天”变化，发布时一次算好。 */
export interface GroupMemberStat {
  datasetId: string;
  streamCount: number;
  chatTotal: number;
  superchats: number;
  durationSec: number;
  avgConcurrent: number | null;
}

/**
 * 最近 40 天有场次的日期桶。近 7 天 / 本月窗口最多只覆盖 31 天，
 * 因此不需要把全部 1,900 行明细带到首页；客户端用这些桶按当前日期求和即可。
 */
export interface GroupDayStat {
  datasetId: string;
  date: string;
  streams: number;
  chat: number;
}

/** 组视图会显示的一行场次。 */
export interface GroupStreamSummary {
  datasetId: string;
  date: string;
  videoId: string;
  title: string;
  startedAt: string | null;
  durationSec: number | null;
  availability: string | null;
  avgConcurrent: number | null;
  maxConcurrent: number | null;
  chatTotal: number;
  superchats: number;
  vstatsViews: number | null;
  snapshotViews: number | null;
  thumbnail?: string | null;
}

export interface GroupSummaryFile {
  schema: string;
  generatedAt: string;
  /** 每位成员的全期汇总（场次、弹幕、SC、时长、加权同接）。 */
  members: GroupMemberStat[];
  /** 最近 40 天的按日桶：用于按「现在」计算近 7 天 / 本月窗口。 */
  days: GroupDayStat[];
  /** 每位成员最新一场：hero、成员列表与 SEO 分享图。 */
  latest: GroupStreamSummary[];
  /** 全组最近若干场：首页「最近更新」。 */
  recent: GroupStreamSummary[];
}

export interface GroupGalleryFile {
  schema: string;
  generatedAt: string;
  /** 全组相册要铺满所有场次，按需在 /gallery 才加载。 */
  streams: GroupStreamSummary[];
}
