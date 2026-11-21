import { defineExtension, defineTool } from "@earendil-works/pi-durable";
import { z } from "zod";
import {
  ClassReportSubmissionSchema,
  PlannedClassReportSubmissionSchema,
  StudentAnalysisSchema,
} from "@socrates/shared";

export const SUBMIT_STUDENT_ANALYSIS = "submit_student_analysis";
export const SUBMIT_CLASS_REPORT = "submit_class_report";
export const SUBMIT_CLASS_AXES_REPORT = "submit_class_axes_report";

const studentAnalysisParameters = z.toJSONSchema(z.object({ report: StudentAnalysisSchema }));
const classReportParameters = z.toJSONSchema(ClassReportSubmissionSchema);
const classAxesReportParameters = z.toJSONSchema(PlannedClassReportSubmissionSchema);

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
