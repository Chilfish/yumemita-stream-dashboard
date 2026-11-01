import { describe, expect, it } from "vitest";
import { isXTokenLabel, linkifyX, xHashtagUrl } from "./x-links";

describe("linkifyX", () => {
  it("links hashtags wherever they start a token", () => {
    const input = "(配信タグ) #見守律\n(イラストタグ)#りつみて\n#バンドリ\n\n#アニメゆめみた";
    expect(linkifyX(input)).toBe(
      [
        `(配信タグ) [#見守律](${xHashtagUrl("見守律")})`,
        `(イラストタグ)[#りつみて](${xHashtagUrl("りつみて")})`,
        `[#バンドリ](${xHashtagUrl("バンドリ")})`,
        "",
        `[#アニメゆめみた](${xHashtagUrl("アニメゆめみた")})`,
      ].join("\n"),
    );
  });

  it("links mentions to their profile", () => {
    expect(linkifyX("サムネ制作\n琴音えん\n@kotone_en000")).toBe(
      "サムネ制作\n琴音えん\n[@kotone_en000](https://x.com/kotone_en000)",
    );
    expect(linkifyX("@rito さんの")).toBe("[@rito](https://x.com/rito) さんの");
  });

  it("leaves urls, markdown headings, emails and mid-word hashes alone", () => {
    expect(linkifyX("X：https://x.com/BDP_yumemita#top")).toBe("X：https://x.com/BDP_yumemita#top");
    expect(linkifyX("https://www.youtube.com/@bang_dream_official")).toBe(
      "https://www.youtube.com/@bang_dream_official",
    );
    expect(linkifyX("# 見出し")).toBe("# 見出し");
    expect(linkifyX("C#")).toBe("C#");
    expect(linkifyX("mail: a@b.co")).toBe("mail: a@b.co");
  });

  it("stops tokens at whitespace and punctuation", () => {
    expect(linkifyX("#イ中田丁なう でポスト")).toBe(
      `[#イ中田丁なう](${xHashtagUrl("イ中田丁なう")}) でポスト`,
    );
  });
});

describe("isXTokenLabel", () => {
  it("recognises tag and mention labels only", () => {
    expect(isXTokenLabel("#見守律")).toBe(true);
    expect(isXTokenLabel("@kotone_en000")).toBe(true);
    expect(isXTokenLabel("https://x.com/kotone_en000")).toBe(false);
    expect(isXTokenLabel("BGM┊necobeam")).toBe(false);
  });
});
