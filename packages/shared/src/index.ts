// @socrates/shared — 前後端共用契約
// 單一真相：server 的 app 型別、情感標記、語言、SSE 事件形狀都在這裡。

export type Emotion = "neutral" | "happy" | "confused" | "angry";
export type Lang = "zh" | "en" | "es";
export type LlmProvider = "glm" | "mock";

export interface HistoryMessage {
  role: "user" | "assistant";
  text: string;
}

/** 對話 SSE：server → browser 的事件形狀（Phase 3 WebSocket 沿用同一組） */
export type DialogueSseEvent =
  | { event: "emotion"; data: { emotion: Emotion } }
  | { event: "delta"; data: { text: string } }
  | { event: "done"; data: { message: DialogueMessage } }
  | { event: "error"; data: { message: string; code: string } };

export interface DialogueMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  at: string;
  emotion?: Emotion;
}

/** 對話執行緒識別：scope 決定 D1 寫回目標，DO id = `${scope}:${id}` */
export type DialogueScope = "archive" | "activity" | "discussion";

/** Provider 白名單（見 docs/providers.md；只准 ZDR 0-day 模型） */
export interface PoolEntry {
  provider: "dgx-spark" | "opencode-go" | "openrouter" | "workers-ai" | "zai" | "mock";
  model: string;
  /** 同時在途上限；未公布併發的雲端 provider 不設，靠 429 fallback */
  concurrency?: number;
}
