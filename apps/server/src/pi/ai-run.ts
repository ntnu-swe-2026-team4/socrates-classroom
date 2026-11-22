import type { Ai } from "@cloudflare/workers-types";

export type AiRun = (model: string, inputs: unknown) => Promise<unknown>;

export function aiRunOf(ai: Ai): AiRun {
  return (ai as unknown as { run: AiRun }).run;
}

export interface ClefChoice {
  choice: string;
  probability: number;
  confidence: number;
  probabilities: Record<string, number>;
}

export function readChoiceResult(raw: unknown, question: string): ClefChoice | null {
  if (typeof raw !== "object" || raw === null) return null;
  const answers = Reflect.get(raw, "answers");
  if (typeof answers !== "object" || answers === null) return null;
  const answer = Reflect.get(answers, question);
  if (typeof answer !== "object" || answer === null) return null;
  const choice = Reflect.get(answer, "choice");
  if (typeof choice !== "string") return null;
  const probabilitiesRaw = Reflect.get(answer, "probabilities");
  const probabilities: Record<string, number> = {};
  if (typeof probabilitiesRaw === "object" && probabilitiesRaw !== null) {
    for (const [key, value] of Object.entries(probabilitiesRaw)) {
      if (typeof value === "number") probabilities[key] = value;
    }
  }
  const confidence = Reflect.get(answer, "confidence");
  return {
    choice,
    probability: probabilities[choice] ?? 0,
    confidence: typeof confidence === "number" ? confidence : 0,
    probabilities,
  };
}
