import { describe, expect, it } from "vitest";
import { classifyTitle, classifyTitles } from "./classify";

describe("classifyTitle", () => {
  it("recognises cover and singing streams", () => {
    expect(classifyTitle("【弾き語り】またーり")).toEqual({ key: "sing", matched: true });
    expect(classifyTitle("【ギター重ね録り】うちゅうのふしぎをアコギかばー！")).toEqual({
      key: "sing",
      matched: true,
    });
    expect(classifyTitle("【歌枠】ののうた♪アニソンおおめうたわく")).toEqual({
      key: "sing",
      matched: true,
    });
  });

  it("recognises games before singing practice", () => {
    expect(
      classifyTitle("【Our Notes先行プレイ!】フルコンするまでギター練習!上手に演奏できるもん!"),
    ).toEqual({
      key: "game",
      matched: true,
    });
    expect(classifyTitle("# 4【魔法少女ノ魔女裁判】第二回魔女裁判！")).toEqual({
      key: "game",
      matched: true,
    });
  });

  it("recognises events", () => {
    expect(classifyTitle("【ライブ振り返り】バンドリ！13thライブをふりかえる！")).toEqual({
      key: "event",
      matched: true,
    });
  });

  it("recognises talk streams", () => {
    expect(classifyTitle("【でかいぬしゅうかい】さむくなってきたよね")).toEqual({
      key: "talk",
      matched: true,
    });
  });

  it("falls back to talk and marks unmatched titles", () => {
    expect(classifyTitle("【真夏】クリスマスをとりかえせ！")).toEqual({
      key: "talk",
      matched: false,
    });
    expect(classifyTitle(null)).toEqual({ key: "talk", matched: false });
  });
});

describe("classifyTitles", () => {
  it("counts every type and reports shares", () => {
    const result = classifyTitles([
      "【弾き語り】a",
      "【弾き語り】b",
      "【魔法少女ノ魔女裁判】c",
      "【ライブ振り返り】d",
      "未知の标题",
    ]);

    expect(result.types.map(item => item.count)).toEqual([2, 1, 1, 1]);
    expect(result.unclassified).toBe(1);
    expect(result.types[0]?.share).toBeCloseTo(0.4);
  });

  it("handles an empty list", () => {
    const result = classifyTitles([]);
    expect(result.unclassified).toBe(0);
    expect(result.types.every(item => item.count === 0 && item.share === 0)).toBe(true);
  });
});
