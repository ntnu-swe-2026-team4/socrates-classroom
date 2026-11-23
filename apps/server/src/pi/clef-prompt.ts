export interface ClefChoicePrompt<K extends string> {
  instructions: string;
  criteria: Record<K, string>;
}

const CRITERION = /^- (\w+): (.+)$/;

export function clefChoicePrompt<K extends string>(asset: string, choices: readonly K[]): ClefChoicePrompt<K> {
  const lines = asset.trim().split("\n");
  const start = lines.findIndex((line) => CRITERION.test(line));
  const instructions = lines
    .slice(0, start === -1 ? lines.length : start)
    .join("\n")
    .trim();
  const criteria: Record<string, string> = {};
  for (const line of start === -1 ? [] : lines.slice(start)) {
    const match = CRITERION.exec(line);
    if (!match) throw new Error(`clef_prompt: not a "- choice: criterion" line: ${line}`);
    criteria[match[1]] = match[2];
  }
  const found = Object.keys(criteria);
  if (instructions === "" || found.length !== choices.length || choices.some((choice) => !(choice in criteria))) {
    throw new Error(`clef_prompt: expected choices ${choices.join(", ")}, found ${found.join(", ")}`);
  }
  return { instructions, criteria: criteria as Record<K, string> };
}
