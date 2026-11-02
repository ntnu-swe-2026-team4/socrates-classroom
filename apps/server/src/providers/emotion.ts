import type { Emotion } from "@socrates/shared";

export class EmotionSplitter {
  private buffer = "";
  private resolved = false;
  emotion: Emotion | null = null;

  push(chunk: string): { emotion?: Emotion; text?: string } {
    if (this.resolved) return { text: chunk };
    this.buffer += chunk;
    const leading = this.buffer.replace(/^\s+/, "");
    if (!leading) return {};
    const m = /^\[(neutral|happy|confused|angry)\]\s*/.exec(leading);
    if (m) {
      this.resolved = true;
      this.emotion = m[1] as Emotion;
      const rest = leading.slice(m[0].length);
      this.buffer = "";
      return { emotion: this.emotion, text: rest || undefined };
    }
    if (leading.startsWith("[") && leading.length <= 24) return {};
    this.resolved = true;
    this.emotion = "neutral";
    const out = this.buffer;
    this.buffer = "";
    return { emotion: "neutral", text: out };
  }

  finish(): { emotion: Emotion; text?: string } {
    if (!this.resolved) {
      this.resolved = true;
      this.emotion = "neutral";
      const out = this.buffer;
      this.buffer = "";
      return { emotion: this.emotion, text: out || undefined };
    }
    return { emotion: this.emotion ?? "neutral" };
  }
}
