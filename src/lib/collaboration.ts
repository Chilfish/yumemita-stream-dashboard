/** 联动视图只需要这几列；成员页与组首页两条数据源共用。 */
export interface CollaborationSource {
  videoId: string;
  /** 频道主；`StreamSummary` 里可能是 undefined，聚合时跳过。 */
  datasetId?: string;
  /** 已经规整过的联动行用 `ownerId`；与 `datasetId` 二选一。 */
  ownerId?: string;
  participants?: string[];
  date: string;
  title: string;
}

export interface CollaborationStream {
  videoId: string;
  ownerId: string;
  /** 频道主之外的参与者。 */
  participants: string[];
  date: string;
  title: string;
  /** 这一场共几位成员，三人场用来在明细里标人数。 */
  memberCount: number;
}

export interface CollaborationPair {
  /** 排序后的两位成员，保证 A×B 与 B×A 是同一条。 */
  a: string;
  b: string;
  count: number;
  recentDate: string;
  /** 同场场次，按日期倒序。 */
  streams: CollaborationStream[];
}

export interface CollaborationPartner {
  otherId: string;
  count: number;
  recentDate: string | null;
  streams: CollaborationStream[];
}

/** 无序对键；成员 id 里不会出现 `\u0000`。 */
export function collaborationPairKey(a: string, b: string): string {
  return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}

export function toCollaborationStream(
  row: CollaborationSource & { datasetId: string },
): CollaborationStream | null {
  const participants = [...new Set(row.participants ?? [])].filter(id => id !== row.datasetId);
  if (participants.length === 0) return null;
  return {
    videoId: row.videoId,
    ownerId: row.datasetId,
    participants,
    date: row.date,
    title: row.title,
    memberCount: participants.length + 1,
  };
}

/**
 * 把每场展开成两两组合并累加。
 *
 * 口径是「同场次数」：三人场拆成三对各 +1。只统计 `memberIds` 里的成员，
 * 未登记的参与者不会凭空多出一列；没有参与者的场次直接跳过。
 */
export function buildCollaborationPairs(
  rows: CollaborationSource[],
  memberIds: string[],
): CollaborationPair[] {
  const known = new Set(memberIds);
  const pairs = new Map<string, CollaborationPair>();

  for (const row of rows) {
    const ownerId = row.datasetId ?? row.ownerId;
    if (!ownerId) continue;
    const ids = [...new Set([ownerId, ...(row.participants ?? [])])].filter(id => known.has(id));
    if (ids.length < 2) continue;

    const stream: CollaborationStream = {
      videoId: row.videoId,
      ownerId,
      participants: ids.filter(id => id !== ownerId),
      date: row.date,
      title: row.title,
      memberCount: ids.length,
    };

    for (let left = 0; left < ids.length; left += 1) {
      for (let right = left + 1; right < ids.length; right += 1) {
        const key = collaborationPairKey(ids[left], ids[right]);
        let pair = pairs.get(key);
        if (!pair) {
          pair = {
            a: ids[left] < ids[right] ? ids[left] : ids[right],
            b: ids[left] < ids[right] ? ids[right] : ids[left],
            count: 0,
            recentDate: "",
            streams: [],
          };
          pairs.set(key, pair);
        }
        pair.count += 1;
        pair.streams.push(stream);
      }
    }
  }

  for (const pair of pairs.values()) {
    pair.streams.sort(
      (left, right) => right.date.localeCompare(left.date) || right.videoId.localeCompare(left.videoId),
    );
    pair.recentDate = pair.streams[0]?.date ?? "";
  }

  return [...pairs.values()].sort(
    (left, right) =>
      right.count - left.count ||
      left.a.localeCompare(right.a) ||
      left.b.localeCompare(right.b),
  );
}

export function findCollaborationPair(
  pairs: CollaborationPair[],
  left: string,
  right: string,
): CollaborationPair | null {
  const key = collaborationPairKey(left, right);
  return (
    pairs.find(pair => collaborationPairKey(pair.a, pair.b) === key) ?? null
  );
}

/**
 * 某位成员与其他成员的同场次数。成员总数固定，0 次的组合也保留，
 * 由调用方显示 `—`，与「无数据」区分。
 */
export function collaborationPartners(
  memberId: string,
  pairs: CollaborationPair[],
  memberIds: string[],
): CollaborationPartner[] {
  return memberIds
    .filter(id => id !== memberId)
    .map(otherId => {
      const pair = findCollaborationPair(pairs, memberId, otherId);
      return {
        otherId,
        count: pair?.count ?? 0,
        recentDate: pair?.recentDate ?? null,
        streams: pair?.streams ?? [],
      };
    })
    .sort((left, right) => right.count - left.count || left.otherId.localeCompare(right.otherId));
}
