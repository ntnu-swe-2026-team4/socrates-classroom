import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { inject } from "vitest";
import { one, run } from "../src/db/d1";
import { seedFixture } from "../src/seed";
import { call, cookieOf, createClassroom, startActivity, systemTopicId } from "./helpers";

let teacher: string;
let otherTeacher: string;
let classroomId: string;
let secondClassroomId: string;
let otherClassroomId: string;
let systemTopic: string;

const migrations = inject("d1Migrations");

function jsonInit(body: unknown, cookie?: string): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  };
}

async function login(email: string): Promise<string> {
  const res = await call("/api/auth/login", jsonInit({ email, password: "demo-demo" }));
  expect(res.status).toBe(200);
  return cookieOf(res);
}

interface SessionTopic {
  id: string;
  classroomId: string | null;
  title: string;
  statement: string;
}

async function topicsOf(classroom: string, cookie: string): Promise<SessionTopic[]> {
  const res = await call(`/api/classrooms/${classroom}/topics`, { headers: { Cookie: cookie } });
  expect(res.status).toBe(200);
  return (await res.json()) as SessionTopic[];
}

async function createTopic(classroom: string, cookie: string, title: string, statement: string) {
  const res = await call(
    `/api/classrooms/${classroom}/topics`,
    jsonInit({ title, statement, prompts: ["你的判斷是什麼？"] }, cookie),
  );
  return res;
}

async function currentOf(classroom: string, cookie: string): Promise<{ activityId: string } | null> {
  const rooms = (await (await call("/api/classrooms", { headers: { Cookie: cookie } })).json()) as Array<{
    id: string;
    current: { activityId: string } | null;
  }>;
  return rooms.find((room) => room.id === classroom)?.current ?? null;
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, migrations);
  await seedFixture(env.DB);
  teacher = await login("demo@socrates.tw");
  otherTeacher = await login("chen@socrates.tw");
  systemTopic = await systemTopicId(teacher);
  classroomId = (await createClassroom(teacher, "空班")).classroomId;
  secondClassroomId = (await createClassroom(teacher, "第二班")).classroomId;
  otherClassroomId = (await createClassroom(otherTeacher, "別人的班")).classroomId;
});

describe("classroom / topic decoupling (#135)", () => {
  it("a classroom can exist with no activity: empty topic set, no current, join code unusable", async () => {
    const rooms = (await (await call("/api/classrooms", { headers: { Cookie: teacher } })).json()) as Array<{
      id: string;
      current: unknown;
    }>;
    const room = rooms.find((entry) => entry.id === classroomId);
    expect(room?.current).toBeNull();
    expect(await topicsOf(classroomId, teacher)).toEqual([]);

    const activity = await one<{ n: number }>(
      env.DB,
      "SELECT COUNT(*) AS n FROM activities WHERE classroom_id = $cid",
      {
        cid: classroomId,
      },
    );
    expect(Number(activity?.n)).toBe(0);

    const code = (await one<{ join_code: string }>(env.DB, "SELECT join_code FROM classrooms WHERE id = $id", {
      id: classroomId,
    }))!;
    const preview = await call(`/api/join/${code.join_code}`);
    expect(preview.status).toBe(404);
    expect(((await preview.json()) as { code: string }).code).toBe("join_code_invalid");
  });

  it("topics created inside a classroom belong to it and stay out of the personal pool", async () => {
    const created = await createTopic(classroomId, teacher, "班級題", "只有這一班看得到");
    expect(created.status).toBe(201);
    const topic = (await created.json()) as SessionTopic;
    expect(topic.classroomId).toBe(classroomId);

    const list = await topicsOf(classroomId, teacher);
    expect(list.map((row) => row.id)).toEqual([topic.id]);
    expect(await topicsOf(secondClassroomId, teacher)).toEqual([]);

    const pool = (await (await call("/api/topics", { headers: { Cookie: teacher } })).json()) as Array<{ id: string }>;
    expect(pool.some((row) => row.id === topic.id)).toBe(false);

    const stolen = await call(
      `/api/classrooms/${otherClassroomId}/activities`,
      jsonInit({ topicId: topic.id }, otherTeacher),
    );
    expect(stolen.status).toBe(404);
  });

  it("owner-only writes, member reads, non-member 403", async () => {
    const asOtherTeacher = await createTopic(classroomId, otherTeacher, "越權", "不該成功");
    expect(asOtherTeacher.status).toBe(403);

    const student = await login("student-a@socrates.tw");
    const asStudent = await createTopic(classroomId, student, "學生題", "不該成功");
    expect(asStudent.status).toBe(403);
    expect(((await asStudent.json()) as { code: string }).code).toBe("capability_required");

    const outsider = await login("student-b@socrates.tw");
    const outside = await call(`/api/classrooms/${classroomId}/topics`, { headers: { Cookie: outsider } });
    expect(outside.status).toBe(403);

    await run(
      env.DB,
      `INSERT INTO members (classroom_id, user_id, name, tos_accepted_at, joined_at)
       VALUES ($cid, $uid, $name, $at, $at)`,
      { cid: classroomId, uid: "u_fx_student_a", name: "王小明", at: new Date().toISOString() },
    );
    expect((await topicsOf(classroomId, student)).length).toBe(1);
  });

  it("an activity starts from a classroom topic and becomes current; a test activity never does", async () => {
    const [topic] = await topicsOf(classroomId, teacher);
    const live = await startActivity(teacher, classroomId, topic!.id);
    expect((await currentOf(classroomId, teacher))?.activityId).toBe(live.activityId);

    await startActivity(teacher, classroomId, topic!.id, "test");
    expect((await currentOf(classroomId, teacher))?.activityId).toBe(live.activityId);

    const systemAcrossClasses = await startActivity(otherTeacher, otherClassroomId, systemTopic);
    expect((await currentOf(otherClassroomId, otherTeacher))?.activityId).toBe(systemAcrossClasses.activityId);
    expect((await topicsOf(otherClassroomId, otherTeacher)).length).toBe(0);
  });

  it("copying a topic into another classroom makes an independent snapshot", async () => {
    const [source] = await topicsOf(classroomId, teacher);
    const copied = await call(`/api/topics/${source!.id}/copy`, jsonInit({ classroomId: secondClassroomId }, teacher));
    expect(copied.status).toBe(201);
    const copy = (await copied.json()) as SessionTopic;
    expect(copy.id).not.toBe(source!.id);
    expect(copy.classroomId).toBe(secondClassroomId);
    expect(copy.title).toBe(source!.title);
    expect(copy.statement).toBe(source!.statement);

    const provenance = await one<{ copied_from: string | null }>(
      env.DB,
      "SELECT copied_from FROM topics WHERE id = $id",
      { id: copy.id },
    );
    expect(provenance?.copied_from).toBe(source!.id);

    const original = source!.statement;
    await run(env.DB, "UPDATE topics SET statement = $statement WHERE id = $id", {
      statement: "來源被改過了",
      id: source!.id,
    });
    const [after] = await topicsOf(secondClassroomId, teacher);
    expect(after!.statement).toBe(original);

    const target = await topicsOf(secondClassroomId, teacher);
    expect(target.map((row) => row.id)).toEqual([copy.id]);
    const origin = await topicsOf(classroomId, teacher);
    expect(origin.find((row) => row.id === copy.id)).toBeUndefined();
    expect(origin[0]!.statement).toBe("來源被改過了");
  });

  it("copy needs ownership of both sides and a readable source", async () => {
    const [source] = await topicsOf(classroomId, teacher);
    const foreign = await call(`/api/topics/${source!.id}/copy`, jsonInit({ classroomId: otherClassroomId }, teacher));
    expect(foreign.status).toBe(403);

    const stolen = await call(
      `/api/topics/${source!.id}/copy`,
      jsonInit({ classroomId: otherClassroomId }, otherTeacher),
    );
    expect(stolen.status).toBe(404);

    const systemCopy = await call(
      `/api/topics/${systemTopic}/copy`,
      jsonInit({ classroomId: secondClassroomId }, teacher),
    );
    expect(systemCopy.status).toBe(201);
    const copy = (await systemCopy.json()) as SessionTopic;
    expect(copy.classroomId).toBe(secondClassroomId);
    expect(copy.id).not.toBe(systemTopic);
  });

  it("personal topics from POST /topics stay usable by their owner only", async () => {
    const created = await call("/api/topics", jsonInit({ title: "個人題", statement: "舊路徑", prompts: [] }, teacher));
    expect(created.status).toBe(201);
    const topic = (await created.json()) as SessionTopic;
    expect(topic.classroomId).toBeNull();

    const started = await startActivity(teacher, secondClassroomId, topic.id);
    expect((await currentOf(secondClassroomId, teacher))?.activityId).toBe(started.activityId);
    const foreign = await call(
      `/api/classrooms/${otherClassroomId}/activities`,
      jsonInit({ topicId: topic.id }, otherTeacher),
    );
    expect(foreign.status).toBe(404);
  });
});
