import { describe, expect, it } from "vitest";
import { linkifyCommentText, splitCommentText } from "@/lib/comment-text";

const VIDEO = "Fd47-ZE1GVs";
const url = (seconds: number) => `https://www.youtube.com/watch?v=${VIDEO}&t=${seconds}s`;

describe("splitCommentText", () => {
  it("links a bare mm:ss at the start of a line", () => {
    expect(splitCommentText("7:20 アナタボシ/MilkyWay", VIDEO)).toEqual([
      { kind: "timecode", text: "7:20", url: url(440) },
      { kind: "text", text: " アナタボシ/MilkyWay" },
    ]);
  });

  it("links hh:mm:ss and single-digit minutes", () => {
    expect(splitCommentText("1:09:12 とくべチュ", VIDEO)[0]).toEqual({
      kind: "timecode",
      text: "1:09:12",
      url: url(4152),
    });
    expect(splitCommentText("2:50 開始", VIDEO)[0]).toEqual({
      kind: "timecode",
      text: "2:50",
      url: url(170),
    });
    expect(splitCommentText("4:26", VIDEO)).toEqual([
      { kind: "timecode", text: "4:26", url: url(266) },
    ]);
  });

  it("links every timecode in a setlist and keeps the surrounding text", () => {
    const segments = splitCommentText("41:16 | 43:26 | 1:02:08 🎶", VIDEO);
    expect(segments.filter(segment => segment.kind === "timecode").map(s => s.text)).toEqual([
      "41:16",
      "43:26",
      "1:02:08",
    ]);
    expect(segments.map(segment => segment.text).join("")).toBe("41:16 | 43:26 | 1:02:08 🎶");
  });

  it("links ranges separated by dashes and tildes", () => {
    expect(
      splitCommentText("0:01-2:35 Kawaii", VIDEO)
        .filter(segment => segment.kind === "timecode")
        .map(segment => segment.text),
    ).toEqual(["0:01", "2:35"]);
  });

  it("links a timecode right after a custom emoji shortcode", () => {
    expect(splitCommentText(":_kuma:07:19 アナタボシ", VIDEO)[1]).toEqual({
      kind: "timecode",
      text: "07:19",
      url: url(439),
    });
  });

  it("does not treat a pasted youtube link's &t= as a timecode", () => {
    const pasted = "https://www.youtube.com/watch?v=9J3NU9hI3as&t=159s";
    expect(splitCommentText(`元ネタ ${pasted}`, VIDEO)).toEqual([
      { kind: "text", text: "元ネタ " },
      { kind: "text", text: pasted },
    ]);
  });

  it("leaves clock times and glued digits alone", () => {
    expect(linkifyCommentText("午後8:16！", VIDEO)).toBe("午後8:16！");
    expect(linkifyCommentText("Q62and1:38:40の", VIDEO)).toBe("Q62and1:38:40の");
    expect(linkifyCommentText("123:45", VIDEO)).toBe("123:45");
  });

  it("rejects out-of-range minutes and seconds", () => {
    expect(splitCommentText("12:75 は時間ではない", VIDEO)).toEqual([
      { kind: "text", text: "12:75 は時間ではない" },
    ]);
  });

  it("keeps the original text when there is no video id", () => {
    expect(splitCommentText("7:20 開始", "")).toEqual([{ kind: "text", text: "7:20 開始" }]);
    expect(splitCommentText("", VIDEO)).toEqual([]);
  });

  it("reproduces the original text exactly", () => {
    const text = "ざっくりタイムスタンプ\n7:20 アナタボシ\n1:09:12 とくべチュ\n午後8:16 に集合";
    expect(splitCommentText(text, VIDEO).map(segment => segment.text).join("")).toBe(text);
  });
});

describe("linkifyCommentText", () => {
  it("renders markdown links whose label is the original timecode", () => {
    expect(linkifyCommentText("13:51 永遠プレッシャー/AKB48", VIDEO)).toBe(
      `[13:51](${url(831)}) 永遠プレッシャー/AKB48`,
    );
  });

  it("keeps line breaks so multi-line setlists stay intact", () => {
    const text = "7:20 アナタボシ\n13:51 永遠プレッシャー";
    expect(linkifyCommentText(text, VIDEO)).toBe(
      `[7:20](${url(440)}) アナタボシ\n[13:51](${url(831)}) 永遠プレッシャー`,
    );
  });
});
