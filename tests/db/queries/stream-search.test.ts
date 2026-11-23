import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { CONTENT_TYPE_RULES } from "@/lib/classify";
import { buildStreamSearchOrder, buildStreamSearchWhere } from "@/db/queries/streams";
import type { StreamSearchParams } from "@/lib/stream-search";

const dialect = new PgDialect();

function defaults(overrides: Partial<StreamSearchParams> = {}): StreamSearchParams {
  return {
    q: "",
    members: [],
    type: "all",
    from: null,
    to: null,
    availability: "all",
    sort: "date",
    dir: "desc",
    limit: 50,
    offset: 0,
    ...overrides,
  };
}

function render(params: StreamSearchParams) {
  const where = buildStreamSearchWhere(params);
  return {
    where: where ? dialect.sqlToQuery(where) : null,
    order: dialect.sqlToQuery(buildStreamSearchOrder(params)),
  };
}

describe("buildStreamSearchWhere", () => {
  it("没有过滤条件时不生成 WHERE", () => {
    expect(render(defaults()).where).toBeNull();
  });

  it("q 同时匹配标题、videoId 与日期，并转义 LIKE 通配符", () => {
    const { where } = render(defaults({ q: "100%" }));
    expect(where?.sql).toContain("ilike");
    expect(where?.sql).toContain("::text ilike");
    expect(where?.params).toContain("%100\\%%");
  });

  it("成员按 owner 或参与者匹配", () => {
    const { where } = render(defaults({ members: ["arale", "nonoka"] }));
    expect(where?.sql).toContain("participants");
    expect(where?.sql).toContain(" or ");
    // owner 与 participants 各绑定一次。
    expect(where?.params.filter(value => value === "arale" || value === "nonoka")).toHaveLength(4);
  });

  it("内容类型用与 classify.ts 相同的正则源码", () => {
    const { where } = render(defaults({ type: "sing" }));
    expect(where?.sql).toContain("case when");
    expect(where?.sql).toContain("~");
    for (const rule of CONTENT_TYPE_RULES) {
      expect(where?.params).toContain(rule.pattern.source);
    }
  });

  it("日期区间与公开范围各自生成条件", () => {
    const { where } = render(defaults({ from: "2026-01-01", to: "2026-12-31", availability: "public" }));
    expect(where?.sql).toContain(">=");
    expect(where?.sql).toContain("<=");
    expect(where?.sql).toContain("availability");
    expect(where?.params).toContain("2026-01-01");
    expect(where?.params).toContain("2026-12-31");
    expect(where?.params).toContain("public");
  });
});

describe("buildStreamSearchOrder", () => {
  it("日期排序按 date，null 排最后", () => {
    const { order } = render(defaults());
    expect(order.sql).toContain("date");
    expect(order.sql).toContain("nulls last");
    expect(order.sql).toContain("desc");
  });

  it("指标排序把会限行推到末尾", () => {
    const { order } = render(defaults({ sort: "views", dir: "asc" }));
    expect(order.sql).toContain("subscriber_only");
    expect(order.sql).toContain("coalesce");
    expect(order.sql).toContain("nulls last");
    expect(order.sql).toContain("asc");
  });
});
