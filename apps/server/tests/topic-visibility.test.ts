import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { inject } from "vitest";
import { all, run } from "../src/db/d1";
import { seedFixture } from "../src/seed";
import { must } from "./helpers";
import {
  copyableTopic,
  type TopicIdentity,
  type TopicScope,
  topicPoolSql,
  topicScope,
  topicVisibleTo,
} from "../src/services/topic-visibility";

const migrations = inject("d1Migrations");

const LIN = "u_fx_lin";
const CHEN = "u_fx_chen";
const LIN_CLASS = "c_v_lin";
const CHEN_CLASS = "c_v_chen";

interface Row extends TopicIdentity {
  id: string;
}

const DELETED_AT = "2026-11-23T00:00:00.000Z";

const SYSTEM_ROW: Row = { id: "t_v_system", owner_id: null, classroom_id: null, deleted_at: null };
const PERSONAL_LIN_ROW: Row = { id: "t_v_personal_lin", owner_id: LIN, classroom_id: null, deleted_at: null };
const PERSONAL_CHEN_ROW: Row = { id: "t_v_personal_chen", owner_id: CHEN, classroom_id: null, deleted_at: null };
const CLASS_LIN_ROW: Row = { id: "t_v_class_lin", owner_id: LIN, classroom_id: LIN_CLASS, deleted_at: null };
const CLASS_CHEN_ROW: Row = { id: "t_v_class_chen", owner_id: CHEN, classroom_id: CHEN_CLASS, deleted_at: null };
const DELETED_CLASS_ROW: Row = {
  id: "t_v_deleted_class_lin",
  owner_id: LIN,
  classroom_id: LIN_CLASS,
  deleted_at: DELETED_AT,
};
const DELETED_PERSONAL_ROW: Row = {
  id: "t_v_deleted_personal_lin",
  owner_id: LIN,
  classroom_id: null,
  deleted_at: DELETED_AT,
};
const ROWS: Row[] = [
  SYSTEM_ROW,
  PERSONAL_LIN_ROW,
  PERSONAL_CHEN_ROW,
  CLASS_LIN_ROW,
  CLASS_CHEN_ROW,
  DELETED_CLASS_ROW,
  DELETED_PERSONAL_ROW,
];

beforeAll(async () => {
  await applyD1Migrations(env.DB, migrations);
  await seedFixture(env.DB);
  for (const [id, teacher, code] of [
    [LIN_CLASS, LIN, "vis-lin"],
    [CHEN_CLASS, CHEN, "vis-chen"],
  ] as const) {
    await run(
      env.DB,
      "INSERT INTO classrooms (id, name, teacher_id, join_code, current_activity_id, created_at) VALUES ($id, $name, $tid, $code, NULL, $at)",
      { id, name: id, tid: teacher, code, at: new Date().toISOString() },
    );
  }
  for (const row of ROWS) {
    await run(
      env.DB,
      "INSERT INTO topics (id, owner_id, classroom_id, title, statement, prompts, axes, deleted_at, created_at) VALUES ($id, $uid, $cid, $title, $statement, $prompts, $axes, $deleted, $at)",
      {
        id: row.id,
        uid: row.owner_id,
        cid: row.classroom_id,
        title: row.id,
        statement: row.id,
        prompts: "[]",
        axes: "[]",
        deleted: row.deleted_at,
        at: new Date().toISOString(),
      },
    );
  }
});

async function poolIds(
  scopes: readonly TopicScope[],
  subject: { userId: string; classroomId?: string },
): Promise<string[]> {
  const filter = topicPoolSql(scopes, subject);
  const rows = await all<{ id: string }>(
    env.DB,
    `SELECT id FROM topics WHERE id LIKE 't_v_%' AND ${filter.sql} ORDER BY id`,
    filter.params,
  );
  return rows.map((row) => row.id);
}

function predicateIds(scopes: readonly TopicScope[], subject: { userId: string; classroomId?: string }): string[] {
  return ROWS.filter((row) => scopes.includes(topicScope(row)) && topicVisibleTo(row, subject))
    .map((row) => row.id)
    .sort((a, b) => a.localeCompare(b));
}

describe("topic visibility: the (owner_id, classroom_id) state machine lives in one place", () => {
  it("classifies every identity into exactly one pool", () => {
    expect(topicScope({ owner_id: null, classroom_id: null, deleted_at: null })).toBe("system");
    expect(topicScope({ owner_id: LIN, classroom_id: null, deleted_at: null })).toBe("personal");
    expect(topicScope({ owner_id: null, classroom_id: LIN_CLASS, deleted_at: null })).toBe("classroom");
    expect(topicScope({ owner_id: LIN, classroom_id: LIN_CLASS, deleted_at: null })).toBe("classroom");
  });

  it("a soft-deleted topic is visible to nobody and in no pool", async () => {
    const deleted = must(
      ROWS.find((row) => row.id === "t_v_deleted_class_lin"),
      "deleted topic row",
    );
    expect(topicVisibleTo(deleted, { userId: LIN, classroomId: LIN_CLASS })).toBe(false);
    expect(await poolIds(["classroom"], { userId: LIN, classroomId: LIN_CLASS })).toEqual(["t_v_class_lin"]);
    expect(await poolIds(["system", "personal"], { userId: LIN })).toEqual(["t_v_personal_lin", "t_v_system"]);
  });

  it("a system topic is readable by anyone, a personal topic only by its owner", () => {
    expect(topicVisibleTo(SYSTEM_ROW, { userId: LIN })).toBe(true);
    expect(topicVisibleTo(SYSTEM_ROW, { userId: "u_stranger" })).toBe(true);
    expect(topicVisibleTo(PERSONAL_LIN_ROW, { userId: LIN })).toBe(true);
    expect(topicVisibleTo(PERSONAL_LIN_ROW, { userId: CHEN })).toBe(false);
  });

  it("a classroom topic is readable only inside that classroom", () => {
    expect(topicVisibleTo(CLASS_LIN_ROW, { userId: LIN, classroomId: LIN_CLASS })).toBe(true);
    expect(topicVisibleTo(CLASS_LIN_ROW, { userId: LIN, classroomId: CHEN_CLASS })).toBe(false);
    expect(topicVisibleTo(CLASS_LIN_ROW, { userId: LIN })).toBe(false);
  });

  it("the personal-pool SQL selects exactly what the predicate accepts", async () => {
    const subject = { userId: LIN };
    expect(await poolIds(["system", "personal"], subject)).toEqual(predicateIds(["system", "personal"], subject));
    expect(await poolIds(["system", "personal"], subject)).toEqual(["t_v_personal_lin", "t_v_system"]);
  });

  it("the classroom-pool SQL selects exactly the classroom's own topics", async () => {
    const subject = { userId: LIN, classroomId: LIN_CLASS };
    expect(await poolIds(["classroom"], subject)).toEqual(["t_v_class_lin"]);
    expect(await poolIds(["classroom"], { userId: LIN, classroomId: CHEN_CLASS })).toEqual(["t_v_class_chen"]);
    expect(await poolIds(["classroom"], { userId: LIN, classroomId: "c_v_empty" })).toEqual([]);
  });
});

describe("copyableTopic: the copy source guard", () => {
  it("accepts system topics, own personal topics, and topics of classrooms the user teaches", async () => {
    for (const id of ["t_v_system", "t_v_personal_lin", "t_v_class_lin"]) {
      const row = await copyableTopic<Row>(env.DB, id, LIN);
      expect(row.id).toBe(id);
    }
  });

  it("rejects another teacher's personal topic, another teacher's classroom topic, unknown ids, and deleted topics", async () => {
    for (const id of ["t_v_personal_chen", "t_v_class_chen", "t_v_missing", "t_v_deleted_class_lin"]) {
      await expect(copyableTopic<Row>(env.DB, id, LIN)).rejects.toMatchObject({ status: 404, code: "not_found" });
    }
  });
});
