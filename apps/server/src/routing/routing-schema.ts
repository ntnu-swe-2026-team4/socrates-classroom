import { z } from "zod";

export const ProviderKindSchema = z.enum(["openai-completions", "binding"]);

export const ProviderModelSchema = z
  .object({
    id: z.string().min(1),
    cost: z.enum(["free", "paid"]).optional(),
    reasoning: z.boolean().optional(),
    input: z.array(z.enum(["text", "image"])).optional(),
    contextWindow: z.number().int().min(1).optional(),
    maxTokens: z.number().int().min(1).optional(),
  })
  .strict();

export const ProviderSchema = z
  .object({
    kind: ProviderKindSchema,
    model: z.string().optional(),
    baseUrl: z.string().optional(),
    baseUrlEnv: z.string().optional(),
    compat: z.record(z.string(), z.union([z.string(), z.boolean(), z.number()])).optional(),
    models: z.array(ProviderModelSchema).optional(),
    cost: z.enum(["free", "paid"]).optional(),
  })
  .strict()
  .superRefine((def, ctx) => {
    if (def.kind === "openai-completions" && !def.baseUrl && !def.baseUrlEnv) {
      ctx.addIssue({ code: "custom", message: "openai-completions provider needs baseUrl or baseUrlEnv" });
    }
  });

export const AvailabilityEntrySchema = z
  .object({
    provider: z.string(),
    model: z.string().optional(),
    credential: z.enum(["platform"]).or(z.string().regex(/^teacher:/)),
    maxConcurrency: z.number().int().min(0),
    priority: z.number().int(),
  })
  .strict();

export const TrafficClassSchema = z.object({
  availability: z.literal("defaults"),
});

export const RoutingConfigSchema = z.object({
  providers: z.record(z.string(), ProviderSchema),
  classifiers: z.record(z.string(), z.string().min(1)),
  voice: z.object({
    stt: z.string().min(1),
    tts: z.string().min(1),
  }),
  report: z.object({
    studentAttempts: z.number().int().min(1),
    alarmAttempts: z.number().int().min(1),
    alarmBackoffMs: z.number().int().min(0),
    alarmTimeoutMs: z.number().int().min(1000),
    pseudonymPrefix: z.string().min(1),
  }),
  teacherChain: z.object({
    maxConcurrency: z.number().int().min(1).max(100),
  }),
  defaults: z.object({ availability: z.array(AvailabilityEntrySchema) }),
  trafficClasses: z.record(z.string(), TrafficClassSchema),
});

export type RoutingConfig = z.infer<typeof RoutingConfigSchema>;
export type AvailabilityEntry = z.infer<typeof AvailabilityEntrySchema>;

export interface LedgerKey {
  provider: string;
  model: string;
  credential: string;
}

export const providerModelOf = (providerDef: z.infer<typeof ProviderSchema>): string =>
  providerDef.model ?? providerDef.models?.[0]?.id ?? "";

export const ledgerKey = (entry: AvailabilityEntry, providerDef: z.infer<typeof ProviderSchema>): LedgerKey => ({
  provider: entry.provider,
  model: entry.model ?? providerModelOf(providerDef),
  credential: entry.credential,
});

export const ledgerKeyId = (key: LedgerKey): string => `${key.provider}|${key.model}|${key.credential}`;
