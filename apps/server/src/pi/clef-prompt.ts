export interface ClefChoicePrompt<K extends string> {
  instructions: string;
  criteria: Record<K, string>;
}

const CRITERION = /^- (\w+): (.+)$/;

export function clefChoicePrompt<K extends string>(asset: string): ClefChoicePrompt<K> {
  const lines = asset.replace(/\r\n?/g, "\n").trim().split("\n");
  const start = lines.findIndex((line) => CRITERION.test(line));
  const instructions = lines
    .slice(0, start === -1 ? lines.length : start)
    .join("\n")
    .trim();
  const criteria: Record<string, string> = {};
  for (const line of start === -1 ? [] : lines.slice(start)) {
    const match = CRITERION.exec(line);
    if (match) criteria[match[1]] = match[2];
  }
  return { instructions, criteria: criteria as Record<K, string> };
}
