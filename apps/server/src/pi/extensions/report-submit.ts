import { validateToolArguments } from "@earendil-works/pi-ai";
import { defineExtension, defineTool } from "@earendil-works/pi-durable";
import { z } from "zod";
import { ClassAxesPlacementSchema, ClassPlacementSchema, StudentAnalysisSchema } from "@socrates/shared";
import { gatewayConfig } from "../../gateway/config.gen";

export const SUBMIT_STUDENT_ANALYSIS = "submit_student_analysis";
export const SUBMIT_CLASS_REPORT = "submit_class_report";

const studentAnalysisParameters = z.toJSONSchema(z.object({ report: StudentAnalysisSchema }));
/** Who sets the axes is the deployment's setting (report.axes), so the class tool's shape is fixed per deployment. */
export const REPORT_AXES = gatewayConfig.report.axes;
const classReportParameters = z.toJSONSchema(
  REPORT_AXES === "teacher" ? ClassPlacementSchema : ClassAxesPlacementSchema,
);

type JsonSchemaNode = {
  type?: string | string[];
  properties?: Record<string, JsonSchemaNode>;
  items?: JsonSchemaNode;
  anyOf?: JsonSchemaNode[];
  oneOf?: JsonSchemaNode[];
};

function expectsStructure(schema: JsonSchemaNode): boolean {
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  if (types.includes("object") || types.includes("array")) return true;
  return [...(schema.anyOf ?? []), ...(schema.oneOf ?? [])].some(expectsStructure);
}

/**
 * Some models send an object or array field as a JSON string (`"report": "{\"stated\": ...}"`) and keep doing so after
 * the validation error. Where the schema expects an object or array and a string arrives, parse it; anything that does
 * not parse is left as is for validation to reject. Pure: builds new values and never mutates its input.
 */
export function parseStringifiedStructures(value: unknown, schema: JsonSchemaNode): unknown {
  let current = value;
  if (typeof current === "string" && expectsStructure(schema)) {
    try {
      current = JSON.parse(current);
    } catch {
      return value;
    }
  }
  if (Array.isArray(current)) {
    return schema.items ? current.map((item) => parseStringifiedStructures(item, schema.items!)) : current;
  }
  if (current !== null && typeof current === "object") {
    const branches = [schema, ...(schema.anyOf ?? []), ...(schema.oneOf ?? [])];
    const properties = Object.assign({}, ...branches.map((branch) => branch.properties ?? {})) as Record<
      string,
      JsonSchemaNode
    >;
    return Object.fromEntries(
      Object.entries(current).map(([key, field]) => [
        key,
        properties[key] ? parseStringifiedStructures(field, properties[key]) : field,
      ]),
    );
  }
  return current;
}

/** The submit tools' argument repair, also applied by the report runner to the payload it reads back. */
export const prepareSubmitArguments: Record<string, (args: unknown) => unknown> = {
  [SUBMIT_STUDENT_ANALYSIS]: (args) => parseStringifiedStructures(args, studentAnalysisParameters as JsonSchemaNode),
  [SUBMIT_CLASS_REPORT]: (args) => parseStringifiedStructures(args, classReportParameters as JsonSchemaNode),
};

const submitParameters: Record<string, unknown> = {
  [SUBMIT_STUDENT_ANALYSIS]: studentAnalysisParameters,
  [SUBMIT_CLASS_REPORT]: classReportParameters,
};

/**
 * A submit call's arguments as the tool received them: the transcript keeps them as the model sent them, before pi's
 * argument repair and its schema coercion ("3" -> 3, 3 -> [3]). Both are applied again here, so a call the tool
 * accepted is not rejected by the runner's own parse. Throws when the arguments do not fit the schema.
 */
export function submittedArguments(tool: string, args: unknown): unknown {
  const prepare = prepareSubmitArguments[tool];
  const parameters = submitParameters[tool];
  if (!prepare || !parameters) return args;
  return validateToolArguments(
    { name: tool, description: "", parameters } as never,
    { type: "toolCall", id: "", name: tool, arguments: prepare(args) } as never,
  );
}

const submitStudentAnalysis = defineTool({
  name: SUBMIT_STUDENT_ANALYSIS,
  description:
    "Submit one student's report as your final action. The report's shape is this tool's schema: stated, and for a stated position claim/reasons/tension with the student's line numbers as turns, or what they did instead. Calling it ends the turn; do not also write the report as text.",
  parameters: studentAnalysisParameters,
  constrainedSampling: { type: "json_schema", strict: "prefer" },
  replay: "safe",
  prepareArguments: (args) => prepareSubmitArguments[SUBMIT_STUDENT_ANALYSIS]!(args) as never,
  async execute() {
    return { control: { terminate: true } };
  },
});

const submitClassReport = defineTool({
  name: SUBMIT_CLASS_REPORT,
  description:
    REPORT_AXES === "teacher"
      ? "Submit the class report as your final action. The report's shape is this tool's schema: for each of the teacher's axes (by its number) the positions of the students whose report speaks to it, and the overview. Calling it ends the turn; do not also write the report as text."
      : "Submit the class report as your final action. The report's shape is this tool's schema: the position axes you set for this class, each with the positions of the students whose report speaks to it and why it is needed, and the overview. Calling it ends the turn; do not also write the report as text.",
  parameters: classReportParameters,
  constrainedSampling: { type: "json_schema", strict: "prefer" },
  replay: "safe",
  prepareArguments: (args) => prepareSubmitArguments[SUBMIT_CLASS_REPORT]!(args) as never,
  async execute() {
    return { control: { terminate: true } };
  },
});

export const reportSubmitExtension = defineExtension({
  name: "report-submit",
  tools: [submitStudentAnalysis, submitClassReport],
});
