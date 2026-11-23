import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { inject } from "vitest";
import { all, one, run } from "../src/db/d1";
import { seedFixture } from "../src/seed";
import {
  call,
  cookieOf,
  createClassroom,
  field,
  must,
  optStr,
  rows,
  startActivity,
  str,
  systemTopicId,
} from "./helpers";

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

async function topicsOf(classroom: string, cookie: string) {
  const res = await call(`/api/classrooms/${classroom}/topics`, { headers: { Cookie: cookie } });
  expect(res.status).toBe(200);
  return rows(await res.json()).map((row) => ({
    id: str(row, "id"),
    classroomId: optStr(row, "classroomId"),
    title: str(row, "title"),
    statement: str(row, "statement"),
  }));
}

const TEST_AXES = [{ name: "契約與人情", left: "契約優先", right: "人情優先" }];
const OVERRIDE_AXES = [{ name: "公平與效率", left: "公平優先", right: "效率優先" }];

async function topicIdOf(res: Response): Promise<string> {
  expect(res.status).toBeGreaterThanOrEqual(200);
  return str(await res.json(), "id");
}

async function topicPromptsOf(body: unknown): Promise<string[]> {
  const prompts = field(body, "prompts");
  if (!Array.isArray(prompts)) throw new Error("topic prompts are not an array");
  return prompts.map((prompt) => {
    if (typeof prompt !== "string") throw new Error("topic prompt is not a string");
    return prompt;
  });
}

async function createTopic(classroom: string, cookie: string, title: string, statement: string) {
  const res = await call(
    `/api/classrooms/${classroom}/topics`,
    jsonInit({ title, statement, prompts: ["你的判斷是什麼？"] }, cookie),
  );
  return res;
}

async function currentOf(classroom: string, cookie: string): Promise<{ activityId: string } | null> {
  const rooms = rows(await (await call("/api/classrooms", { headers: { Cookie: cookie } })).json());
  const room = rooms.find((entry) => str(entry, "id") === classroom);
  if (room === undefined) return null;
  const current: unknown = field(room, "current");
  if (typeof current !== "object" || current === null) return null;
  return { activityId: str(current, "activityId") };
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
    const rooms = rows(await (await call("/api/classrooms", { headers: { Cookie: teacher } })).json());
    const room = rooms.find((entry) => str(entry, "id") === classroomId);
    expect(room !== undefined && field(room, "current") === null).toBe(true);
    expect(await topicsOf(classroomId, teacher)).toEqual([]);

    const activity = await one<{ n: number }>(
      env.DB,
      "SELECT COUNT(*) AS n FROM activities WHERE classroom_id = $cid",
      {
        cid: classroomId,
      },
    );
    expect(Number(activity?.n)).toBe(0);

    const code = must(
      await one<{ join_code: string }>(env.DB, "SELECT join_code FROM classrooms WHERE id = $id", {
        id: classroomId,
      }),
      "classroom join_code row",
    );
    const preview = await call(`/api/join/${code.join_code}`);
    expect(preview.status).toBe(404);
    expect(str(await preview.json(), "code")).toBe("join_code_invalid");
  });

  it("topics created inside a classroom belong to it and stay out of the personal pool", async () => {
    const created = await createTopic(classroomId, teacher, "班級題", "只有這一班看得到");
    expect(created.status).toBe(201);
    const topicJson = await created.json();
    expect(optStr(topicJson, "classroomId")).toBe(classroomId);
    const topicId = str(topicJson, "id");

    const list = await topicsOf(classroomId, teacher);
    expect(list.map((row) => row.id)).toEqual([topicId]);
    expect(await topicsOf(secondClassroomId, teacher)).toEqual([]);

    const pool = rows(await (await call("/api/topics", { headers: { Cookie: teacher } })).json());
    expect(pool.some((row) => str(row, "id") === topicId)).toBe(false);

    const stolen = await call(`/api/classrooms/${otherClassroomId}/activities`, jsonInit({ topicId }, otherTeacher));
    expect(stolen.status).toBe(404);
  });

  it("owner-only writes, member reads, non-member 403", async () => {
    const asOtherTeacher = await createTopic(classroomId, otherTeacher, "越權", "不該成功");
    expect(asOtherTeacher.status).toBe(403);

    const student = await login("student-a@socrates.tw");
    const asStudent = await createTopic(classroomId, student, "學生題", "不該成功");
    expect(asStudent.status).toBe(403);
    expect(str(await asStudent.json(), "code")).toBe("forbidden");

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
    const topic = must((await topicsOf(classroomId, teacher))[0], "topic topic");
    const live = await startActivity(teacher, classroomId, topic.id);
    expect((await currentOf(classroomId, teacher))?.activityId).toBe(live.activityId);

    await startActivity(teacher, classroomId, topic.id, "test");
    expect((await currentOf(classroomId, teacher))?.activityId).toBe(live.activityId);

    const systemAcrossClasses = await startActivity(otherTeacher, otherClassroomId, systemTopic);
    expect((await currentOf(otherClassroomId, otherTeacher))?.activityId).toBe(systemAcrossClasses.activityId);
    expect((await topicsOf(otherClassroomId, otherTeacher)).length).toBe(0);
  });

  it("copying a topic into another classroom makes an independent snapshot", async () => {
    const source = must((await topicsOf(classroomId, teacher))[0], "source topic");
    const copied = await call(`/api/topics/${source.id}/copy`, jsonInit({ classroomId: secondClassroomId }, teacher));
    expect(copied.status).toBe(201);
    const copy = await copied.json();
    expect(str(copy, "id")).not.toBe(source.id);
    expect(optStr(copy, "classroomId")).toBe(secondClassroomId);
    expect(str(copy, "title")).toBe(source.title);
    expect(str(copy, "statement")).toBe(source.statement);

    const copyId = str(copy, "id");

    const provenance = await one<{ copied_from: string | null }>(
      env.DB,
      "SELECT copied_from FROM topics WHERE id = $id",
      { id: copyId },
    );
    expect(provenance?.copied_from).toBe(source.id);

    const original = source.statement;
    await run(env.DB, "UPDATE topics SET statement = $statement WHERE id = $id", {
      statement: "來源被改過了",
      id: source.id,
    });
    const after = must((await topicsOf(secondClassroomId, teacher))[0], "after topic");
    expect(after.statement).toBe(original);

    const target = await topicsOf(secondClassroomId, teacher);
    expect(target.map((row) => row.id)).toEqual([copyId]);
    const origin = await topicsOf(classroomId, teacher);
    expect(origin.find((row) => row.id === copyId)).toBeUndefined();
    expect(must(origin[0], "origin topic").statement).toBe("來源被改過了");
  });

  it("copy needs ownership of both sides and a readable source", async () => {
    const source = must((await topicsOf(classroomId, teacher))[0], "source topic");
    const foreign = await call(`/api/topics/${source.id}/copy`, jsonInit({ classroomId: otherClassroomId }, teacher));
    expect(foreign.status).toBe(403);

    const stolen = await call(
      `/api/topics/${source.id}/copy`,
      jsonInit({ classroomId: otherClassroomId }, otherTeacher),
    );
    expect(stolen.status).toBe(404);

    const systemCopy = await call(
      `/api/topics/${systemTopic}/copy`,
      jsonInit({ classroomId: secondClassroomId }, teacher),
    );
    expect(systemCopy.status).toBe(201);
    const systemCopyJson = await systemCopy.json();
    expect(optStr(systemCopyJson, "classroomId")).toBe(secondClassroomId);
    expect(str(systemCopyJson, "id")).not.toBe(systemTopic);
  });

  it("personal topics from POST /topics stay usable by their owner only", async () => {
    const created = await call("/api/topics", jsonInit({ title: "個人題", statement: "舊路徑", prompts: [] }, teacher));
    expect(created.status).toBe(201);
    const topicJson = await created.json();
    expect(field(topicJson, "classroomId")).toBeNull();
    const topicId = str(topicJson, "id");

    const started = await startActivity(teacher, secondClassroomId, topicId);
    expect((await currentOf(secondClassroomId, teacher))?.activityId).toBe(started.activityId);
    const foreign = await call(`/api/classrooms/${otherClassroomId}/activities`, jsonInit({ topicId }, otherTeacher));
    expect(foreign.status).toBe(404);
  });
});

describe("topic lifecycle (#383)", () => {
  let lifecycleId: string;
  let copyTargetId: string;

  const postTopic = (classroom: string, cookie: string, body: unknown) =>
    call(`/api/classrooms/${classroom}/topics`, jsonInit(body, cookie));
  const removeTopic = (classroom: string, topicId: string, cookie: string) =>
    call(`/api/classrooms/${classroom}/topics/${topicId}`, { method: "DELETE", headers: { Cookie: cookie } });
  const countTopics = async (classroom: string, title: string) => {
    const [row] = await all<{ n: number }>(
      env.DB,
      "SELECT COUNT(*) AS n FROM topics WHERE classroom_id = $cid AND title = $title",
      { cid: classroom, title },
    );
    return Number(row?.n);
  };

  beforeAll(async () => {
    lifecycleId = (await createClassroom(teacher, "生命週期班")).classroomId;
    copyTargetId = (await createClassroom(teacher, "複製目標班")).classroomId;
  });

  it("creating the same content twice keeps one row: 201 then 200 with the first topic", async () => {
    const first = await postTopic(lifecycleId, teacher, {
      title: "重複題",
      statement: "同一個題目",
      prompts: ["第一版提問"],
      axes: TEST_AXES,
    });
    expect(first.status).toBe(201);
    const createdId = await topicIdOf(first);

    const again = await postTopic(lifecycleId, teacher, {
      title: "  重複題  ",
      statement: " 同一個題目 ",
      prompts: ["第二版提問"],
      axes: TEST_AXES,
    });
    expect(again.status).toBe(200);
    const againBody = await again.json();
    const existingId = str(againBody, "id");
    expect(existingId).toBe(createdId);
    expect(await topicPromptsOf(againBody)).toEqual(["第一版提問"]);
    expect(await countTopics(lifecycleId, "重複題")).toBe(1);
  });

  it("axes belong to the identity and are compared in canonical key order", async () => {
    const plain = await postTopic(lifecycleId, teacher, { title: "軸題", statement: "同文不同軸", prompts: [] });
    expect(plain.status).toBe(201);

    const withAxes = await postTopic(lifecycleId, teacher, {
      title: "軸題",
      statement: "同文不同軸",
      prompts: [],
      axes: TEST_AXES,
    });
    expect(withAxes.status).toBe(201);
    const axed = await topicIdOf(withAxes);

    const reorderedKeys = await postTopic(lifecycleId, teacher, {
      title: "軸題",
      statement: "同文不同軸",
      prompts: [],
      axes: TEST_AXES.map(({ name, left, right }) => ({ right, name, left })),
    });
    expect(reorderedKeys.status).toBe(200);
    expect(await topicIdOf(reorderedKeys)).toBe(axed);
    expect(await countTopics(lifecycleId, "軸題")).toBe(2);
  });

  it("concurrent identical creates still produce a single row", async () => {
    const body = { title: "併發題", statement: "同時建立", prompts: ["問"] };
    const responses = await Promise.all([1, 2, 3].map(() => postTopic(lifecycleId, teacher, body)));
    expect(responses.map((res) => res.status).sort()).toEqual([200, 200, 201]);
    const ids = new Set(await Promise.all(responses.map(topicIdOf)));
    expect(ids.size).toBe(1);
    expect(await countTopics(lifecycleId, "併發題")).toBe(1);
  });

  it("copying the same source into one classroom resolves to a single snapshot", async () => {
    const source = await postTopic(copyTargetId, teacher, { title: "來源題", statement: "要被複製", prompts: [] });
    expect(source.status).toBe(201);
    const sourceTopic = { id: await topicIdOf(source) };

    const first = await call(`/api/topics/${sourceTopic.id}/copy`, jsonInit({ classroomId: lifecycleId }, teacher));
    expect(first.status).toBe(201);
    const copy = await topicIdOf(first);

    const second = await call(`/api/topics/${sourceTopic.id}/copy`, jsonInit({ classroomId: lifecycleId }, teacher));
    expect(second.status).toBe(200);
    expect(await topicIdOf(second)).toBe(copy);
    expect(await countTopics(lifecycleId, "來源題")).toBe(1);
  });

  it("delete hides the topic from lists while activity history keeps rendering it", async () => {
    const created = await postTopic(lifecycleId, teacher, {
      title: "待刪題",
      statement: "刪掉之後歷史頁仍要可讀",
      prompts: [],
    });
    expect(created.status).toBe(201);
    const topic = { id: await topicIdOf(created) };
    const started = await startActivity(teacher, lifecycleId, topic.id);

    expect((await removeTopic(lifecycleId, topic.id, teacher)).status).toBe(204);
    expect((await removeTopic(lifecycleId, topic.id, teacher)).status).toBe(204);
    expect((await topicsOf(lifecycleId, teacher)).some((row) => row.id === topic.id)).toBe(false);

    const activity = await call(`/api/activities/${started.activityId}`, { headers: { Cookie: teacher } });
    expect(activity.status).toBe(200);
    expect(field(await activity.json(), "topic")).toMatchObject({
      id: topic.id,
      title: "待刪題",
    });

    const roomWithLifecycle = rows(await (await call("/api/classrooms", { headers: { Cookie: teacher } })).json()).find(
      (room) => str(room, "id") === lifecycleId,
    );
    const current = roomWithLifecycle === undefined ? null : field(roomWithLifecycle, "current");
    expect(current === null || current === undefined ? null : str(current, "topicTitle")).toBe("待刪題");

    const restarted = await call(`/api/classrooms/${lifecycleId}/activities`, jsonInit({ topicId: topic.id }, teacher));
    expect(restarted.status).toBe(404);

    const linked = await one<{ topic_id: string }>(env.DB, "SELECT topic_id FROM activities WHERE id = $id", {
      id: started.activityId,
    });
    expect(linked?.topic_id).toBe(topic.id);
  });

  it("deleting frees the content for a fresh topic", async () => {
    const body = { title: "回收題", statement: "刪除後可重建", prompts: [] };
    const created = await postTopic(lifecycleId, teacher, body);
    expect(created.status).toBe(201);
    const topic = { id: await topicIdOf(created) };

    expect((await removeTopic(lifecycleId, topic.id, teacher)).status).toBe(204);

    const recreated = await postTopic(lifecycleId, teacher, body);
    expect(recreated.status).toBe(201);
    expect(await topicIdOf(recreated)).not.toBe(topic.id);
  });

  it("concurrent activity starts with the same edited axes converge on one snapshot", async () => {
    const { classroomId: racyId } = await createClassroom(teacher, "併發開課班");
    const created = await postTopic(racyId, teacher, { title: "併發開課題", statement: "同時改軸", prompts: [] });
    expect(created.status).toBe(201);
    const topic = { id: await topicIdOf(created) };
    const start = () =>
      call(
        `/api/classrooms/${racyId}/activities`,
        jsonInit({ topicId: topic.id, reportAxes: "teacher", topicAxes: OVERRIDE_AXES }, teacher),
      );

    const responses = await Promise.all([start(), start()]);
    expect(responses.map((res) => res.status)).toEqual([201, 201]);
    const snapshots = await all<{ id: string }>(
      env.DB,
      "SELECT id FROM topics WHERE classroom_id = $cid AND title = $title AND axes = $axes",
      { cid: racyId, title: "併發開課題", axes: JSON.stringify(OVERRIDE_AXES) },
    );
    expect(snapshots).toHaveLength(1);
    const activities = await all<{ topic_id: string }>(
      env.DB,
      "SELECT topic_id FROM activities WHERE classroom_id = $cid",
      { cid: racyId },
    );
    expect(activities).toHaveLength(2);
    expect(new Set(activities.map((row) => row.topic_id))).toEqual(new Set([snapshots[0]?.id]));
  });

  it("delete needs the classroom owner and a topic of that classroom", async () => {
    const created = await postTopic(lifecycleId, teacher, {
      title: "權限題",
      statement: "只有 owner 能刪",
      prompts: [],
    });
    expect(created.status).toBe(201);
    const topic = { id: await topicIdOf(created) };

    expect((await removeTopic(otherClassroomId, topic.id, otherTeacher)).status).toBe(404);
    expect((await removeTopic(lifecycleId, topic.id, otherTeacher)).status).toBe(403);
    expect((await removeTopic(lifecycleId, "t_missing", teacher)).status).toBe(404);
    expect((await removeTopic(lifecycleId, topic.id, teacher)).status).toBe(204);
  });
});
