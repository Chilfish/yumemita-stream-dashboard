/** 对象存储读取的可区分结果，避免用 null 同时表示未命中、未配置与读取失败。 */
export type ObjectReadResult =
  | { kind: "hit"; text: string }
  | { kind: "miss" }
  | { kind: "error"; error: unknown }
  | { kind: "unconfigured" };
