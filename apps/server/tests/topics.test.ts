import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { inject } from "vitest";
import { all, one, run } from "../src/db/d1";
import { seedFixture } from "../src/seed";
import { call, cookieOf, createClassroom, must, startActivity, systemTopicId } from "./helpers";

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
  axes: Array<{ name: string; left: string; right: string }>;
}

const TEST_AXES = [{ name: "契約與人情", left: "契約優先", right: "人情優先" }];
const OVERRIDE_AXES = [{ name: "公平與效率", left: "公平優先", right: "效率優先" }];

async function topicsOf(classroom: string, cookie: string): Promise<SessionTopic[]> {
  const res = await call(`/api/classrooms/${classroom}/topics`, { headers: { Cookie: cookie } });
  expect(res.status).toBe(200);
  return (await res.json()) as SessionTopic[];
}

async function createTopic(
  classroom: string,
  cookie: string,
  title: string,
  statement: string,
  axes?: typeof TEST_AXES,
) {
  const res = await call(
    `/api/classrooms/${classroom}/topics`,
    jsonInit({ title, statement, prompts: ["你的判斷是什麼？"], ...(axes ? { axes } : {}) }, cookie),
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

    const code = must(
      await one<{ join_code: string }>(env.DB, "SELECT join_code FROM classrooms WHERE id = $id", {
        id: classroomId,
      }),
      "classroom join_code row",
    );
    const preview = await call(`/api/join/${code.join_code}`);
    expect(preview.status).toBe(404);
    expect(((await preview.json()) as { code: string }).code).toBe("join_code_invalid");
  });

  it("topics created inside a classroom belong to it and stay out of the personal pool", async () => {
    const created = await createTopic(classroomId, teacher, "班級題", "只有這一班看得到", TEST_AXES);
    expect(created.status).toBe(201);
    const topic = (await created.json()) as SessionTopic;
    expect(topic.classroomId).toBe(classroomId);
    expect(topic.axes).toEqual(TEST_AXES);

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
    expect(((await asStudent.json()) as { code: string }).code).toBe("forbidden");

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
    const live = await startActivity(teacher, classroomId, topic.id);
    expect((await currentOf(classroomId, teacher))?.activityId).toBe(live.activityId);

    await startActivity(teacher, classroomId, topic.id, "test");
    expect((await currentOf(classroomId, teacher))?.activityId).toBe(live.activityId);

    const systemAcrossClasses = await startActivity(otherTeacher, otherClassroomId, systemTopic);
    expect((await currentOf(otherClassroomId, otherTeacher))?.activityId).toBe(systemAcrossClasses.activityId);
    expect((await topicsOf(otherClassroomId, otherTeacher)).length).toBe(0);
  });

  it("copying a topic into another classroom makes an independent snapshot", async () => {
    const [source] = await topicsOf(classroomId, teacher);
    const copied = await call(`/api/topics/${source.id}/copy`, jsonInit({ classroomId: secondClassroomId }, teacher));
    expect(copied.status).toBe(201);
    const copy = (await copied.json()) as SessionTopic;
    expect(copy.id).not.toBe(source.id);
    expect(copy.classroomId).toBe(secondClassroomId);
    expect(copy.title).toBe(source.title);
    expect(copy.statement).toBe(source.statement);
    expect(copy.axes).toEqual(source.axes);

    const provenance = await one<{ copied_from: string | null }>(
      env.DB,
      "SELECT copied_from FROM topics WHERE id = $id",
      { id: copy.id },
    );
    expect(provenance?.copied_from).toBe(source.id);

    const original = source.statement;
    await run(env.DB, "UPDATE topics SET statement = $statement WHERE id = $id", {
      statement: "來源被改過了",
      id: source.id,
    });
    const [after] = await topicsOf(secondClassroomId, teacher);
    expect(after.statement).toBe(original);

    const target = await topicsOf(secondClassroomId, teacher);
    expect(target.map((row) => row.id)).toEqual([copy.id]);
    const origin = await topicsOf(classroomId, teacher);
    expect(origin.find((row) => row.id === copy.id)).toBeUndefined();
    expect(origin[0].statement).toBe("來源被改過了");

    const overriddenRes = await call(
      `/api/topics/${source.id}/copy`,
      jsonInit({ classroomId: secondClassroomId, axes: OVERRIDE_AXES }, teacher),
    );
    expect(overriddenRes.status).toBe(201);
    const overridden = (await overriddenRes.json()) as SessionTopic;
    expect(overridden.axes).toEqual(OVERRIDE_AXES);
    const overriddenProvenance = await one<{ copied_from: string | null }>(
      env.DB,
      "SELECT copied_from FROM topics WHERE id = $id",
      { id: overridden.id },
    );
    expect(overriddenProvenance?.copied_from).toBe(source.id);
  });

  it("copy needs ownership of both sides and a readable source", async () => {
    const [source] = await topicsOf(classroomId, teacher);
    const foreign = await call(`/api/topics/${source.id}/copy`, jsonInit({ classroomId: otherClassroomId }, teacher));
    expect(foreign.status).toBe(403);

    const stolen = await call(
      `/api/topics/${source.id}/copy`,
      jsonInit({ classroomId: otherClassroomId }, otherTeacher),
    );
    expect(stolen.status).toBe(404);

    const systemList = (await (await call("/api/topics", { headers: { Cookie: teacher } })).json()) as SessionTopic[];
    const sourceSystem = must(
      systemList.find((row) => row.id === systemTopic),
      "system topic",
    );
    const systemCopy = await call(
      `/api/topics/${systemTopic}/copy`,
      jsonInit({ classroomId: secondClassroomId }, teacher),
    );
    expect(systemCopy.status).toBe(201);
    const copy = (await systemCopy.json()) as SessionTopic;
    expect(copy.classroomId).toBe(secondClassroomId);
    expect(copy.id).not.toBe(systemTopic);
    expect(copy.axes.length).toBeGreaterThan(0);
    expect(copy.axes).toEqual(sourceSystem.axes);
  });

  it("personal topics from POST /topics stay usable by their owner only", async () => {
    const created = await call("/api/topics", jsonInit({ title: "個人題", statement: "舊路徑", prompts: [] }, teacher));
    expect(created.status).toBe(201);
    const topic = (await created.json()) as SessionTopic;
    expect(topic.classroomId).toBeNull();
    expect(topic.axes).toEqual([]);

    const withAxesRes = await call(
      "/api/topics",
      jsonInit({ title: "帶軸個人題", statement: "測試軸", prompts: [], axes: TEST_AXES }, teacher),
    );
    expect(withAxesRes.status).toBe(201);
    const withAxes = (await withAxesRes.json()) as SessionTopic;
    expect(withAxes.axes).toEqual(TEST_AXES);

    const started = await startActivity(teacher, secondClassroomId, withAxes.id);
    expect((await currentOf(secondClassroomId, teacher))?.activityId).toBe(started.activityId);
    const foreign = await call(
      `/api/classrooms/${otherClassroomId}/activities`,
      jsonInit({ topicId: withAxes.id }, otherTeacher),
    );
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
    const created = (await first.json()) as SessionTopic & { prompts: string[] };

    const again = await postTopic(lifecycleId, teacher, {
      title: "  重複題  ",
      statement: " 同一個題目 ",
      prompts: ["第二版提問"],
      axes: TEST_AXES,
    });
    expect(again.status).toBe(200);
    const existing = (await again.json()) as SessionTopic & { prompts: string[] };
    expect(existing.id).toBe(created.id);
    expect(existing.prompts).toEqual(["第一版提問"]);
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
    const axed = (await withAxes.json()) as SessionTopic;

    const reorderedKeys = await postTopic(lifecycleId, teacher, {
      title: "軸題",
      statement: "同文不同軸",
      prompts: [],
      axes: TEST_AXES.map(({ name, left, right }) => ({ right, name, left })),
    });
    expect(reorderedKeys.status).toBe(200);
    expect(((await reorderedKeys.json()) as SessionTopic).id).toBe(axed.id);
    expect(await countTopics(lifecycleId, "軸題")).toBe(2);
  });

  it("concurrent identical creates still produce a single row", async () => {
    const body = { title: "併發題", statement: "同時建立", prompts: ["問"] };
    const responses = await Promise.all([1, 2, 3].map(() => postTopic(lifecycleId, teacher, body)));
    expect(responses.map((res) => res.status).sort()).toEqual([200, 200, 201]);
    const ids = new Set(await Promise.all(responses.map(async (res) => ((await res.json()) as SessionTopic).id)));
    expect(ids.size).toBe(1);
    expect(await countTopics(lifecycleId, "併發題")).toBe(1);
  });

  it("copying the same source into one classroom resolves to a single snapshot", async () => {
    const source = await postTopic(copyTargetId, teacher, { title: "來源題", statement: "要被複製", prompts: [] });
    expect(source.status).toBe(201);
    const sourceTopic = (await source.json()) as SessionTopic;

    const first = await call(`/api/topics/${sourceTopic.id}/copy`, jsonInit({ classroomId: lifecycleId }, teacher));
    expect(first.status).toBe(201);
    const copy = (await first.json()) as SessionTopic;

    const second = await call(`/api/topics/${sourceTopic.id}/copy`, jsonInit({ classroomId: lifecycleId }, teacher));
    expect(second.status).toBe(200);
    expect(((await second.json()) as SessionTopic).id).toBe(copy.id);
    expect(await countTopics(lifecycleId, "來源題")).toBe(1);
  });

  it("delete hides the topic from lists while activity history keeps rendering it", async () => {
    const created = await postTopic(lifecycleId, teacher, {
      title: "待刪題",
      statement: "刪掉之後歷史頁仍要可讀",
      prompts: [],
    });
    expect(created.status).toBe(201);
    const topic = (await created.json()) as SessionTopic;
    const started = await startActivity(teacher, lifecycleId, topic.id);

    expect((await removeTopic(lifecycleId, topic.id, teacher)).status).toBe(204);
    expect((await removeTopic(lifecycleId, topic.id, teacher)).status).toBe(204);
    expect((await topicsOf(lifecycleId, teacher)).some((row) => row.id === topic.id)).toBe(false);

    const activity = await call(`/api/activities/${started.activityId}`, { headers: { Cookie: teacher } });
    expect(activity.status).toBe(200);
    expect(((await activity.json()) as { topic: { id: string; title: string } }).topic).toMatchObject({
      id: topic.id,
      title: "待刪題",
    });

    const rooms = (await (await call("/api/classrooms", { headers: { Cookie: teacher } })).json()) as Array<{
      id: string;
      current: { topicTitle: string } | null;
    }>;
    expect(rooms.find((room) => room.id === lifecycleId)?.current?.topicTitle).toBe("待刪題");

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
    const topic = (await created.json()) as SessionTopic;

    expect((await removeTopic(lifecycleId, topic.id, teacher)).status).toBe(204);

    const recreated = await postTopic(lifecycleId, teacher, body);
    expect(recreated.status).toBe(201);
    expect(((await recreated.json()) as SessionTopic).id).not.toBe(topic.id);
  });

  it("concurrent activity starts with the same edited axes converge on one snapshot", async () => {
    const { classroomId: racyId } = await createClassroom(teacher, "併發開課班");
    const created = await postTopic(racyId, teacher, { title: "併發開課題", statement: "同時改軸", prompts: [] });
    expect(created.status).toBe(201);
    const topic = (await created.json()) as SessionTopic;
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
    const topic = (await created.json()) as SessionTopic;

    expect((await removeTopic(otherClassroomId, topic.id, otherTeacher)).status).toBe(404);
    expect((await removeTopic(lifecycleId, topic.id, otherTeacher)).status).toBe(403);
    expect((await removeTopic(lifecycleId, "t_missing", teacher)).status).toBe(404);
    expect((await removeTopic(lifecycleId, topic.id, teacher)).status).toBe(204);
  });
});
