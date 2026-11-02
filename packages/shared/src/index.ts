export type Emotion = "neutral" | "happy" | "confused" | "angry";
export type Lang = "zh" | "en" | "es";
export type LlmProvider = "glm" | "mock";

export interface HistoryMessage {
  role: "user" | "assistant";
  text: string;
}

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

export type DialogueScope = "archive" | "activity" | "discussion";

export interface PoolEntry {
  provider: "dgx-spark" | "opencode-go" | "openrouter" | "workers-ai" | "zai" | "mock";
  model: string;
  concurrency?: number;
}
