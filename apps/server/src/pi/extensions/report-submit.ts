import { defineExtension, defineTool } from "@earendil-works/pi-durable";
import { z } from "zod";
import {
  ClassReportSchema,
  ClassReportSubmissionSchema,
  EngagementSchema,
  StudentAnalysisSchema,
  ThinkingIndicatorsSchema,
} from "@socrates/shared";

export const SUBMIT_STUDENT_ANALYSIS = "submit_student_analysis";
export const SUBMIT_CLASS_REPORT = "submit_class_report";
export const SUBMIT_CLASS_AXES_REPORT = "submit_class_axes_report";
export const SUBMIT_STUDENT_INDICATORS = "submit_student_indicators";
export const SUBMIT_STUDENT_ENGAGEMENT = "submit_student_engagement";

export const ReportAxesPlanSchema = z
  .object({
    count: z.number().int().min(1).max(3),
    teacher: z.array(z.object({ name: z.string(), left: z.string(), right: z.string() })),
  })
  .refine((plan) => plan.teacher.length <= plan.count, { message: "teacher_axes_over_count" });

export type ReportAxesPlan = z.infer<typeof ReportAxesPlanSchema>;

const submittedAxis = ClassReportSubmissionSchema.shape.axes.element;

export const PlannedClassReportSubmissionSchema = z.object({
  students: ClassReportSchema.shape.students,
  unstated: ClassReportSchema.shape.unstated,
  teacherAxes: z.array(
    z.object({
      positions: z.array(submittedAxis.shape.positions.element).min(1),
      why: z.string(),
    }),
  ),
  addedAxes: z.array(submittedAxis),
  overview: ClassReportSchema.shape.overview,
});

export type PlannedClassReportSubmission = z.infer<typeof PlannedClassReportSubmissionSchema>;

const studentAnalysisParameters = z.toJSONSchema(z.object({ report: StudentAnalysisSchema }));
const classReportParameters = z.toJSONSchema(ClassReportSubmissionSchema);
const classAxesReportParameters = z.toJSONSchema(PlannedClassReportSubmissionSchema);
const studentIndicatorsParameters = z.toJSONSchema(ThinkingIndicatorsSchema);
const studentEngagementParameters = z.toJSONSchema(EngagementSchema);

const submitStudentAnalysis = defineTool({
  name: SUBMIT_STUDENT_ANALYSIS,
  description:
    "Submit one student's report as your final action. The report's shape is this tool's schema: stated, and for a stated position claim/reasons/tension with the student's line numbers as turns, or what they did instead. Calling it ends the turn; do not also write the report as text.",
  parameters: studentAnalysisParameters,
  constrainedSampling: { type: "json_schema", strict: "prefer" },
  replay: "safe",
  async execute() {
    return { control: { terminate: true } };
  },
});

const submitClassReport = defineTool({
  name: SUBMIT_CLASS_REPORT,
  description:
    "Submit the class report as your final action. The report's shape is this tool's schema: per-student summaries, unstated ids, the position axes with each student's stance, and the overview. Calling it ends the turn; do not also write the report as text.",
  parameters: classReportParameters,
  constrainedSampling: { type: "json_schema", strict: "prefer" },
  replay: "safe",
  async execute() {
    return { control: { terminate: true } };
  },
});

const submitClassAxesReport = defineTool({
  name: SUBMIT_CLASS_AXES_REPORT,
  description:
    "Submit the class report as your final action. The report's shape is this tool's schema: per-student summaries, unstated ids, the positions on each of the teacher's axes in order, the axes you add with each student's stance, and the overview. Calling it ends the turn; do not also write the report as text.",
  parameters: classAxesReportParameters,
  constrainedSampling: { type: "json_schema", strict: "prefer" },
  replay: "safe",
  async execute() {
    return { control: { terminate: true } };
  },
});

export const reportSubmitExtension = defineExtension({
  name: "report-submit",
  tools: [submitStudentAnalysis, submitClassReport],
});

export const reportSubmitAxesExtension = defineExtension({
  name: "report-submit-axes",
  tools: [submitClassAxesReport],
});

const submitStudentIndicators = defineTool({
  name: SUBMIT_STUDENT_INDICATORS,
  description:
    "Submit one student's six thinking indicators as your final action. The shape is this tool's schema: for each of c1, c2, s1, s2, a1, a2, a level from 0 to 3, the student's line numbers as turns, and one sentence of evidence. Calling it ends the turn; do not also write the indicators as text.",
  parameters: studentIndicatorsParameters,
  constrainedSampling: { type: "json_schema", strict: "prefer" },
  replay: "safe",
  async execute() {
    return { control: { terminate: true } };
  },
});

export const reportSubmitIndicatorsExtension = defineExtension({
  name: "report-submit-indicators",
  tools: [submitStudentIndicators],
});

const submitStudentEngagement = defineTool({
  name: SUBMIT_STUDENT_ENGAGEMENT,
  description:
    "Submit one student's engagement as your final action. The shape is this tool's schema: for each of substance, uptake, focus, a level from 0 to 3, the student's line numbers as turns, and one sentence of evidence. Calling it ends the turn; do not also write the engagement as text.",
  parameters: studentEngagementParameters,
  constrainedSampling: { type: "json_schema", strict: "prefer" },
  replay: "safe",
  async execute() {
    return { control: { terminate: true } };
  },
});

export const reportSubmitEngagementExtension = defineExtension({
  name: "report-submit-engagement",
  tools: [submitStudentEngagement],
});
