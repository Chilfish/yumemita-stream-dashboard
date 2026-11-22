import { describe, expect, it } from "vitest";
import { canonicalWord, isNoiseWord, isStopword } from "@/lib/words";

describe("canonicalWord", () => {
  it("folds every laughter spelling into www", () => {
    for (const word of ["w", "ww", "www", "wwwww", "WWW", "ｗｗ", "ｗｗｗｗ", "笑", "笑笑", "草"]) {
      expect(canonicalWord(word), word).toBe("www");
    }
  });

  it("folds full-width and half-width forms", () => {
    expect(canonicalWord("ｱｯ")).toBe("アッ");
    expect(canonicalWord("ＡＢＣ")).toBe("abc");
  });

  it("lowercases Latin-only words", () => {
    expect(canonicalWord("Yuno")).toBe("yuno");
    expect(canonicalWord("EN")).toBe("en");
  });

  it("merges common table variants", () => {
    expect(canonicalWord("可愛い")).toBe("かわいい");
    expect(canonicalWord("助かる")).toBe("たすかる");
    expect(canonicalWord("ヤバ")).toBe("やばい");
    expect(canonicalWord("おつかれさま")).toBe("お疲れ様");
    expect(canonicalWord("ありがとうございます")).toBe("ありがとう");
  });

  it("keeps other words as-is", () => {
    for (const word of ["かわいい", "ライブ", "window", "ビオラ"]) {
      expect(canonicalWord(word), word).toBe(word);
    }
  });
});

describe("isNoiseWord", () => {
  it("drops symbol-only tokens", () => {
    for (const word of ["ー", "ーーーー", "ーーーーー", "〜〜", "……", "！！！？"]) {
      expect(isNoiseWord(word), word).toBe(true);
    }
  });

  it("keeps real words", () => {
    for (const word of ["ありがとう", "笑", "ビオラ"]) {
      expect(isNoiseWord(word), word).toBe(false);
    }
  });
});

describe("isStopword", () => {
  it("is separate from the word normalization", () => {
    expect(isStopword("www")).toBe(false);
    expect(isStopword("said")).toBe(true);
  });
});
