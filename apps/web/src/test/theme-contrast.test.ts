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
    const name = match[1];
    const value = match[2];
    if (name === undefined || value === undefined) continue;
    vars.set(name, value.trim());
  }
  return vars;
}

const light = themeBlock("@theme");
const dark = themeBlock('[data-theme="dark"]');

const textTokens = ["ink", "ink-soft", "ink-faint"] as const;
const backgrounds = ["paper", "card", "paper-deep"] as const;
const washBackgrounds = ["paper", "card"] as const;
const accentTokens = ["ember", "moss"] as const;

type Rgb = { r: number; g: number; b: number; alpha: number };

function parseWash(value: string): Rgb {
  const match = value.match(/^rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*\/\s*([\d.]+)\s*\)$/);
  if (!match) throw new Error(`unsupported wash syntax: ${value}`);
  return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]), alpha: Number(match[4]) };
}

function composite(wash: Rgb, bgHex: string): string {
  const bg = [1, 3, 5].map((i) => Number.parseInt(bgHex.slice(i, i + 2) ?? "0", 16));
  const channels: Array<keyof Rgb> = ["r", "g", "b"];
  const hex = channels.map((ch, i) =>
    Math.round(wash.alpha * wash[ch] + (1 - wash.alpha) * (bg[i] ?? 0))
      .toString(16)
      .padStart(2, "0"),
  );
  return `#${hex.join("")}`;
}

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2) ?? "0", 16) / 255);
  const linear = channels.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * (linear[0] ?? 0) + 0.7152 * (linear[1] ?? 0) + 0.0722 * (linear[2] ?? 0);
}

function contrast(fg: string, bg: string): number {
  const [hi = 0, lo = 0] = [relativeLuminance(fg), relativeLuminance(bg)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}

function demandVar(vars: Map<string, string>, key: string, mode: string): string {
  const value = vars.get(key);
  expect(value, `--color-${key} missing in ${mode} theme`).toBeDefined();
  if (value === undefined) throw new Error(`--color-${key} missing in ${mode} theme`);
  return value;
}

describe.each([
  ["light", light],
  ["dark", dark],
] as const)("theme text contrast (%s)", (mode, vars) => {
  it.each(textTokens)("%s reaches WCAG 2.1 AA (4.5:1) on every app background", (token) => {
    for (const bg of backgrounds) {
      const fg = demandVar(vars, token, mode);
      const bgValue = demandVar(vars, bg, mode);
      expect(contrast(fg, bgValue)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(accentTokens)("%s text reaches AA on every background and its wash", (token) => {
    const fg = demandVar(vars, token, mode);
    for (const bg of backgrounds) {
      const bgValue = demandVar(vars, bg, mode);
      expect(contrast(fg, bgValue)).toBeGreaterThanOrEqual(4.5);
    }
    for (const bg of washBackgrounds) {
      const bgValue = demandVar(vars, bg, mode);
      const wash = parseWash(demandVar(vars, `${token}-wash`, mode));
      expect(contrast(fg, composite(wash, bgValue))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("on-ember reaches AA on the solid ember fill", () => {
    const onEmber = demandVar(vars, "on-ember", mode);
    const ember = demandVar(vars, "ember", mode);
    expect(contrast(onEmber, ember)).toBeGreaterThanOrEqual(4.5);
  });
});
