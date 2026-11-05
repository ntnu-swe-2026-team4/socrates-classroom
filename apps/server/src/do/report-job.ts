import { DurableObject } from "cloudflare:workers";
import { z } from "zod";
import type { GroupReport, IndividualReport, StancePoint } from "@socrates/shared";
import type { Env } from "../env";
import { all, one, run } from "../db/d1";
import { oneshot } from "../providers/oneshot";

const IndividualAnalysisSchema = z.object({
  hexagon: z.array(z.object({ label: z.string(), value: z.number().min(0).max(100) })).length(6),
  arguments: z
    .array(
      z.object({
        claim: z.string(),
        reason: z.string(),
        tension: z.string(),
      }),
    )
    .max(3),
});

const HEXAGON_LABELS = ["思辨深度", "理由品質", "立場一致性", "案例運用", "自我質疑", "表達清晰"];
const MAX_ATTEMPTS = 3;
const PSEUDONYM_PREFIX = "學生";

function hashOf(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}

function hexagonFor(seed: string): { label: string; value: number }[] {
  return HEXAGON_LABELS.map((label, index) => ({
    label,
    value: 35 + (hashOf(`${seed}:${index}`) % 61),
  }));
}

export class ReportJob extends DurableObject<Env> {
  async start(): Promise<"ready" | "started"> {
    const activityId = this.ctx.id.name ?? "";
    const db = this.env.DB;
    const row = await one<{ status: string }>(db, "SELECT status FROM reports WHERE activity_id = $id", {
      id: activityId,
    });
    if (row?.status === "ready") return "ready";
    if (!row) {
      const now = new Date().toISOString();
      await run(
        db,
        "INSERT INTO reports (activity_id, status, created_at, updated_at) VALUES ($id, 'pending', $at, $at)",
        { id: activityId, at: now },
      );
    } else {
      await run(db, "UPDATE reports SET status = 'pending', updated_at = $at WHERE activity_id = $id", {
        id: activityId,
        at: new Date().toISOString(),
      });
    }
    await this.ctx.storage.delete("attempts");
    await this.ctx.storage.setAlarm(Date.now() + 50);
    return "started";
  }

  async alarm(): Promise<void> {
    await this.advance();
  }

  async advance(): Promise<void> {
    const activityId = this.ctx.id.name ?? "";
    const db = this.env.DB;
    const current = await one<{ status: string }>(db, "SELECT status FROM reports WHERE activity_id = $id", {
      id: activityId,
    });
    if (current?.status === "ready") return;

    const attempts = ((await this.ctx.storage.get<number>("attempts")) ?? 0) + 1;
    await this.ctx.storage.put("attempts", attempts);

    try {
      const report = await this.generate(db, activityId);
      await run(
        db,
        "UPDATE reports SET status = 'ready', teacher_report = $teacher, student_reports = $students, updated_at = $at WHERE activity_id = $id",
        {
          id: activityId,
          teacher: JSON.stringify({
            topicTitle: report.topicTitle,
            group: report.group,
          }),
          students: JSON.stringify(Object.fromEntries(report.students)),
          at: new Date().toISOString(),
        },
      );
    } catch {
      if (attempts >= MAX_ATTEMPTS) {
        await run(db, "UPDATE reports SET status = 'failed', updated_at = $at WHERE activity_id = $id", {
          id: activityId,
          at: new Date().toISOString(),
        });
        return;
      }
      await this.ctx.storage.setAlarm(Date.now() + attempts * 4000);
    }
  }

  private async generate(
    db: D1Database,
    activityId: string,
  ): Promise<{ topicTitle: string; group: GroupReport; students: Map<string, IndividualReport> }> {
    const activity = await one<{ title: string; statement: string; classroom_id: string }>(
      db,
      `SELECT t.title, t.statement, a.classroom_id
       FROM activities a JOIN topics t ON t.id = a.topic_id WHERE a.id = $id`,
      { id: activityId },
    );
    if (!activity) throw new Error("activity_missing");
    const topic = { title: activity.title, statement: activity.statement };
    const members = await all<{ user_id: string; joined_at: string }>(
      db,
      "SELECT user_id, joined_at FROM members WHERE classroom_id = $cid ORDER BY joined_at, user_id",
      { cid: activity.classroom_id },
    );
    const students = new Map<string, IndividualReport>();
    const points: StancePoint[] = [];

    let index = 0;
    for (const member of members) {
      const pseudonym = `${PSEUDONYM_PREFIX}${String.fromCharCode(65 + (index % 26))}`;
      index += 1;
      const existing = await one<{ pseudonym: string }>(
        db,
        "SELECT pseudonym FROM pseudonyms WHERE activity_id = $aid AND student_id = $sid",
        { aid: activityId, sid: member.user_id },
      );
      const finalPseudonym = existing?.pseudonym ?? pseudonym;
      if (!existing) {
        await run(db, "INSERT INTO pseudonyms (activity_id, student_id, pseudonym) VALUES ($aid, $sid, $p)", {
          aid: activityId,
          sid: member.user_id,
          p: finalPseudonym,
        });
      }

      const transcript = await all<{ role: string; text: string }>(
        db,
        "SELECT role, text FROM messages WHERE activity_id = $aid AND student_id = $sid ORDER BY at, rowid",
        { aid: activityId, sid: member.user_id },
      );
      const userTexts = transcript.filter((row) => row.role === "user").map((row) => row.text);
      const analysis = await oneshot(this.env, {
        system: "You analyze one student's Socratic dialogue transcript for a philosophy class. Reply with JSON only.",
        user: `Topic: ${topic.title}\nStatement: ${topic.statement}\nStudent messages:\n${userTexts
          .slice(0, 12)
          .map((text, i) => `${i + 1}. ${text}`)
          .join("\n")}`,
        schema: IndividualAnalysisSchema,
        mock: () => ({
          hexagon: hexagonFor(member.user_id),
          arguments: userTexts.slice(0, 3).map((text) => ({
            claim: text.slice(0, 60),
            reason: "對話中提出的支持理由（示例）",
            tension: "與對立立場的張力（示例）",
          })),
        }),
      });
      const violations = await all<{ turn: number; type: string; excerpt: string }>(
        db,
        "SELECT turn, type, excerpt FROM violations WHERE activity_id = $aid AND student_id = $sid ORDER BY turn",
        { aid: activityId, sid: member.user_id },
      );

      const individual: IndividualReport = {
        pseudonym: finalPseudonym,
        hexagon: analysis.hexagon,
        arguments: analysis.arguments,
        violations: violations.map((row) => ({ turn: row.turn, type: row.type, excerpt: row.excerpt })),
      };
      students.set(member.user_id, individual);
      points.push({
        pseudonym: finalPseudonym,
        values: [(individual.hexagon[2]?.value ?? 50) / 100, (individual.hexagon[0]?.value ?? 50) / 100],
        cluster: 0,
      });
    }

    points.sort((a, b) => a.values[0]! - b.values[0]!);
    const median = points.length > 1 ? points[Math.floor(points.length / 2) - 1]!.values[0]! : 1;
    for (const point of points) point.cluster = point.values[0]! <= median ? 0 : 1;

    const group: GroupReport = {
      axes: [
        { name: "後果 ↔ 義務", left: "後果", right: "義務", color: "#b45309" },
        { name: "自由 ↔ 平等", left: "自由", right: "平等", color: "#0f766e" },
      ],
      points,
      clusters: [
        { id: 0, label: "後果傾向" },
        { id: 1, label: "義務傾向" },
      ],
    };

    return { topicTitle: topic.title, group, students };
  }

  async status(): Promise<{ status: string; attempts: number }> {
    const activityId = this.ctx.id.name ?? "";
    const db = this.env.DB;
    const row = await one<{ status: string }>(db, "SELECT status FROM reports WHERE activity_id = $id", {
      id: activityId,
    });
    return { status: row?.status ?? "none", attempts: (await this.ctx.storage.get<number>("attempts")) ?? 0 };
  }
}
