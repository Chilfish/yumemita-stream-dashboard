import { describe, expect, it } from "vitest";
import {
  buildCollaborationPairs,
  collaborationPairKey,
  collaborationPartners,
  findCollaborationPair,
  toCollaborationStream,
  type CollaborationSource,
} from "./collaboration";

const MEMBERS = ["nonoka", "arale", "ritsu", "miyako", "yuno"];

function stream(
  videoId: string,
  datasetId: string,
  participants: string[],
  date = "2024-01-01",
  title = "",
): CollaborationSource & { datasetId: string } {
  return { videoId, datasetId, participants, date, title };
}

describe("collaborationPairKey", () => {
  it("对顺序不敏感", () => {
    expect(collaborationPairKey("nonoka", "arale")).toBe(collaborationPairKey("arale", "nonoka"));
  });
});

describe("toCollaborationStream", () => {
  it("去掉 owner 与重复参与者", () => {
    expect(toCollaborationStream(stream("v1", "nonoka", ["nonoka", "arale", "arale"]))).toMatchObject({
      ownerId: "nonoka",
      participants: ["arale"],
      memberCount: 2,
    });
  });

  it("没有参与者时返回 null", () => {
    expect(toCollaborationStream(stream("v1", "nonoka", []))).toBeNull();
  });
});

describe("buildCollaborationPairs", () => {
  it("双人场计 1 次，A×B 与 B×A 是同一条", () => {
    const pairs = buildCollaborationPairs([stream("v1", "nonoka", ["arale"])], MEMBERS);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ a: "arale", b: "nonoka", count: 1 });
    expect(findCollaborationPair(pairs, "nonoka", "arale")?.count).toBe(1);
  });

  it("三人场拆成三对各计 1 次，并记录人数", () => {
    const pairs = buildCollaborationPairs([stream("v1", "nonoka", ["arale", "yuno"])], MEMBERS);
    expect(pairs.map(pair => pair.count)).toEqual([1, 1, 1]);
    expect(findCollaborationPair(pairs, "nonoka", "arale")?.streams[0]).toMatchObject({
      memberCount: 3,
      ownerId: "nonoka",
    });
  });

  it("同一对多场累加，最近一次取最大日期", () => {
    const pairs = buildCollaborationPairs(
      [
        stream("v1", "nonoka", ["arale"], "2024-01-01"),
        stream("v2", "arale", ["nonoka"], "2025-03-02"),
      ],
      MEMBERS,
    );
    expect(pairs[0]).toMatchObject({ count: 2, recentDate: "2025-03-02" });
    expect(pairs[0]?.streams.map(item => item.videoId)).toEqual(["v2", "v1"]);
  });

  it("未知成员不生成列，单人场跳过", () => {
    const pairs = buildCollaborationPairs(
      [stream("v1", "nonoka", ["stranger"]), stream("v2", "nonoka", [])],
      MEMBERS,
    );
    expect(pairs).toEqual([]);
  });

  it("已经规整过的 ownerId 行也能聚合", () => {
    const pairs = buildCollaborationPairs(
      [{ videoId: "v1", ownerId: "nonoka", participants: ["arale"], date: "2024-01-01", title: "" }],
      MEMBERS,
    );
    expect(pairs[0]).toMatchObject({ a: "arale", b: "nonoka", count: 1 });
  });
});

describe("collaborationPartners", () => {
  it("保留 0 次组合并按次数降序", () => {
    const pairs = buildCollaborationPairs(
      [stream("v1", "nonoka", ["arale"]), stream("v2", "nonoka", ["arale"]), stream("v3", "nonoka", ["yuno"])],
      MEMBERS,
    );
    const partners = collaborationPartners("nonoka", pairs, MEMBERS);
    expect(partners.map(row => [row.otherId, row.count])).toEqual([
      ["arale", 2],
      ["yuno", 1],
      ["miyako", 0],
      ["ritsu", 0],
    ]);
    expect(partners.at(-1)).toMatchObject({ count: 0, recentDate: null, streams: [] });
  });
});
