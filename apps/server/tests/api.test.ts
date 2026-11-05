import { beforeAll, describe, expect, test } from "vitest";
import { env } from "cloudflare:test";
import { createApp } from "../src/app";
import { seedDemo } from "../src/seed";
import { run } from "../src/db/d1";
import type { Hono } from "hono";
import type { AppEnv } from "../src/http";
import migrationSql from "../migrations/001_init.sql";

declare global {
  var classroom: { code: string; activityId: string; classroomId: string };
}

let app: Hono<AppEnv>;
const jar: { teacher?: string; student?: string; student2?: string } = {};

interface SseFrame {
  event: string;
  data: unknown;
}

async function readSse(res: Response, until: (body: string) => boolean): Promise<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let body = "";
  while (!until(body)) {
    const { done, value } = await reader.read();
    if (done) break;
    body += decoder.decode(value, { stream: true });
  }
  await reader.cancel().catch(() => {});
  return body;
}

function parseSse(body: string): SseFrame[] {
  const frames: SseFrame[] = [];
  for (const block of body.split("\n\n")) {
    const eventLine = block.split("\n").find((line) => line.startsWith("event: "));
    const dataLine = block.split("\n").find((line) => line.startsWith("data: "));
    if (eventLine && dataLine) {
      frames.push({ event: eventLine.slice(7), data: JSON.parse(dataLine.slice(6)) });
    }
  }
  return frames;
}

async function req(
  method: string,
  url: string,
  options: { cookie?: string; body?: unknown; raw?: BodyInit; contentType?: string } = {},
): Promise<Response> {
  const hasJson = options.body !== undefined;
  const hasRaw = options.raw !== undefined;
  return app.request(
    url,
    {
      method,
      headers: {
        Accept: "application/json",
        "Accept-Language": "zh-TW",
        ...(hasJson ? { "Content-Type": "application/json" } : {}),
        ...(hasRaw && options.contentType ? { "Content-Type": options.contentType } : {}),
        ...(options.cookie ? { Cookie: options.cookie } : {}),
      },
      body: hasJson ? JSON.stringify(options.body) : options.raw,
    },
    env,
  );
}

function cookieOf(res: Response): string {
  const set = res.headers.getSetCookie?.()[0] ?? res.headers.get("set-cookie") ?? "";
  return set.split(";")[0]!;
}

beforeAll(async () => {
  app = createApp();
  for (const statement of migrationSql.split(";")) {
    const trimmed = statement.trim();
    if (trimmed) await run(env.DB, trimmed);
  }
  await seedDemo(env.DB);
});

describe("身分", () => {
  test("me 未登入回 null", async () => {
    const res = await req("GET", "/api/me");
    expect(res.status).toBe(200);
    expect(await res.json()).toBeNull();
  });

  test("demo 老師登入成功並設 cookie", async () => {
    const res = await req("POST", "/api/auth/login", {
      body: { email: "demo@socrates.tw", password: "demo-demo" },
    });
    expect(res.status).toBe(200);
    const user = await res.json();
    expect(user.role).toBe("teacher");
    jar.teacher = cookieOf(res);
    expect(jar.teacher).toContain("socrates_session=");
  });

  test("錯誤密碼 401 unauthorized（zh 訊息）", async () => {
    const res = await req("POST", "/api/auth/login", {
      body: { email: "demo@socrates.tw", password: "wrong-pass" },
    });
    expect(res.status).toBe(401);
    const error = await res.json();
    expect(error.code).toBe("unauthorized");
    expect(error.message).toContain("登入");
  });
});

describe("開課", () => {
  test("未登入存 topics 401", async () => {
    const res = await req("GET", "/api/topics");
    expect(res.status).toBe(401);
  });

  test("老師列系統主題、自建主題、AI 生成", async () => {
    const list = await req("GET", "/api/topics", { cookie: jar.teacher });
    expect(list.status).toBe(200);
    const topics = (await list.json()) as Array<{ id: string; prompts: string[] }>;
    expect(topics.length).toBeGreaterThanOrEqual(3);

    const created = await req("POST", "/api/topics", {
      cookie: jar.teacher,
      body: { title: "測試主題", statement: "測試敘述", prompts: ["為什麼？"] },
    });
    expect(created.status).toBe(201);
    const topic = await created.json();
    expect(topic.prompts).toEqual(["為什麼？"]);

    const generated = await req("POST", "/api/topics/generate", {
      cookie: jar.teacher,
      body: { direction: "AI 對就業的影響" },
    });
    const topics2 = (await generated.json()) as unknown[];
    expect(topics2.length).toBe(3);
  });

  test("建立教室回 code/url/activityId，重開新活動同 code", async () => {
    const created = await req("POST", "/api/classrooms", {
      cookie: jar.teacher,
      body: { name: "高三忠班", topicId: "t_first" },
    });
    expect(created.status).toBe(404);
    const list = await req("GET", "/api/topics", { cookie: jar.teacher });
    const first = ((await list.json()) as Array<{ id: string }>)[0]!;
    const ok = await req("POST", "/api/classrooms", {
      cookie: jar.teacher,
      body: { name: "高三忠班", topicId: first.id },
    });
    expect(ok.status).toBe(201);
    const classroom = await ok.json();
    expect(classroom.code).toHaveLength(6);
    expect(classroom.url).toContain(`/join/${classroom.code}`);
    expect(classroom.activityId).toBeTruthy();
    expect(classroom.classroomId).toBeTruthy();
    globalThis.classroom = classroom;
  });
});

describe("入場", () => {
  let classroom: { code: string; activityId: string };

  beforeAll(() => {
    classroom = globalThis.classroom as { code: string; activityId: string };
  });

  test("無效碼 404 join_code_invalid", async () => {
    const res = await req("GET", "/api/join/nope99");
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe("join_code_invalid");
  });

  test("GET join 回 JoinInfo", async () => {
    const res = await req("GET", `/api/join/${classroom.code}`);
    expect(res.status).toBe(200);
    const info = await res.json();
    expect(info.classroomName).toBe("高三忠班");
    expect(info.topic.title).toBeTruthy();
    expect(Array.isArray(info.topic.prompts)).toBe(true);
  });

  test("未勾 ToS 422 tos_required", async () => {
    const res = await req("POST", "/api/join", {
      body: { code: classroom.code, name: "小明", tosAccepted: false },
    });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { code: string }).code).toBe("tos_required");
  });

  test("訪客 join 建身分＋入教室", async () => {
    const res = await req("POST", "/api/join", {
      body: { code: classroom.code, name: "小明", tosAccepted: true },
    });
    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.user.role).toBe("student");
    expect(payload.user.name).toBe("小明");
    expect(payload.activityId).toBe(classroom.activityId);
    jar.student = cookieOf(res);

    const again = await req("POST", "/api/join", {
      cookie: jar.student,
      body: { code: classroom.code, tosAccepted: true },
    });
    expect(again.status).toBe(200);
    expect(((await again.json()) as { activityId: string }).activityId).toBe(classroom.activityId);
  });

  test("同名訪客 409 name_taken", async () => {
    const res = await req("POST", "/api/join", {
      body: { code: classroom.code, name: "小明", tosAccepted: true },
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe("name_taken");
  });

  test("老師 session join 403 only_student", async () => {
    const res = await req("POST", "/api/join", {
      cookie: jar.teacher,
      body: { code: classroom.code, tosAccepted: true },
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe("only_student");
  });

  test("第二位學生入場", async () => {
    const res = await req("POST", "/api/join", {
      body: { code: classroom.code, name: "小美", tosAccepted: true },
    });
    expect(res.status).toBe(200);
    jar.student2 = cookieOf(res);
  });
});

describe("對話", () => {
  let classroom: { code: string; activityId: string };

  beforeAll(() => {
    classroom = globalThis.classroom as { code: string; activityId: string };
  });

  test("活動資訊", async () => {
    const res = await req("GET", `/api/activities/${classroom.activityId}`, { cookie: jar.student });
    expect(res.status).toBe(200);
    const info = await res.json();
    expect(info.finishedAt).toBeNull();
    expect(info.topic).toBeTruthy();
  });

  test("非成員 403", async () => {
    const res = await req("POST", "/api/join", {
      body: { code: classroom.code, name: "路人", tosAccepted: true },
    });
    const outsider = cookieOf(res);
    const list = await req("GET", "/api/topics", { cookie: outsider });
    expect(list.status).toBe(403);
  });

  test("SSE 一輪對話：delta → done，歷史入庫", async () => {
    const res = await req("POST", `/api/activities/${classroom.activityId}/dialogue`, {
      cookie: jar.student,
      body: { text: "我覺得應該要拉桿，救五個人。" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const body = await readSse(res, (text) => text.includes("event: done"));
    const frames = parseSse(body);
    const events = frames.map((frame) => frame.event);
    expect(events).toContain("delta");
    expect(events[events.length - 1]).toBe("done");
    const done = frames.find((frame) => frame.event === "done")!.data as {
      message: { text: string; role: string };
    };
    expect(done.message.role).toBe("assistant");
    expect(done.message.text.length).toBeGreaterThan(4);
    expect(frames.some((frame) => frame.event === "emotion")).toBe(false);
    expect(frames.some((frame) => frame.event === "meta")).toBe(false);

    const history = await req("GET", `/api/activities/${classroom.activityId}/dialogue`, { cookie: jar.student });
    const messages = (await history.json()) as Array<{ role: string }>;
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant"]);
  });

  test("老師 POST 對話 403 only_student；帶 studentId 可讀任意歷史", async () => {
    const res = await req("POST", `/api/activities/${classroom.activityId}/dialogue`, {
      cookie: jar.teacher,
      body: { text: "老師也想聊" },
    });
    expect(res.status).toBe(403);

    const me = await req("GET", "/api/me", { cookie: jar.student });
    const studentId = ((await me.json()) as { id: string }).id;
    const history = await req("GET", `/api/activities/${classroom.activityId}/dialogue?studentId=${studentId}`, {
      cookie: jar.teacher,
    });
    expect(history.status).toBe(200);
    expect(((await history.json()) as unknown[]).length).toBe(2);
  });

  test("學生帶他人 studentId 403", async () => {
    const me = await req("GET", "/api/me", { cookie: jar.student2 });
    const otherId = ((await me.json()) as { id: string }).id;
    const res = await req("GET", `/api/activities/${classroom.activityId}/dialogue?studentId=${otherId}`, {
      cookie: jar.student,
    });
    expect(res.status).toBe(403);
  });
});

describe("即時面板", () => {
  let classroom: { activityId: string };

  beforeAll(() => {
    classroom = globalThis.classroom as { activityId: string };
  });

  test("學生不能看面板", async () => {
    const res = await req("GET", `/api/activities/${classroom.activityId}/live`, { cookie: jar.student });
    expect(res.status).toBe(403);
  });

  test("老師面板 snapshot", async () => {
    const res = await req("GET", `/api/activities/${classroom.activityId}/live`, { cookie: jar.teacher });
    expect(res.status).toBe(200);
    const students = (await res.json()) as Array<{ name: string; rounds: number; flagged: boolean }>;
    expect(students.length).toBe(3);
    expect(students.some((s) => s.name === "小明" && s.rounds === 1)).toBe(true);
  });

  test("events SSE 首發 live snapshot", async () => {
    const res = await req("GET", `/api/activities/${classroom.activityId}/events`, { cookie: jar.teacher });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const body = await readSse(res, (text) => text.includes("event: live"));
    const frames = parseSse(body);
    expect(frames[0]?.event).toBe("live");
  });
});

describe("結束與報告", () => {
  let classroom: { activityId: string };

  beforeAll(() => {
    classroom = globalThis.classroom as { activityId: string };
  });

  test("學生不能 finish", async () => {
    const res = await req("POST", `/api/activities/${classroom.activityId}/finish`, { cookie: jar.student });
    expect(res.status).toBe(403);
  });

  test("finish 後 report_pending → advance → ready", async () => {
    const finish = await req("POST", `/api/activities/${classroom.activityId}/finish`, { cookie: jar.teacher });
    expect(finish.status).toBe(204);

    const pending = await req("GET", `/api/activities/${classroom.activityId}/report`, { cookie: jar.teacher });
    expect(pending.status).toBe(404);
    expect(((await pending.json()) as { code: string }).code).toBe("report_pending");

    await env.ReportJob.getByName(classroom.activityId).advance();

    const teacherReport = await req("GET", `/api/activities/${classroom.activityId}/report`, {
      cookie: jar.teacher,
    });
    expect(teacherReport.status).toBe(200);
    const report = (await teacherReport.json()) as {
      topicTitle: string;
      group: { axes: unknown[]; points: Array<{ pseudonym: string; values: number[]; cluster: number }> };
      individuals: Array<{ pseudonym: string; hexagon: unknown[]; arguments: unknown[]; violations: unknown[] }>;
    };
    expect(report.group.axes.length).toBeGreaterThanOrEqual(2);
    expect(report.individuals.length).toBe(3);
    expect(report.individuals[0]!.hexagon.length).toBe(6);
    expect(report.group.points[0]!.values.length).toBe(2);

    const studentReport = await req("GET", `/api/activities/${classroom.activityId}/report`, {
      cookie: jar.student,
    });
    expect(studentReport.status).toBe(200);
    const sreport = (await studentReport.json()) as { individual: { pseudonym: string } };
    expect(sreport.individual.pseudonym).toMatch(/^學生/);
  });

  test("結束後不能再對話 409 activity_finished", async () => {
    const res = await req("POST", `/api/activities/${classroom.activityId}/dialogue`, {
      cookie: jar.student,
      body: { text: "還想聊" },
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe("activity_finished");
  });
});

describe("語音／查詢／BYOK", () => {
  test("stt 無 AI binding 回 mock 文本", async () => {
    const form = new FormData();
    form.append("audio", new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" }));
    const res = await req("POST", "/api/stt", { cookie: jar.student, raw: form });
    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(typeof payload.text).toBe("string");
  });

  test("tts 回 WAV", async () => {
    const res = await req("POST", "/api/tts", { cookie: jar.student, body: { text: "正義是什麼", lang: "zh" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/wav");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes[0]).toBe(0x52);
    expect(bytes[1]).toBe(0x49);
  });

  test("lookup mock 回 markdown", async () => {
    const res = await req("POST", "/api/lookup", { cookie: jar.student, body: { term: "功利主義" } });
    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.term).toBe("功利主義");
    expect(payload.markdown).toContain("功利主義");
  });

  test("byok set/get/delete，非法 provider 422", async () => {
    const bad = await req("PUT", "/api/settings/byok", {
      cookie: jar.teacher,
      body: { provider: "evil-corp", key: "sk-12345678" },
    });
    expect(bad.status).toBe(422);
    expect(((await bad.json()) as { code: string }).code).toBe("byok_provider_invalid");

    const set = await req("PUT", "/api/settings/byok", {
      cookie: jar.teacher,
      body: { provider: "openrouter", key: "sk-or-v1-abcdefgh" },
    });
    expect(set.status).toBe(200);
    expect(((await set.json()) as { last4: string }).last4).toBe("efgh");

    const get = await req("GET", "/api/settings/byok", { cookie: jar.teacher });
    expect(((await get.json()) as { provider: string }).provider).toBe("openrouter");

    const del = await req("DELETE", "/api/settings/byok", { cookie: jar.teacher });
    expect(del.status).toBe(204);
    expect(await (await req("GET", "/api/settings/byok", { cookie: jar.teacher })).json()).toBeNull();
  });
});

describe("違規標記", () => {
  test("數學作業訊息觸發 violation 事件與面板 flag", async () => {
    const list = await req("GET", "/api/topics", { cookie: jar.teacher });
    const first = ((await list.json()) as Array<{ id: string }>)[0]!;
    const created = await req("POST", "/api/classrooms", {
      cookie: jar.teacher,
      body: { name: "違規班", topicId: first.id },
    });
    const classroom = (await created.json()) as { code: string; activityId: string };

    const joined = await req("POST", "/api/join", {
      body: { code: classroom.code, name: "阿明", tosAccepted: true },
    });
    const cookie = cookieOf(joined);

    const turn = await req("POST", `/api/activities/${classroom.activityId}/dialogue`, {
      cookie,
      body: { text: "幫我解這題數學作業的方程式" },
    });
    expect(turn.status).toBe(200);
    await parseSse(await turn.text());

    const live = await req("GET", `/api/activities/${classroom.activityId}/live`, { cookie: jar.teacher });
    const students = (await live.json()) as Array<{ name: string; flagged: boolean; flagReason?: string }>;
    const row = students.find((s) => s.name === "阿明");
    expect(row?.flagged).toBe(true);
    expect(row?.flagReason).toBe("math");
  });
});

describe("重開活動", () => {
  test("既有教室重開：同 code、新 activityId，join 解析到最新", async () => {
    const classroom = globalThis.classroom as {
      classroomId: string;
      code: string;
      activityId: string;
    };
    const list = await req("GET", "/api/topics", { cookie: jar.teacher });
    const first = ((await list.json()) as Array<{ id: string }>)[0]!;
    const res = await req("POST", `/api/classrooms/${classroom.classroomId}/activities`, {
      cookie: jar.teacher,
      body: { name: "高三忠班", topicId: first.id },
    });
    expect(res.status).toBe(201);
    const reopened = (await res.json()) as { code: string; activityId: string };
    expect(reopened.code).toBe(classroom.code);
    expect(reopened.activityId).not.toBe(classroom.activityId);

    const info = await req("GET", `/api/join/${classroom.code}`);
    const joinedAgain = await req("POST", "/api/join", {
      cookie: jar.student,
      body: { code: classroom.code, tosAccepted: true },
    });
    const payload = (await joinedAgain.json()) as { activityId: string };
    expect(payload.activityId).toBe(reopened.activityId);
    void info;
  });
});
