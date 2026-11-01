import { describe, expect, it } from "vitest";
import { emojiFileName, isCustomEmojiId } from "./emoji";

describe("emojiFileName", () => {
  it("uses the hash half of a channel emoji id", () => {
    expect(emojiFileName("UCWfF0DB6m_t2CE3KcOOOX7g/8g_oZ4f-HoCO_9EPh5TmgQc")).toBe(
      "8g_oZ4f-HoCO_9EPh5TmgQc.png",
    );
    expect(emojiFileName("UC99kOG6_9RD0mR3OG4EOfxw/54y5aNPZFd-QoPwPxrGNqQk")).toBe(
      "54y5aNPZFd-QoPwPxrGNqQk.png",
    );
  });

  it("rejects unicode emoji and unsafe ids", () => {
    expect(emojiFileName("🍷")).toBeNull();
    expect(emojiFileName("UC1/../etc")).toBeNull();
    expect(isCustomEmojiId("🍷")).toBe(false);
    expect(isCustomEmojiId("UC1/hash")).toBe(true);
  });
});
