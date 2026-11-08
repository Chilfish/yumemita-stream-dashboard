import { describe, expect, it } from "vitest";
import { isV2Pack } from "./schema-version";

describe("isV2Pack", () => {
  it("只把 /v2 后缀当作 v2", () => {
    expect(isV2Pack("yumemita.stream-datapack/v2")).toBe(true);
    expect(isV2Pack("yumemita.stream-datapack/v1")).toBe(false);
    expect(isV2Pack(null)).toBe(false);
    expect(isV2Pack(undefined)).toBe(false);
    expect(isV2Pack("")).toBe(false);
    expect(isV2Pack("yumemita.stream-datapack/v20")).toBe(false);
  });
});
