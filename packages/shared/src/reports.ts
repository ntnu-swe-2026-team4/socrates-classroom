import { z } from "zod";

const turns = z.array(z.number().int().min(1)).min(1);

export const ClassReportSchema = z.object({
  students: z
    .array(
      z.object({
        id: z.string(),
        summary: z.array(z.object({ step: z.string(), turns })).min(1),
      }),
    )
    .min(1),
  unstated: z.array(z.string()),
  axes: z
    .array(
      z.object({
        name: z.string(),
        low: z.string(),
        high: z.string(),
        positions: z
          .array(
            z.object({
              id: z.string(),
              turns,
              view: z.string(),
              end: z.enum(["low", "middle", "high"]),
              at: z.number().int().min(0).max(100),
            }),
          )
          .min(2),
        why: z.string(),
      }),
    )
    .min(1),
  overview: z.array(z.string()).min(1),
});

export type ClassReport = z.infer<typeof ClassReportSchema>;

export const StudentAnalysisSchema = z.union([
  z.object({
    stated: z.literal(true),
    claim: z.object({ text: z.string(), turns }),
    reasons: z.object({ text: z.string(), turns }),
    tension: z.union([z.object({ text: z.string(), turns }), z.null()]),
  }),
  z.object({
    stated: z.literal(false),
    doing: z.object({ text: z.string(), turns }),
  }),
]);

export type StudentAnalysis = z.infer<typeof StudentAnalysisSchema>;

export const TopicGenSchema = z.object({
  topics: z
    .array(
      z.object({
        title: z.string(),
        statement: z.string(),
        prompts: z.array(z.string()).min(1).max(6),
      }),
    )
    .min(1)
    .max(6),
});

export type TopicGen = z.infer<typeof TopicGenSchema>;
