import { z } from "zod";

const turns = z.array(z.number().int().min(1)).min(1);

const position = z.object({
  id: z.string(),
  turns,
  view: z.string(),
  end: z.enum(["low", "middle", "high"]),
  at: z.number().int().min(0).max(100),
});

export const ClassReportSchema = z.object({
  students: z.array(
    z.object({
      id: z.string(),
      summary: z.array(z.object({ step: z.string(), turns })).min(1),
    }),
  ),
  unstated: z.array(z.string()),
  axes: z.array(
    z.object({
      name: z.string(),
      low: z.string(),
      high: z.string(),
      positions: z.array(position).min(1),
      why: z.string(),
    }),
  ),
  overview: z.array(z.string()).min(1),
});

export type ClassReport = z.infer<typeof ClassReportSchema>;

const submittedPosition = z.object({
  id: z.string(),
  turns,
  view: z.string(),
  side: z.enum(["left", "middle", "right"]),
  strength: z.number().int().min(1).max(5),
});

const submittedAxis = z.object({
  name: z.string(),
  left: z.string(),
  right: z.string(),
  positions: z.array(submittedPosition).min(1),
  why: z.string(),
});

export const ClassReportSubmissionSchema = ClassReportSchema.extend({
  axes: z.array(submittedAxis),
});

export type ClassReportSubmission = z.infer<typeof ClassReportSubmissionSchema>;

export const AXES_MAX = 3;

export const ReportAxesPlanSchema = z
  .object({
    count: z.number().int().min(1).max(AXES_MAX),
    teacher: z
      .array(z.object({ name: z.string().min(1), left: z.string().min(1), right: z.string().min(1) }))
      .max(AXES_MAX),
  })
  .refine((plan) => plan.teacher.length <= plan.count, { message: "teacher_axes_over_count" });

export type ReportAxesPlan = z.infer<typeof ReportAxesPlanSchema>;

export const PlannedClassReportSubmissionSchema = ClassReportSchema.omit({ axes: true }).extend({
  teacherAxes: z.array(z.object({ positions: z.array(submittedPosition).min(1), why: z.string() })),
  addedAxes: z.array(submittedAxis),
});

export type PlannedClassReportSubmission = z.infer<typeof PlannedClassReportSubmissionSchema>;

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
        title: z.string().max(120),
        statement: z.string().max(2000),
        prompts: z.array(z.string().max(160)).min(1).max(6),
      }),
    )
    .min(1)
    .max(6),
});

export type TopicGen = z.infer<typeof TopicGenSchema>;
