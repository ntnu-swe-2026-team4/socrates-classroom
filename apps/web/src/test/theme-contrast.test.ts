import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../index.css"), "utf8");

function themeBlock(selector: string): Map<string, string> {
  const start = css.indexOf(selector);
  if (start === -1) throw new Error(`theme block not found: ${selector}`);
  const open = css.indexOf("{", start);
  let depth = 0;
  let end = open;
  for (; end < css.length; end++) {
    if (css[end] === "{") depth++;
    if (css[end] === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  const vars = new Map<string, string>();
  for (const match of css.slice(open, end).matchAll(/--color-([\w-]+):\s*([^;]+);/g)) {
    vars.set(match[1], match[2].trim());
  }
  return vars;
}

const light = themeBlock("@theme");
const dark = themeBlock('[data-theme="dark"]');

const textTokens = ["ink", "ink-soft", "ink-faint"] as const;
const backgrounds = ["paper", "card", "paper-deep"] as const;

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255);
  const linear = channels.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(fg: string, bg: string): number {
  const [hi, lo] = [relativeLuminance(fg), relativeLuminance(bg)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}

describe.each([
  ["light", light],
  ["dark", dark],
] as const)("theme text contrast (%s)", (mode, vars) => {
  it.each(textTokens)("%s reaches WCAG 2.1 AA (4.5:1) on every app background", (token) => {
    for (const bg of backgrounds) {
      const fg = vars.get(token);
      const bgValue = vars.get(bg);
      expect(fg, `--color-${token} missing in ${mode} theme`).toMatch(/^#[0-9a-f]{6}$/i);
      expect(bgValue, `--color-${bg} missing in ${mode} theme`).toMatch(/^#[0-9a-f]{6}$/i);
      const ratio = contrast(fg as string, bgValue as string);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    }
  });
});
