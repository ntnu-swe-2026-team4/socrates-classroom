export type Emotion = "neutral" | "happy" | "confused" | "angry";

export interface DialogueMessageJson {
  id: string;
  role: "user" | "assistant";
  text: string;
  at: string;
  emotion?: Emotion;
}
