import type { Axis, StudentAnalysis } from "@socrates/shared";

/**
 * Every frame of a model's input — the fixed headings and labels around the data — is defined here and nowhere else
 * (#161). What each model is told to do lives in the prompts/*.md files; these functions only lay the data out as text.
 */

export function topicBlock(title: string, statement: string): string {
  return `## Topic: ${title}\n${statement}`;
}

export function section(name: string, body: string): string {
  return `## ${name}\n${body}`;
}

/** One part of a student's report with the lines it rests on, or "none". */
function reportPart(name: string, part: { text: string; turns: number[] } | null): string {
  return part ? `${name} (turns ${part.turns.join(", ")}): ${part.text}` : `${name}: none`;
}

/** The student-report input: the topic and the student's numbered conversation. */
export function studentReportInput(activity: { title: string; statement: string }, transcript: string): string {
  return [topicBlock(activity.title, activity.statement), section("Conversation", transcript)].join("\n\n");
}

/**
 * The class-report input: the topic, the teacher's axes (only when the teacher sets them; without `axes` the model sets
 * its own), the students who stated a position, and each one's report.
 */
export function classReportInput(
  activity: { title: string; statement: string; axes?: Axis[] },
  stated: Array<{ id: string; analysis: Extract<StudentAnalysis, { stated: true }> }>,
): string {
  const axes = activity.axes?.length
    ? activity.axes.map((axis, index) => `${index + 1}. ${axis.name}: left = ${axis.left}; right = ${axis.right}`)
    : ["(none: the teacher set no axes, so axes is an empty array)"];
  const reports = stated
    .map(({ id, analysis }) =>
      [
        `### ${id}`,
        reportPart("Claim", analysis.claim),
        reportPart("Reasons", analysis.reasons),
        reportPart("Tension", analysis.tension),
      ].join("\n"),
    )
    .join("\n\n");
  return [
    topicBlock(activity.title, activity.statement),
    ...(activity.axes ? [section("The teacher's axes", axes.join("\n"))] : []),
    section(`Roster: ${stated.length} students who stated a position`, stated.map(({ id }) => id).join(", ")),
    section("Each student's report", reports),
  ].join("\n\n");
}
