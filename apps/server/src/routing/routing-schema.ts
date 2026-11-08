import { z } from "zod";

export const ProviderKindSchema = z.enum(["openai-completions", "binding"]);

export const ProviderSchema = z.object({
  kind: ProviderKindSchema,
  model: z.string().optional(),
  baseUrlEnv: z.string().optional(),
  models: z.array(z.object({ id: z.string(), cost: z.enum(["free", "paid"]) })).optional(),
  cost: z.enum(["free", "paid"]).optional(),
});

export const AvailabilityEntrySchema = z.object({
  provider: z.string(),
  model: z.string().optional(),
  credential: z.enum(["platform"]).or(z.string().regex(/^teacher:/)),
  maxConcurrency: z.number().int().min(0),
  priority: z.number().int(),
});

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
    pseudonymPrefix: z.string().min(1),
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

export const ledgerKey = (entry: AvailabilityEntry, providerDef: z.infer<typeof ProviderSchema>): LedgerKey => ({
  provider: entry.provider,
  model: entry.model ?? providerDef.model ?? "",
  credential: entry.credential,
});

export const ledgerKeyId = (key: LedgerKey): string => `${key.provider}|${key.model}|${key.credential}`;
