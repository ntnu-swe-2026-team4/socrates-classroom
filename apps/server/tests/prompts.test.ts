import { describe, expect, it } from "vitest";
import { instructionsFor } from "../src/pi/agents/profiles";
import { classReportInput, studentReportInput } from "../src/prompts/assemble";
import STUDENT_REPORT_RAW from "../src/prompts/student-report.md?raw";
import CLASS_REPORT_RAW from "../src/prompts/class-report.md?raw";
import CLASS_REPORT_AI_RAW from "../src/prompts/class-report-ai.md?raw";

// #161 §7: what each model receives is pinned here. A pure tidy-up leaves these snapshots unchanged; a prompt change
// shows up as their diff, and that diff is what the PR is reviewed on.

const LANGS = ["zh", "en", "es"] as const;

const activity = {
  title: "代理孕母",
  statement: "契約應該被遵守嗎？",
  axes: [
    { name: "契約與人情", left: "契約優先", right: "人情優先" },
    { name: "誰決定", left: "當事人", right: "社會" },
  ],
};
const stated = [
  {
    id: "學生1",
    analysis: {
      stated: true as const,
      claim: { text: "契約要守", turns: [1, 2] },
      reasons: { text: "雙方同意", turns: [2] },
      tension: null,
    },
  },
  {
    id: "學生2",
    analysis: {
      stated: true as const,
      claim: { text: "人情優先", turns: [1] },
      reasons: { text: "孩子的利益", turns: [1, 3] },
      tension: { text: "說不出界線", turns: [3] },
    },
  },
];

describe("prompts (#161)", () => {
  for (const name of ["student-report", "class-report", "class-report-ai", "topic-gen", "lookup"] as const) {
    for (const lang of LANGS) {
      it(`${name} instructions in ${lang}`, () => {
        expect(instructionsFor(name, lang)).toMatchSnapshot();
      });
    }
  }

  it("report inputs", () => {
    expect(studentReportInput(activity, "學生1（1）：契約要守")).toMatchSnapshot();
    expect(classReportInput(activity, stated)).toMatchSnapshot();
    // axes set by the model: no teacher's axes in its input
    expect(classReportInput({ title: activity.title, statement: activity.statement }, stated)).toMatchSnapshot();
  });

  // §3. topic-gen and lookup still state the language in their input ("Write in X"); listed as not yet done in #161.
  it("single-language prompt assets hold {{lang}} and no other placeholder", () => {
    for (const raw of [STUDENT_REPORT_RAW, CLASS_REPORT_RAW, CLASS_REPORT_AI_RAW]) {
      expect(raw).toContain("{{lang}}");
      expect(raw.match(/{{[^}]*}}/g)?.filter((p) => p !== "{{lang}}") ?? []).toEqual([]);
    }
  });
});
