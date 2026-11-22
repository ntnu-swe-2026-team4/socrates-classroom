export interface ClefChoicePrompt {
  instructions: string;
  criteria: Record<string, string>;
}

const CRITERION = /^- (\w+): (.+)$/;

export function clefChoicePrompt(asset: string, keys: readonly string[]): ClefChoicePrompt {
  const lines = asset.replace(/\r\n?/g, "\n").trim().split("\n");
  const start = lines.findIndex((line) => CRITERION.test(line));
  const instructions = lines
    .slice(0, start === -1 ? lines.length : start)
    .join("\n")
    .trim();
  const parsed = new Map<string, string>();
  for (const line of start === -1 ? [] : lines.slice(start)) {
    const match = CRITERION.exec(line);
    if (match) parsed.set(match[1], match[2]);
  }
  const missing = keys.filter((key) => !parsed.has(key));
  if (missing.length > 0) throw new Error(`clef prompt criteria missing keys: ${missing.join(", ")}`);
  const criteria: Record<string, string> = {};
  for (const key of keys) criteria[key] = parsed.get(key) ?? "";
  return { instructions, criteria };
}
