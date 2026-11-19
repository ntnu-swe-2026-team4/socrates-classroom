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
  /**
   * The value axes (low = the axis' left end, high = its right end), each with the positions of the students whose
   * report speaks to it. Set by the teacher: the topic's axes in its order, and an axis no report speaks to has no
   * positions. Set by the model: its axes for this class, each with why it is needed and at least one position.
   */
  axes: z.array(
    z.object({
      name: z.string(),
      low: z.string(),
      high: z.string(),
      positions: z.array(position),
      why: z.string().optional(),
    }),
  ),
  overview: z.array(z.string()).min(1),
});

export type ClassReport = z.infer<typeof ClassReportSchema>;

/**
 * What the class-report model writes: the positions on each of the teacher's axes (axis = its number in the topic's
 * list, from 1) and the overview. The axes themselves come from the topic, and students/unstated from the per-student
 * analyses, so neither is the model's to decide.
 */
/**
 * A position as the model writes it: which of the teacher's ends, named as the teacher names them (left/right), and how
 * firmly (1 barely leans .. 5 fully at that end). The stored end (low/high) and point on the axis (at) are computed
 * from these. Asked for a point and low/high directly, glm-5.3-flash mixed up "point" with "how firmly" (27 of 38
 * students in one class), and read "high" as "more for the topic's action" (a whole class placed on the wrong ends).
 */
const placement = z.object({
  id: z.string(),
  turns,
  view: z.string(),
  side: z.enum(["left", "middle", "right"]),
  strength: z.number().int().min(1).max(5),
});

export const ClassPlacementSchema = z.object({
  axes: z.array(z.object({ axis: z.number().int(), positions: z.array(placement) })),
  overview: z.array(z.string()).min(1),
});

export type ClassPlacement = z.infer<typeof ClassPlacementSchema>;

/** What the class-report model writes when it sets the axes itself: each axis, its ends, why, and the positions. */
export const ClassAxesPlacementSchema = z.object({
  axes: z.array(
    z.object({
      name: z.string(),
      left: z.string(),
      right: z.string(),
      positions: z.array(placement),
      why: z.string(),
    }),
  ),
  overview: z.array(z.string()).min(1),
});

export type ClassAxesPlacement = z.infer<typeof ClassAxesPlacementSchema>;

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
