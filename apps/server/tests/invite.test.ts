import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { routeAgentRequest } from "agents";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { inject } from "vitest";
import { all, one, run } from "../src/db/d1";
import { pseudonymRanks } from "../src/do/report-runner";
import { seedFixture } from "../src/seed";
import {
  call,
  classroomWithActivity,
  cookieOf,
  frames,
  joinGuest,
  participantIdOf,
  must,
  registerStudent,
  speak,
} from "./helpers";

let teacherCookie: string;
let classroomId: string;
let classroomCode: string;
let activityId: string;

const migrations = inject("d1Migrations");

async function createInvite(activity = activityId): Promise<{ token: string; url: string }> {
  const res = await call(`/api/activities/${activity}/invites`, { method: "POST", headers: { Cookie: teacherCookie } });
  expect(res.status).toBe(200);
  return (await res.json()) as { token: string; url: string };
}

async function joinInvite(token: string, name?: string): Promise<Response> {
  return await call(`/api/invites/${token}/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...(name === undefined ? {} : { name }), tosAccepted: true }),
  });
}

async function connect(thread: string, cookie: string): Promise<WebSocket> {
  const response = await routeAgentRequest(
    new Request(`https://example.com/agents/chat/${thread}`, {
      headers: { Upgrade: "websocket", Cookie: cookie },
    }),
    env,
  );
  expect(response?.status).toBe(101);
  const socket = must(response?.webSocket, "chat websocket");
  socket.accept();
  return socket;
}

async function count(table: "users" | "members"): Promise<number> {
  const row = await one<{ n: number }>(env.DB, `SELECT COUNT(*) AS n FROM ${table}`);
  return row?.n ?? 0;
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, migrations);
  await seedFixture(env.DB);
  const login = await call("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "demo@socrates.tw", password: "demo-demo" }),
  });
  expect(login.status).toBe(200);
  teacherCookie = cookieOf(login);
  const created = await classroomWithActivity(teacherCookie, "邀請班");
  classroomId = created.classroomId;
  classroomCode = created.code;
  activityId = created.activityId;
});

describe("activity invites", () => {
  it("teacher gets one stable link per activity; a non-teacher cannot create one", async () => {
    const first = await createInvite();
    const second = await createInvite();
    expect(second.token).toBe(first.token);
    expect(first.token.length).toBeGreaterThanOrEqual(16);
    expect(first.url.endsWith(`/join/a/${first.token}`)).toBe(true);

    const anonymous = await call(`/api/activities/${activityId}/invites`, { method: "POST" });
    expect(anonymous.status).toBe(401);

    const outsider = await registerStudent(classroomCode, "別班老師");
    const denied = await call(`/api/activities/${activityId}/invites`, {
      method: "POST",
      headers: { Cookie: outsider.cookie },
    });
    expect(denied.status).toBe(403);
  });

  it("invite preview resolves the activity topic; unknown token is invite_invalid", async () => {
    const { token } = await createInvite();
    const preview = await call(`/api/invites/${token}`);
    expect(preview.status).toBe(200);
    const body = (await preview.json()) as { activityId: string; classroomName: string; topic: { title: string } };
    expect(body.activityId).toBe(activityId);
    expect(body.classroomName).toBe("邀請班");
    expect(body.topic.title.length).toBeGreaterThan(0);

    const missing = await call("/api/invites/not-a-real-token");
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as { code: string }).code).toBe("invite_invalid");
  });

  it("anonymous guest joins without creating a user or a roster member", async () => {
    const { token } = await createInvite();
    const usersBefore = await count("users");
    const membersBefore = await count("members");

    const res = await joinInvite(token, "無痕訪客");
    expect(res.status).toBe(200);
    const joined = (await res.json()) as { activityId: string; participantId: string; kind: string };
    expect(joined.activityId).toBe(activityId);
    expect(joined.kind).toBe("guest");
    const cookie = cookieOf(res);
    expect(cookie.startsWith("socrates_participant=")).toBe(true);

    expect(await count("users")).toBe(usersBefore);
    expect(await count("members")).toBe(membersBefore);

    const participant = await one<{ user_id: string | null; kind: string; display_name: string }>(
      env.DB,
      "SELECT user_id, kind, display_name FROM activity_participants WHERE activity_id = $aid AND id = $pid",
      { aid: activityId, pid: joined.participantId },
    );
    expect(participant).toEqual({ user_id: null, kind: "guest", display_name: "無痕訪客" });

    const me = await call("/api/me", { headers: { Cookie: cookie } });
    expect(await me.json()).toBeNull();

    const info = await call(`/api/activities/${activityId}`, { headers: { Cookie: cookie } });
    expect(info.status).toBe(200);
    expect(((await info.json()) as { participantId: string }).participantId).toBe(joined.participantId);

    const repeated = await joinInvite(token, "另一個名字");
    expect(((await repeated.json()) as { participantId: string }).participantId).not.toBe(joined.participantId);
    expect(repeated.status).toBe(200);

    const clash = await joinInvite(token, "無痕訪客");
    expect(clash.status).toBe(409);
    expect(((await clash.json()) as { code: string }).code).toBe("name_taken");
  });

  it("reopening the link with the same participant cookie resumes the same participant", async () => {
    const { token } = await createInvite();
    const first = await joinInvite(token, "回訪訪客");
    const joined = (await first.json()) as { participantId: string };
    const cookie = cookieOf(first);

    const again = await call(`/api/invites/${token}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ tosAccepted: true }),
    });
    expect(again.status).toBe(200);
    expect(((await again.json()) as { participantId: string }).participantId).toBe(joined.participantId);
  });

  it("guest with a participant cookie can converse, but cannot take another participant's slot", async () => {
    const { token } = await createInvite();
    const res = await joinInvite(token, "對話訪客");
    const joined = (await res.json()) as { participantId: string };
    const cookie = cookieOf(res);

    await speak(`${activityId}:${joined.participantId}`, cookie, "自由是什麼？");

    const other = await joinGuest(classroomCode, "另一位訪客");
    const socket = await connect(`${activityId}:${other.participantId}`, cookie);
    const rx = frames(socket);
    socket.send(JSON.stringify({ type: "watch" }));
    await rx.until((f) => f.length > 0 || socket.readyState === WebSocket.CLOSED);
    expect(rx.list.some((m) => m.type === "hello")).toBe(false);
    socket.close();

    const forged = await connect(`${activityId}:${joined.participantId}`, other.cookie);
    const forgedRx = frames(forged);
    forged.send(JSON.stringify({ type: "watch" }));
    await forgedRx.until((f) => f.length > 0 || forged.readyState === WebSocket.CLOSED);
    expect(forgedRx.list.some((m) => m.type === "hello")).toBe(false);
    forged.close();
  });

  it("logged-in non-member joins as a guest participant and keeps the account session", async () => {
    const otherClassroom = await classroomWithActivity(teacherCookie, "他班");
    const account = await registerStudent(otherClassroom.code, "他班學生");

    const { token } = await createInvite();
    const res = await call(`/api/invites/${token}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: account.cookie },
      body: JSON.stringify({ tosAccepted: true }),
    });
    expect(res.status).toBe(200);
    const joined = (await res.json()) as { participantId: string; kind: string };
    expect(joined.kind).toBe("guest");

    const participant = await one<{ user_id: string | null; kind: string }>(
      env.DB,
      "SELECT user_id, kind FROM activity_participants WHERE activity_id = $aid AND id = $pid",
      { aid: activityId, pid: joined.participantId },
    );
    expect(participant).toEqual({ user_id: account.userId, kind: "guest" });

    const browserCookie = `${account.cookie}; ${cookieOf(res)}`;
    const info = await call(`/api/activities/${activityId}`, { headers: { Cookie: browserCookie } });
    expect(info.status).toBe(200);
    expect(((await info.json()) as { participantId: string }).participantId).toBe(joined.participantId);

    const me = await call("/api/me", { headers: { Cookie: account.cookie } });
    expect(me.status).toBe(200);
    expect(((await me.json()) as { id: string }).id).toBe(account.userId);

    const classrooms = (await (
      await call("/api/classrooms", { headers: { Cookie: account.cookie } })
    ).json()) as Array<{ id: string }>;
    expect(classrooms.some((entry) => entry.id === classroomId)).toBe(false);

    const members = await all<{ user_id: string }>(env.DB, "SELECT user_id FROM members WHERE classroom_id = $cid", {
      cid: classroomId,
    });
    expect(members.some((entry) => entry.user_id === account.userId)).toBe(false);

    await speak(`${activityId}:${joined.participantId}`, browserCookie, "這樣算參與嗎？");
  }, 20_000);

  it("a member reclaims their display_name from a squatting guest", async () => {
    const squatter = await joinGuest(classroomCode, "搶名學生");
    const account = await registerStudent(classroomCode, "搶名學生");

    const res = await call("/api/join", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: account.cookie },
      body: JSON.stringify({ code: classroomCode, name: "搶名學生", tosAccepted: true }),
    });
    expect(res.status).toBe(200);
    const joined = (await res.json()) as { participantId: string; kind: string };
    expect(joined.kind).toBe("member");
    expect(joined.participantId).not.toBe(squatter.participantId);

    const rows = await all<{ id: string; user_id: string | null; kind: string; display_name: string }>(
      env.DB,
      "SELECT id, user_id, kind, display_name FROM activity_participants WHERE activity_id = $aid",
      { aid: activityId },
    );
    const member = rows.find((row) => row.id === joined.participantId);
    const guest = rows.find((row) => row.id === squatter.participantId);
    expect(member).toMatchObject({ user_id: account.userId, kind: "member", display_name: "搶名學生" });
    expect(guest).toMatchObject({ user_id: null, kind: "guest", display_name: "搶名學生（訪客）" });
  });

  it("a logged-in joiner whose display_name is held by another account keeps joining with a suffix", async () => {
    const classA = await classroomWithActivity(teacherCookie, "同名甲班");
    const classB = await classroomWithActivity(teacherCookie, "同名乙班");
    const first = await registerStudent(classA.code, "同名學生");
    const second = await registerStudent(classB.code, "同名學生");
    const { token } = await createInvite();

    const firstRes = await call(`/api/invites/${token}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: first.cookie },
      body: JSON.stringify({ tosAccepted: true }),
    });
    expect(firstRes.status).toBe(200);
    expect(((await firstRes.json()) as { displayName: string }).displayName).toBe("同名學生");

    const secondRes = await call(`/api/invites/${token}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: second.cookie },
      body: JSON.stringify({ tosAccepted: true }),
    });
    expect(secondRes.status).toBe(200);
    expect(((await secondRes.json()) as { displayName: string }).displayName).toBe("同名學生 2");
  });

  it("an invite-joined participant upgrades to member kind once the account joins the roster", async () => {
    const other = await classroomWithActivity(teacherCookie, "升級班");
    const account = await registerStudent(other.code, "升級學生");
    const { token } = await createInvite();

    const inviteRes = await call(`/api/invites/${token}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: account.cookie },
      body: JSON.stringify({ tosAccepted: true }),
    });
    expect(inviteRes.status).toBe(200);
    const invited = (await inviteRes.json()) as { participantId: string; kind: string };
    expect(invited.kind).toBe("guest");

    const joinRes = await call("/api/join", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: account.cookie },
      body: JSON.stringify({ code: classroomCode, name: "升級學生", tosAccepted: true }),
    });
    expect(joinRes.status).toBe(200);
    const joined = (await joinRes.json()) as { participantId: string; kind: string };
    expect(joined.kind).toBe("member");
    expect(joined.participantId).toBe(invited.participantId);

    const participant = await one<{ kind: string }>(
      env.DB,
      "SELECT kind FROM activity_participants WHERE activity_id = $aid AND id = $pid",
      { aid: activityId, pid: invited.participantId },
    );
    expect(participant).toEqual({ kind: "member" });
  });

  it("revoked and expired invites are rejected with their own codes", async () => {
    const at = new Date().toISOString();
    await run(
      env.DB,
      `INSERT INTO activity_invites (token, activity_id, created_by, created_at, expires_at)
       VALUES ('expired-token', $aid, 'u_fx_lin', $at, '2000-01-01T00:00:00.000Z')`,
      { aid: activityId, at },
    );
    await run(
      env.DB,
      `INSERT INTO activity_invites (token, activity_id, created_by, created_at, revoked_at)
       VALUES ('revoked-token', $aid, 'u_fx_lin', $at, $at)`,
      { aid: activityId, at },
    );

    for (const [token, code] of [
      ["expired-token", "invite_expired"],
      ["revoked-token", "invite_revoked"],
    ] as const) {
      const preview = await call(`/api/invites/${token}`);
      expect(preview.status).toBe(410);
      expect(((await preview.json()) as { code: string }).code).toBe(code);
      const join = await joinInvite(token, "遲到的人");
      expect(join.status).toBe(410);
      expect(((await join.json()) as { code: string }).code).toBe(code);
    }
  });

  it("a finished activity shows as ended in the preview and refuses new guests", async () => {
    const created = await classroomWithActivity(teacherCookie, "收攤班");
    const { token } = await createInvite(created.activityId);
    const finish = await call(`/api/activities/${created.activityId}/finish`, {
      method: "POST",
      headers: { Cookie: teacherCookie, "CF-Connecting-IP": "198.51.100.41" },
    });
    expect(finish.status).toBe(204);

    const preview = await call(`/api/invites/${token}`);
    expect(preview.status).toBe(200);
    expect(((await preview.json()) as { finishedAt: string | null }).finishedAt).not.toBeNull();

    const res = await joinInvite(token, "太晚來的訪客");
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe("activity_finished");
  });

  it("pseudonym serials follow an HMAC of (activity, participant), not the join order", async () => {
    const ids = ["p_a", "p_b", "p_c", "p_d", "p_e"];
    const forward = await pseudonymRanks("secret", "a_fixed", ids);
    const reversed = await pseudonymRanks("secret", "a_fixed", [...ids].reverse());
    const sorted = (map: Map<string, number>) => [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
    expect(sorted(reversed)).toEqual(sorted(forward));
    expect(new Set(forward.values()).size).toBe(ids.length);

    const created = await classroomWithActivity(teacherCookie, "假名班");
    const { token } = await createInvite(created.activityId);

    const participants: string[] = [];
    for (const name of ["甲", "乙", "丙"]) {
      const res = await joinInvite(token, name);
      expect(res.status).toBe(200);
      const joined = (await res.json()) as { participantId: string };
      participants.push(joined.participantId);
      await speak(`${created.activityId}:${joined.participantId}`, cookieOf(res), `我是${name}，這題怎麼看？`);
    }

    const finish = await call(`/api/activities/${created.activityId}/finish`, {
      method: "POST",
      headers: { Cookie: teacherCookie, "CF-Connecting-IP": "198.51.100.42" },
    });
    expect(finish.status).toBe(204);

    const report = await vi.waitFor(
      async () => {
        const res = await call(`/api/activities/${created.activityId}/report`, { headers: { Cookie: teacherCookie } });
        expect(res.status).toBe(200);
        return (await res.json()) as { students: Array<{ participantId: string; pseudonym: string }> };
      },
      { timeout: 60_000, interval: 500 },
    );

    const ranks = await pseudonymRanks(env.AUTH_SECRET ?? "", created.activityId, participants);
    const expected = Object.fromEntries(participants.map((id) => [id, `學生${ranks.get(id)}`]));
    const actual = Object.fromEntries(report.students.map((s) => [s.participantId, s.pseudonym]));
    expect(actual).toEqual(expected);
    expect(new Set(report.students.map((s) => s.pseudonym)).size).toBe(participants.length);
  }, 70_000);

  it("guest participants never see a report, even before the activity closes", async () => {
    const { token } = await createInvite();
    const res = await joinInvite(token, "報告外訪客");
    const cookie = cookieOf(res);
    const report = await call(`/api/activities/${activityId}/report`, { headers: { Cookie: cookie } });
    expect(report.status).toBe(403);
  });
});

describe("removed legacy guest users", () => {
  it("POST /join keeps the class roster path but no longer mints users for anonymous joiners", async () => {
    const usersBefore = await count("users");
    const guest = await joinGuest(classroomCode, "班碼訪客");
    expect(guest.participantId).toBeTruthy();
    expect(await count("users")).toBe(usersBefore);
    const thread = `${activityId}:${guest.participantId}`;
    expect(await participantIdOf(activityId, guest.cookie)).toBe(guest.participantId);
    await speak(thread, guest.cookie, "班碼進來的訪客");
  });
});
