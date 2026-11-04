import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { env } from "cloudflare:test";
import { createApp } from "../src/app";
import { d1, one, run, type Db } from "../src/db/d1";
import { seedDemo } from "../src/seed";
import type { Hono } from "hono";
import type { AppEnv } from "../src/http";
import migrationSql from "../migrations/001_init.sql";

let db: Db;
let app: Hono<AppEnv>;
const cookies = new Map<string, string>();

function baseHeaders(cookie?: string, json = true): Record<string, string> {
  return {
    Accept: "application/json",
    "Accept-Language": "zh-TW",
    ...(json ? { "Content-Type": "application/json" } : {}),
    ...(cookie ? { Cookie: cookie } : {}),
  };
}

async function req(method: string, url: string, options: { cookie?: string; body?: unknown } = {}): Promise<any> {
  return app.request(
    url,
    {
      method,
      headers: baseHeaders(options.cookie, options.body !== undefined),
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    },
    env,
  );
}

async function login(role: "student" | "teacher", name: string): Promise<string> {
  const res = await req("POST", "/api/auth/login", { body: { role, name } });
  expect(res.status).toBe(200);
  const setCookie = res.headers.getSetCookie?.()[0] ?? res.headers.get("set-cookie") ?? "";
  const cookie = setCookie.split(";")[0];
  expect(cookie).toContain("socrates_session=");
  cookies.set(name, cookie);
  return cookie;
}

beforeAll(async () => {
  // 去掉 PRAGMA（D1 不支援，foreign_keys 恆開）與註解行，切成單句後 batch
  const cleaned = migrationSql
    .split("\n")
    .filter((line) => !/^\s*(--|PRAGMA)/i.test(line))
    .join("\n");
  const statements = cleaned
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0)
    .map((statement) => env.DB.prepare(statement));
  await env.DB.batch(statements);
  db = d1(env.DB);
  await seedDemo(db);
  app = createApp(env);
});

afterAll(() => {
  /* pool-workers 每測試檔隔離，不需清理 */
});

function parseSse(text: string) {
  const events: { event: string; data: any }[] = [];
  for (const block of text.split(/\n\n/)) {
    if (!block.trim() || block.trim().startsWith(":")) continue;
    let event = "message";
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).trim());
    }
    if (data.length) events.push({ event, data: JSON.parse(data.join("\n")) });
  }
  return events;
}

async function sendDialogue(cookie: string, url: string, text: string) {
  const res = await app.request(
    url,
    {
      method: "POST",
      headers: { ...baseHeaders(cookie), Accept: "text/event-stream" },
      body: JSON.stringify({ text }),
    },
    env,
  );
  expect(res.status).toBe(200);
  const textBody = await res.text();
  const events = parseSse(textBody);
  const done = events.find((e) => e.event === "done");
  expect(done).toBeTruthy();
  expect(events.some((e) => e.event === "emotion")).toBe(true);
  return { events, message: done!.data.message as any };
}

describe("認證與教室", () => {
  test("未登入回 401，登入後拿到自己", async () => {
    expect((await req("GET", "/api/me")).status).toBe(401);
    const teacher = await login("teacher", "林老師");
    const me = await (await req("GET", "/api/me", { cookie: teacher })).json();
    expect(me.name).toBe("林老師");
    expect(me.role).toBe("teacher");
  });

  test("老師看得到自己的教室與成員", async () => {
    const teacher = cookies.get("林老師")!;
    const classrooms = await (await req("GET", "/api/classrooms", { cookie: teacher })).json();
    expect(classrooms.some((c: any) => c.id === "c1" && c.myRole === "teacher")).toBe(true);
    const members = await (await req("GET", "/api/classrooms/c1/members", { cookie: teacher })).json();
    expect(members.length).toBe(6);
    expect(members.find((m: any) => m.name === "陳○宇").role).toBe("assistant");
  });

  test("學生用邀請碼加入、需要審核的教室走申請流程", async () => {
    const student = await login("student", "新同學");
    const discover = await (await req("GET", "/api/classrooms/discover", { cookie: student })).json();
    expect(discover.some((c: any) => c.id === "c3")).toBe(true);

    const preview = await (await req("GET", "/api/join-codes/LOGIC3", { cookie: student })).json();
    expect(preview.id).toBe("c3");
    const joined = await (await req("POST", "/api/classrooms/c3/join", { cookie: student, body: {} })).json();
    expect(joined.status).toBe("joined");
    expect(joined.classroom.joined).toBe(true);

    const ethics = await (await req("GET", "/api/join-codes/ETHIC5", { cookie: student })).json();
    expect(ethics.requireApproval).toBe(true);
    const answers: Record<string, string> = {
      q1: "我想學會把倫理問題說清楚。",
      q2: "《正義：一場思辨之旅》",
      q3: "可以",
    };
    const pending = await (await req("POST", "/api/classrooms/c4/join", { cookie: student, body: { answers } })).json();
    expect(pending.status).toBe("pending");

    const teacher = cookies.get("林老師")!;
    const applications = await (
      await req("GET", "/api/classrooms/c4/applications?status=pending", { cookie: teacher })
    ).json();
    const mine = (Array.isArray(applications) ? applications : []).find((a: any) => a.studentName === "新同學");
    expect(mine).toBeTruthy();
    const approved = await (
      await req("POST", `/api/applications/${mine.id}/review`, {
        cookie: teacher,
        body: { decision: "approve", note: "歡迎" },
      })
    ).json();
    expect(approved.status).toBe("approved");
    const my = await (await req("GET", "/api/me/applications", { cookie: student })).json();
    expect(my.find((a: any) => a.id === mine.id).status).toBe("approved");
    const classrooms = await (await req("GET", "/api/classrooms", { cookie: student })).json();
    expect(classrooms.some((c: any) => c.id === "c4" && c.joined)).toBe(true);
  });
});

describe("議題、題庫與對話", () => {
  test("建立議題、串流對話、歷史與分享", async () => {
    const guest = await login("student", "訪客");
    const created = await (await req("POST", "/api/archives", { cookie: guest, body: { title: "測試：誠實" } })).json();
    const { message, events } = await sendDialogue(
      guest,
      `/api/archives/${created.id}/dialogue`,
      "我覺得說謊有時候是對的",
    );
    expect(message.text.length).toBeGreaterThan(0);
    expect(events.filter((e) => e.event === "delta").length).toBeGreaterThan(0);
    expect(
      events
        .filter((e) => e.event === "delta")
        .map((e) => e.data.text)
        .join(""),
    ).toBe(message.text);

    const history = await (await req("GET", `/api/archives/${created.id}/dialogue`, { cookie: guest })).json();
    expect(history.length).toBe(2);
    expect(history[1].emotion).toBeTruthy();

    const targets = await (await req("GET", "/api/me/share-targets", { cookie: guest })).json();
    const wang = targets.find((t: any) => t.name === "王○安");
    const patched = await (
      await req("PATCH", `/api/archives/${created.id}`, {
        cookie: guest,
        body: { bank: "private", sharedWithIds: [wang.id] },
      })
    ).json();
    expect(patched.sharedWithIds).toEqual([wang.id]);

    const wangCookie = await login("student", "王○安");
    const shared = await (await req("GET", "/api/archives", { cookie: wangCookie })).json();
    const received = shared.find((a: any) => a.id === created.id);
    expect(received.sharedBy).toBe("訪客");
    expect(received.sharedWithIds).toEqual([]);
    expect(
      (await req("PATCH", `/api/archives/${created.id}`, { cookie: wangCookie, body: { inSummary: true } })).status,
    ).toBe(403);
    expect(
      (await req("POST", `/api/archives/${created.id}/dialogue`, { cookie: wangCookie, body: { text: "hi" } })).status,
    ).toBe(403);
  });

  test("空白訊息回 422，非同步鎖與長度限制", async () => {
    const guest = await login("student", "訪客");
    const created = await (await req("POST", "/api/archives", { cookie: guest, body: { title: "格式檢查" } })).json();
    expect(
      (await req("POST", `/api/archives/${created.id}/dialogue`, { cookie: guest, body: { text: "   " } })).status,
    ).toBe(422);
    expect(
      (await req("POST", `/api/archives/${created.id}/dialogue`, { cookie: guest, body: { text: "x".repeat(2001) } }))
        .status,
    ).toBe(422);
  });
});

describe("公告、討論區與行事曆", () => {
  test("學生看不到排程中的公告，老師看得到", async () => {
    const guest = cookies.get("訪客")!;
    const teacher = cookies.get("林老師")!;
    const studentList = await (await req("GET", "/api/classrooms/c1/announcements", { cookie: guest })).json();
    expect(studentList.some((a: any) => a.title.includes("第二場"))).toBe(false);
    const teacherList = await (await req("GET", "/api/classrooms/c1/announcements", { cookie: teacher })).json();
    expect(teacherList.some((a: any) => a.title.includes("第二場"))).toBe(true);
  });

  test("匿名貼文對同學隱藏身分，對老師顯示", async () => {
    const guest = cookies.get("訪客")!;
    const teacher = cookies.get("林老師")!;
    const created = await (
      await req("POST", "/api/classrooms/c1/posts", {
        cookie: guest,
        body: { topicId: null, body: "匿名發問", anonymous: true },
      })
    ).json();
    expect(created.authorId).toBe("s_guest");
    const asOther = await (await req("GET", "/api/classrooms/c1/posts", { cookie: teacher })).json();
    const row = asOther.find((p: any) => p.id === created.id);
    expect(row.authorLabel).toBe("訪客（匿名）");
    expect(row.authorId).toBe("s_guest");
    const other = await login("student", "李○恩");
    const asStudent = await (await req("GET", "/api/classrooms/c1/posts", { cookie: other })).json();
    expect(asStudent.find((p: any) => p.id === created.id).authorId).toBeNull();
  });

  test("行事曆包含四種系統事件與自訂事件", async () => {
    const teacher = cookies.get("林老師")!;
    const events = await (
      await req("GET", "/api/classrooms/c1/calendar?from=2000-01-01T00:00:00.000Z&to=2100-01-01T00:00:00.000Z", {
        cookie: teacher,
      })
    ).json();
    const kinds = new Set(events.map((e: any) => e.kind));
    expect(kinds.has("topic_due")).toBe(true);
    expect(kinds.has("announcement")).toBe(true);
    expect(kinds.has("discussion_due")).toBe(true);
    expect(kinds.has("custom")).toBe(true);
  });
});

describe("教材與結論報告", () => {
  test("老師上傳教材、學生下載；學生上傳報告", async () => {
    const teacher = cookies.get("林老師")!;
    const guest = cookies.get("訪客")!;
    const topic = (await one<any>(db, "SELECT id FROM topics WHERE title LIKE '正義是否%'"))!;
    const form = new FormData();
    form.append("file", new File(["課堂講義內容"], "講義.txt", { type: "text/plain" }));
    const uploaded = await app.request(
      `/api/topics/${topic.id}/resources/files`,
      {
        method: "POST",
        headers: { Cookie: teacher, Accept: "application/json", "Accept-Language": "zh-TW" },
        body: form,
      },
      env,
    );
    expect(uploaded.status).toBe(200);
    const resource = (await uploaded.json()) as any;
    expect(resource.kind).toBe("file");
    const download = await app.request(resource.file.url, { headers: { Cookie: guest } }, env);
    expect(download.status).toBe(200);
    expect(await download.text()).toBe("課堂講義內容");

    const reportTopic = (await one<any>(db, "SELECT id FROM topics WHERE accepts_reports = 1"))!;
    const reportForm = new FormData();
    reportForm.append("file", new File(["我的結論"], "結論.txt", { type: "text/plain" }));
    reportForm.append("comment", "這是我的結論");
    const submitted = await app.request(
      `/api/topics/${reportTopic.id}/reports`,
      {
        method: "POST",
        headers: { Cookie: guest, Accept: "application/json", "Accept-Language": "zh-TW" },
        body: reportForm,
      },
      env,
    );
    expect(submitted.status).toBe(200);
    const report = (await submitted.json()) as any;
    expect(report.comment).toBe("這是我的結論");
    const list = await (await req("GET", `/api/topics/${reportTopic.id}/reports`, { cookie: teacher })).json();
    expect(list.some((r: any) => r.id === report.id)).toBe(true);
    const deleted = await req("DELETE", `/api/reports/${report.id}`, { cookie: guest });
    expect(deleted.status).toBe(204);
  });
});

describe("多人討論", () => {
  test("學生只看到自己的進度；老師看全班成果", async () => {
    const guest = cookies.get("訪客")!;
    const teacher = cookies.get("林老師")!;
    const task = (await (await req("GET", "/api/classrooms/c1/discussions", { cookie: guest })).json())[0];
    expect(task.myStatus).toBeTruthy();
    const sessionsAsStudent = await req("GET", `/api/discussions/${task.id}/sessions`, { cookie: guest });
    expect(sessionsAsStudent.status).toBe(403);
    const sessions = await (await req("GET", `/api/discussions/${task.id}/sessions`, { cookie: teacher })).json();
    expect(sessions.length).toBeGreaterThan(0);
    expect(sessions.some((s: any) => s.status === "submitted")).toBe(true);
  });

  test("串流訊息、結論與結束後唯讀", async () => {
    const guest = cookies.get("訪客")!;
    const teacher = cookies.get("林老師")!;
    const task = (await (await req("GET", "/api/classrooms/c1/discussions", { cookie: guest })).json())[0];
    const { message } = await sendDialogue(
      guest,
      `/api/discussions/${task.id}/sessions/me/messages`,
      "我認為 AI 可以協助評分，因為它可以檢查遺漏，例如一致性。",
    );
    expect(message.text.length).toBeGreaterThan(0);
    const detail = await (
      await req("PUT", `/api/discussions/${task.id}/sessions/me/conclusion`, {
        cookie: guest,
        body: { conclusion: "我的結論是：輔助可以，取代不行。" },
      })
    ).json();
    expect(detail.status).toBe("submitted");
    const updatedTask = await (await req("GET", `/api/discussions/${task.id}`, { cookie: guest })).json();
    expect(updatedTask.myStatus).toBe("submitted");
    expect(updatedTask.stats.submitted).toBeGreaterThan(0);

    await req("PUT", `/api/discussions/${task.id}/status`, { cookie: teacher, body: { status: "closed" } });
    expect(
      (
        await req("POST", `/api/discussions/${task.id}/sessions/me/messages`, {
          cookie: guest,
          body: { text: "還能說嗎" },
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await req("PUT", `/api/discussions/${task.id}/sessions/me/conclusion`, {
          cookie: guest,
          body: { conclusion: null },
        })
      ).status,
    ).toBe(409);
    await req("PUT", `/api/discussions/${task.id}/status`, { cookie: teacher, body: { status: "open" } });
  });
});

describe("四階段辯論", () => {
  let activityId = "";
  let groupId = "";
  let roomId = "";

  test("學生對話、草稿與確認論點", async () => {
    const guest = cookies.get("訪客")!;
    activityId = (await one<{ id: string }>(db, "SELECT id FROM activities WHERE title LIKE '我們該不該%'"))!.id;
    await sendDialogue(
      guest,
      `/api/activities/${activityId}/dialogue`,
      "我認為誠實很重要，因為信任是社會的基礎。例如朋友之間如果常說謊就無法合作。",
    );
    const progress = await (await req("GET", `/api/activities/${activityId}/progress`, { cookie: guest })).json();
    expect(progress.rounds).toBe(1);
    expect(progress.coverage.claim).toBe(true);
    const draft = await (await req("POST", `/api/activities/${activityId}/position/draft`, { cookie: guest })).json();
    expect(draft.summary.claim.length).toBeGreaterThan(0);
    const position = await (
      await req("PUT", `/api/activities/${activityId}/position`, {
        cookie: guest,
        body: { summary: { claim: "誠實很重要", reason: "信任是基礎", evidence: "朋友之間要合作" } },
      })
    ).json();
    expect(position.confirmed).toBe(true);
    expect(position.coords).toBeNull();
  });

  test("推進到團隊提純、分組與組內投票", async () => {
    const teacher = cookies.get("林老師")!;
    const guest = cookies.get("訪客")!;
    const advanced = await (await req("POST", `/api/activities/${activityId}/advance`, { cookie: teacher })).json();
    expect(advanced.stage).toBe("team");
    const groups = await (await req("GET", `/api/activities/${activityId}/groups`, { cookie: teacher })).json();
    expect(groups.length).toBeGreaterThanOrEqual(2);
    groupId = groups.find((g: any) => g.memberIds.includes("s_guest")).id;
    const message = await (
      await req("POST", `/api/groups/${groupId}/messages`, { cookie: guest, body: { text: "我們可以先確認共同點。" } })
    ).json();
    expect(message.kind).toBe("chat");
    const args = await (await req("POST", `/api/groups/${groupId}/ai/summarize`, { cookie: guest })).json();
    expect(args.length).toBeGreaterThan(0);
    const claim = args.find((a: any) => a.kind === "claim");
    const voted = await (
      await req("POST", `/api/arguments/${claim.id}/vote`, { cookie: guest, body: { vote: "endorse" } })
    ).json();
    expect(voted.votes.s_guest).toBe("endorse");
    const counter = await (await req("POST", `/api/groups/${groupId}/ai/counterexample`, { cookie: guest })).json();
    expect(counter.kind).toBe("ai_counterexample");
  });

  test("推進到比賽、發言、裁判與老師覆寫", async () => {
    const teacher = cookies.get("林老師")!;
    const guest = cookies.get("訪客")!;
    const advanced = await (await req("POST", `/api/activities/${activityId}/advance`, { cookie: teacher })).json();
    expect(advanced.stage).toBe("debate");
    const rooms = await (await req("GET", `/api/activities/${activityId}/rooms`, { cookie: guest })).json();
    expect(rooms.length).toBeGreaterThan(0);
    const room = rooms.find((r: any) => r.groupA === groupId || r.groupB === groupId);
    roomId = room.id;
    const started = await (await req("POST", `/api/rooms/${roomId}/start`, { cookie: guest })).json();
    expect(started.status).toBe("live");
    let speaker = guest;
    if (started.turn.memberId !== "s_guest") {
      const name = (await one<{ name: string }>(db, "SELECT name FROM users WHERE id = $id", {
        id: started.turn.memberId,
      }))!.name;
      speaker = await login("student", name);
    }
    const turn = await (
      await req("POST", `/api/rooms/${roomId}/turns`, {
        cookie: speaker,
        body: { text: "我方主張誠實是原則，因為信任需要可預期。例如合作需要彼此相信。" },
      })
    ).json();
    expect(turn.side).toBe("a");
    const record = await (await req("GET", `/api/rooms/${roomId}/turns`, { cookie: guest })).json();
    const judgment = record.judgments.find((j: any) => j.turnId === turn.id);
    expect(judgment).toBeTruthy();
    const overridden = await (
      await req("PATCH", `/api/judgments/${judgment.id}`, { cookie: teacher, body: { teacherScore: 5 } })
    ).json();
    expect(overridden.teacherScore).toBe(5);
    expect(
      (await req("PATCH", `/api/judgments/${judgment.id}`, { cookie: guest, body: { teacherScore: 3 } })).status,
    ).toBe(403);
  });

  test("組內出現分歧時可以分裂成兩組", async () => {
    const activity = (await one<any>(db, "SELECT * FROM activities WHERE title LIKE '正義是否%'"))!;
    await run(db, "UPDATE activities SET stage = 'team' WHERE id = $id", { id: activity.id });
    const gid = "g_split_test";
    const groupId = "g_split_old";
    void gid;
    await db.batch([
      {
        sql: "INSERT INTO groups (id, activity_id, label, member_ids, centroid, formed_by, seq) VALUES ($id, $aid, '第 1 組', $members, '[0,0]', 'auto', 0)",
        params: { id: groupId, aid: activity.id, members: JSON.stringify(["s_guest", "s_wang", "s_li", "s_lin"]) },
      },
      {
        sql: "INSERT INTO group_arguments (id, group_id, kind, text, parent_id, axis_index, sign, status, votes, countered, seq) VALUES ('arg_split', $gid, 'claim', '測試主張', NULL, 0, 1, 'contested', $votes, 0, 0)",
        params: {
          gid: groupId,
          votes: JSON.stringify({ s_guest: "oppose", s_wang: "oppose", s_li: "endorse", s_lin: "endorse" }),
        },
      },
    ]);
    const res = await req("POST", `/api/groups/${groupId}/split`, { cookie: cookies.get("林老師")! });
    expect(res.status).toBe(200);
    const groups = (await res.json()) as any[];
    expect(groups.length).toBe(2);
    expect(groups.find((g) => g.id === groupId).memberIds.length).toBe(2);
    expect(groups.find((g) => g.id === groupId).memberIds).toEqual(["s_li", "s_lin"]);
    expect(groups.find((g) => g.id !== groupId).memberIds.length).toBe(2);
  });

  test("結束活動後結算與星圖公開", async () => {
    const teacher = cookies.get("林老師")!;
    const guest = cookies.get("訪客")!;
    expect((await req("GET", `/api/activities/${activityId}/star`, { cookie: guest })).status).toBe(403);
    const finished = await (await req("POST", `/api/activities/${activityId}/finish`, { cookie: teacher })).json();
    expect(finished.stage).toBe("done");
    const scores = await (await req("GET", `/api/activities/${activityId}/scores`, { cookie: teacher })).json();
    expect(scores.length).toBeGreaterThan(0);
    const star = await (await req("GET", `/api/activities/${activityId}/star`, { cookie: guest })).json();
    expect(star.axes.length).toBeGreaterThan(0);
    expect(star.hasTimeline).toBe(true);
    const roomTurns = await (await req("GET", `/api/rooms/${roomId}/turns`, { cookie: teacher })).json();
    expect(roomTurns.turns.length).toBeGreaterThan(0);
  });
});
