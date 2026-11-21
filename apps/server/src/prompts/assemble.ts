export function topicBlock(title: string, statement: string): string {
  return `## Topic: ${title}\n${statement}`;
}

export function section(name: string, body: string): string {
  return `## ${name}\n${body}`;
}

export function studentReportInput(activity: { title: string; statement: string }, transcript: string): string {
  return [topicBlock(activity.title, activity.statement), section("Conversation", transcript)].join("\n\n");
}

export function classReportInput(
  activity: { title: string; statement: string },
  roster: string[],
  conversations: Array<{ id: string; transcript: string }>,
): string {
  return [
    topicBlock(activity.title, activity.statement),
    section(`Roster: ${roster.length} students in the class`, roster.join(", ")),
    section(
      "The whole class's conversations",
      conversations.map(({ id, transcript }) => `### ${id}\n${transcript}`).join("\n\n"),
    ),
  ].join("\n\n");
}
