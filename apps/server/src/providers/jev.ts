import { typesafeSystemOneApi } from "@earendil-works/pi-ai/api/typesafe-system-one.lazy";
import { getBuiltinClassifierModel } from "@earendil-works/pi-ai/providers/all";
import { createProvider, type ClassifierApi, type ClassifierModel, type Provider } from "@earendil-works/pi-ai";
import type { Env } from "../env";
import { violationQuestions, type ViolationJudgment } from "./clef";
import type { ViolationType } from "@socrates/shared";

export const JEV_MODEL_ID = "jev-latest";
export const JEV_PROVIDER_ID = "typesafe";

export function buildJevClassifier(env: Env): { provider: Provider; model: ClassifierModel<ClassifierApi> } | null {
  const apiKey = env.TYPESAFE_API_KEY;
  if (!apiKey) return null;
  const builtin = getBuiltinClassifierModel(JEV_PROVIDER_ID, JEV_MODEL_ID);
  if (!builtin) return null;
  const model = builtin as ClassifierModel<ClassifierApi>;
  const provider = createProvider({
    id: JEV_PROVIDER_ID,
    name: "TypeSafe",
    auth: {
      apiKey: {
        name: "TypeSafe API key",
        resolve: async () => ({ auth: { apiKey }, source: JEV_PROVIDER_ID }),
      },
    },
    models: [],
    classifiers: { "typesafe-system-one": typesafeSystemOneApi() },
  } as never);
  return { provider, model };
}

export async function classifyViolationViaJev(
  models: {
    classify(
      model: never,
      context: never,
    ): Promise<{
      answers: Record<string, { type?: string; choice?: string; probabilities?: Record<string, number> }>;
      stopReason: string;
      errorMessage?: string;
    }>;
  },
  jevModel: ClassifierModel<ClassifierApi>,
  transcript: Array<{ role: string; text: string }>,
  latest: string,
): Promise<ViolationJudgment | null> {
  const result = await models.classify(
    jevModel as never,
    {
      state: {
        latest,
        transcript: transcript.slice(-8).map((row) => `${row.role}: ${row.text.slice(0, 200)}`),
      },
      questions: violationQuestions(),
    } as never,
  );
  const answer = result.answers.violation;
  if (result.stopReason !== "stop" || answer?.type !== "choice") {
    console.warn("[jev] unavailable", result.stopReason, result.errorMessage);
    return null;
  }
  return {
    type: answer.choice as ViolationType,
    probability: (answer.choice ? answer.probabilities?.[answer.choice] : undefined) ?? 0,
    source: "jev",
  };
}
