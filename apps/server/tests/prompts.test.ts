import { describe, expect, it } from "vitest";
import { instructionsFor } from "../src/pi/agents/profiles";
import { SOCRATES_PROMPTS } from "../src/pi/extensions/socrates";
import { classReportInput, studentReportInput } from "../src/prompts/assemble";
import { z } from "zod";
import { ClassReportSubmissionSchema, StudentAnalysisSchema, ThinkingIndicatorsSchema } from "@socrates/shared";
import { PlannedClassReportSubmissionSchema } from "../src/pi/extensions/report-submit";
import STUDENT_REPORT_RAW from "../src/prompts/student-report.md?raw";
import CLASS_REPORT_RAW from "../src/prompts/class-report.md?raw";
import CLASS_REPORT_AXES_RAW from "../src/prompts/class-report-axes.md?raw";
import STUDENT_INDICATORS_RAW from "../src/prompts/student-indicators.md?raw";

const LANGS = ["zh", "en", "es"] as const;
const activity = { title: "代理孕母", statement: "契約應該被遵守嗎？" };

describe("prompts (#161): what the report models receive is pinned", () => {
  for (const name of ["student-report", "student-indicators", "class-report", "class-report-axes"] as const) {
    for (const lang of LANGS) {
      it(`${name} instructions in ${lang}`, () => {
        expect(instructionsFor(name, lang)).toMatchSnapshot();
      });
    }
  }

  it("report inputs", () => {
    expect(studentReportInput(activity, "學生1（1）：契約要守")).toMatchSnapshot();
    expect(
      classReportInput(
        activity,
        ["學生1", "學生2"],
        [
          { id: "學生1", transcript: "學生1（1）：契約要守" },
          { id: "學生2", transcript: "學生2（1）：人情優先" },
        ],
      ),
    ).toMatchSnapshot();
  });

  it("the existing report tools' JSON schemas are pinned", () => {
    expect(z.toJSONSchema(ClassReportSubmissionSchema)).toMatchSnapshot();
    expect(z.toJSONSchema(z.object({ report: StudentAnalysisSchema }))).toMatchSnapshot();
  });

  it("the indicators tool's JSON schema is pinned", () => {
    expect(z.toJSONSchema(ThinkingIndicatorsSchema)).toMatchSnapshot();
  });

  it("the axes-plan report tool's JSON schema is pinned", () => {
    expect(z.toJSONSchema(PlannedClassReportSubmissionSchema)).toMatchSnapshot();
  });

  it("class report input with an axes plan: the count and the teacher's axes follow the topic", () => {
    const conversations = [{ id: "學生1", transcript: "學生1（1）：契約要守" }];
    expect(
      classReportInput(activity, ["學生1"], conversations, {
        count: 3,
        teacher: [{ name: "契約與承諾", left: "契約至上", right: "人情優先" }],
      }),
    ).toMatchSnapshot();
    expect(classReportInput(activity, ["學生1"], conversations, { count: 2, teacher: [] })).toMatchSnapshot();
  });

  for (const lang of LANGS) {
    it(`socrates instructions in ${lang}: one file per language, no placeholder`, () => {
      expect(SOCRATES_PROMPTS[lang]).not.toMatch(/{{[^}]*}}/);
      expect(SOCRATES_PROMPTS[lang]).toMatchSnapshot();
    });
  }

  it("report prompt assets hold {{lang}} and no other placeholder", () => {
    for (const raw of [STUDENT_REPORT_RAW, STUDENT_INDICATORS_RAW, CLASS_REPORT_RAW, CLASS_REPORT_AXES_RAW]) {
      expect(raw).toContain("{{lang}}");
      expect(raw.match(/{{[^}]*}}/g)?.filter((placeholder) => placeholder !== "{{lang}}") ?? []).toEqual([]);
    }
  });
});
