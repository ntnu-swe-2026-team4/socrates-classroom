import { describe, expect, test } from "bun:test";
import { EmotionSplitter } from "../src/services/llm";

describe("情緒標記解析", () => {
  test("標記被拆成多個 chunk 也能正確取出", () => {
    const s = new EmotionSplitter();
    expect(s.push("[neu")).toEqual({});
    const out = s.push("tral] 你好，讓我們想想。");
    expect(out.emotion).toBe("neutral");
    expect(out.text).toBe("你好，讓我們想想。");
  });

  test("各種情緒與前後空白", () => {
    for (const emotion of ["happy", "confused", "angry"] as const) {
      const s = new EmotionSplitter();
      const out = s.push(`  [${emotion}]   回應`);
      expect(out.emotion).toBe(emotion);
      expect(out.text).toBe("回應");
    }
  });

  test("沒有標記時視為 neutral，原文照送", () => {
    const s = new EmotionSplitter();
    const out = s.push("這是一段沒有標記的回覆");
    expect(out.emotion).toBe("neutral");
    expect(out.text).toBe("這是一段沒有標記的回覆");
    expect(s.finish().emotion).toBe("neutral");
  });

  test("開頭只有空白時會等標記，不會先送出空白", () => {
    const s = new EmotionSplitter();
    expect(s.push("   ")).toEqual({});
    const out = s.push("[happy] 哈哈");
    expect(out.emotion).toBe("happy");
    expect(out.text).toBe("哈哈");
  });

  test("看似標記但內容過長時，照原文送出", () => {
    const s = new EmotionSplitter();
    const text = "[這不是情緒標記，只是一段超過二十四個字而且還在繼續的長句子";
    const out = s.push(text);
    expect(out.emotion).toBe("neutral");
    expect(out.text).toBe(text);
  });
});
