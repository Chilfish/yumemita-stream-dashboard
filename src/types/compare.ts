import type { ContentTypeKey } from "@/lib/classify";

export type CompareWindow = 3 | 6 | 12 | "all";

export interface CompareParams {
  /** 选中的成员 id；空数组在解析时回落为全部成员。 */
  members: string[];
  /** `null` = 全部内容类型。 */
  type: ContentTypeKey | null;
  months: CompareWindow;
}

/** 服务端聚合出的最小桶：一名成员 × 一个 JST 月份 × 一种内容类型。 */
export interface CompareBucket {
  memberId: string;
  month: string;
  type: ContentTypeKey | "all";
  streams: number;
  durationSec: number;
  chatTotal: number;
  superchats: number;
  commentsCaptured: number;
  /** 有评论数据的场次数；用来判断「评论/场」是否可计算。 */
  commentsStreams: number;
  concurrentWeighted: number;
  concurrentDuration: number;
}

export interface CompareMemberStat {
  id: string;
  label: string;
  color: string | null;
  streams: number;
  durationSec: number;
  avgConcurrent: number | null;
  chatPerMinute: number | null;
  scPerHour: number | null;
  commentsPerStream: number | null;
  sampleSufficient: boolean;
}

export type CompareMetricKey = "streams" | "avgConcurrent" | "chatPerMinute" | "scPerHour";

export interface CompareMetricSeries {
  key: CompareMetricKey;
  label: string;
  unit: string;
  /** memberId → 与 `months` 等长的值；没有数据的月份是 `null`。 */
  values: Record<string, (number | null)[]>;
}

export interface GroupCompareView {
  months: string[];
  members: CompareMemberStat[];
  series: CompareMetricSeries[];
  totals: {
    streams: number;
    durationSec: number;
    chatTotal: number;
    superchats: number;
  };
  sampleMin: number;
}

/** 页面与岛屿之间传输的预聚合数据；筛选完全在客户端完成。 */
export interface GroupCompareData {
  buckets: CompareBucket[];
  months: string[];
  sampleMin: number;
}
