import type { ReportAxesPlan } from "../pi/extensions/report-submit";

export interface Topic {
  title: string;
  statement: string;
}

export function topicBlock(title: string, statement: string): string {
  return `## Topic: ${title}\n${statement}`;
}

export function section(name: string, body: string): string {
  return `## ${name}\n${body}`;
}

export function studentReportInput(activity: { title: string; statement: string }, transcript: string): string {
  return [topicBlock(activity.title, activity.statement), section("Conversation", transcript)].join("\n\n");
}

export function axesBlock(plan: ReportAxesPlan): string {
  const set = plan.teacher.length === 0 ? "none" : String(plan.teacher.length);
  const lines = plan.teacher.map(
    ({ name, left, right }, index) =>
      `${index + 1}. ${JSON.stringify(name)}: left end ${JSON.stringify(left)}, right end ${JSON.stringify(right)}`,
  );
  return section(`Axes: ${plan.count} in total; the teacher set ${set}`, lines.join("\n")).trimEnd();
}

export function classReportInput(
  activity: { title: string; statement: string },
  roster: string[],
  conversations: Array<{ id: string; transcript: string }>,
  plan?: ReportAxesPlan,
): string {
  return [
    topicBlock(activity.title, activity.statement),
    ...(plan ? [axesBlock(plan)] : []),
    section(`Roster: ${roster.length} students in the class`, roster.join(", ")),
    section(
      "The whole class's conversations",
      conversations.map(({ id, transcript }) => `### ${id}\n${transcript}`).join("\n\n"),
    ),
  ].join("\n\n");
}
