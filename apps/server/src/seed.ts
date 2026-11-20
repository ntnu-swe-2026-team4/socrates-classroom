import type { Db } from "./db/d1";
import { batch, one, run } from "./db/d1";
import { hashPassword } from "./auth";
import { nowIso } from "./http";

export const FIXTURE_PASSWORD = "demo-demo";

export type FixtureRole = "admin" | "teacher" | "student";

export interface FixtureAccount {
  id: string;
  name: string;
  email: string;
  isAdmin: boolean;
  fixtureRole: FixtureRole;
}

export const FIXTURE_ACCOUNTS: readonly FixtureAccount[] = [
  {
    id: "u_fx_admin",
    name: "系統管理員",
    email: "admin@socrates.tw",
    isAdmin: true,
    fixtureRole: "admin",
  },
  {
    id: "u_fx_lin",
    name: "林老師",
    email: "demo@socrates.tw",
    isAdmin: false,
    fixtureRole: "teacher",
  },
  {
    id: "u_fx_chen",
    name: "陳老師",
    email: "chen@socrates.tw",
    isAdmin: false,
    fixtureRole: "teacher",
  },
  {
    id: "u_fx_student_a",
    name: "王小明",
    email: "student-a@socrates.tw",
    isAdmin: false,
    fixtureRole: "student",
  },
  {
    id: "u_fx_student_b",
    name: "李美玲",
    email: "student-b@socrates.tw",
    isAdmin: false,
    fixtureRole: "student",
  },
  {
    id: "u_fx_student_c",
    name: "陳志豪",
    email: "student-c@socrates.tw",
    isAdmin: false,
    fixtureRole: "student",
  },
  {
    id: "u_fx_student_d",
    name: "林怡君",
    email: "student-d@socrates.tw",
    isAdmin: false,
    fixtureRole: "student",
  },
  {
    id: "u_fx_student_e",
    name: "張家維",
    email: "student-e@socrates.tw",
    isAdmin: false,
    fixtureRole: "student",
  },
];

export const FIXTURE_TOPICS = [
  {
    id: "t_fx_trolley",
    title: "電車難題：你會拉桿嗎？",
    statement: "一輛失控電車即將撞上五個人；你可以拉桿讓它轉向另一條軌道，但會撞死一個人。你拉嗎？",
    prompts: ["你的直覺是拉還是不拉？為什麼？", "如果那一個人是你的家人呢？", "如果那五個人是罪犯呢？"],
  },
  {
    id: "t_fx_surrogate",
    title: "代理孕母的承諾",
    statement: "孕母在契約中同意放棄孩子，生產後卻想留下他。契約應該被遵守嗎？",
    prompts: ["契約成立的前提是什麼？", "身體可以成為契約標的嗎？", "孩子的利益算誰的？"],
  },
  {
    id: "t_fx_ai_rights",
    title: "AI 應該有權利嗎？",
    statement: "如果 AI 表現出與人無異的痛苦，我們有義務顧慮它嗎？",
    prompts: ["權利來自什麼？", "表現出痛苦等於擁有痛苦嗎？", "你的判斷依賴後果還是原則？"],
  },
] as const;

export interface FixtureClassroom {
  id: string;
  name: string;
  code: string;
  activityId: string;
  topicTitle: string;
  teacherEmail: string;
  members: readonly string[];
}

export const FIXTURE_CLASSROOMS: readonly FixtureClassroom[] = [
  {
    id: "c_fx_philosophy",
    name: "高二哲學選修 A",
    code: "demo-phil",
    activityId: "a_fx_philosophy",
    topicTitle: "電車難題：你會拉桿嗎？",
    teacherEmail: "demo@socrates.tw",
    members: ["chen@socrates.tw", "student-a@socrates.tw", "student-b@socrates.tw"],
  },
  {
    id: "c_fx_ethics",
    name: "倫理學讀書會",
    code: "demo-eths",
    activityId: "a_fx_ethics",
    topicTitle: "代理孕母的承諾",
    teacherEmail: "demo@socrates.tw",
    members: [],
  },
];

async function ensureUser(db: Db, account: FixtureAccount, hash: string, at: string): Promise<string> {
  const existing = await one<{ id: string }>(db, "SELECT id FROM users WHERE id = $id OR email = $email", {
    id: account.id,
    email: account.email,
  });
  const params = {
    name: account.name,
    email: account.email,
    hash,
    admin: account.isAdmin ? 1 : 0,
  };
  if (existing) {
    await run(
      db,
      `UPDATE users SET name = $name, email = $email, password_hash = $hash,
         is_admin = $admin, disabled_at = NULL
       WHERE id = $id`,
      { ...params, id: existing.id },
    );
    return existing.id;
  }
  await run(
    db,
    `INSERT INTO users (id, name, email, password_hash, is_admin, created_at)
     VALUES ($id, $name, $email, $hash, $admin, $at)`,
    { ...params, id: account.id, at },
  );
  return account.id;
}

async function ensureTopic(db: Db, topic: (typeof FIXTURE_TOPICS)[number], at: string): Promise<string> {
  const existing = await one<{ id: string }>(db, "SELECT id FROM topics WHERE title = $title AND owner_id IS NULL", {
    title: topic.title,
  });
  if (existing) return existing.id;
  await run(
    db,
    "INSERT INTO topics (id, owner_id, title, statement, prompts, created_at) VALUES ($id, NULL, $title, $statement, $prompts, $at)",
    { id: topic.id, title: topic.title, statement: topic.statement, prompts: JSON.stringify(topic.prompts), at },
  );
  return topic.id;
}

async function ensureClassroom(
  db: Db,
  spec: FixtureClassroom,
  teacherId: string,
  topicId: string,
  at: string,
): Promise<string> {
  const existing = await one<{ id: string; join_code: string; current_activity_id: string | null }>(
    db,
    "SELECT id, join_code, current_activity_id FROM classrooms WHERE id = $id OR (teacher_id = $tid AND name = $name)",
    { id: spec.id, tid: teacherId, name: spec.name },
  );
  if (!existing) {
    await run(
      db,
      "INSERT INTO classrooms (id, name, teacher_id, join_code, current_activity_id, created_at) VALUES ($id, $name, $tid, $code, NULL, $at)",
      { id: spec.id, name: spec.name, tid: teacherId, code: spec.code, at },
    );
  }
  const classroomId = existing?.id ?? spec.id;
  const activityId = existing?.current_activity_id ?? spec.activityId;
  await batch(db, [
    {
      sql: "INSERT OR IGNORE INTO activities (id, classroom_id, topic_id, created_at) VALUES ($aid, $cid, $tid, $at)",
      params: { aid: activityId, cid: classroomId, tid: topicId, at },
    },
    {
      sql: "UPDATE classrooms SET current_activity_id = $aid WHERE id = $cid",
      params: { aid: activityId, cid: classroomId },
    },
  ]);
  return classroomId;
}

export async function seedFixture(db: Db): Promise<void> {
  const at = nowIso();
  const hash = await hashPassword(FIXTURE_PASSWORD);
  const userIds = new Map<string, string>();
  for (const account of FIXTURE_ACCOUNTS) {
    userIds.set(account.email, await ensureUser(db, account, hash, at));
  }
  const topicIds = new Map<string, string>();
  for (const topic of FIXTURE_TOPICS) {
    topicIds.set(topic.title, await ensureTopic(db, topic, at));
  }
  for (const spec of FIXTURE_CLASSROOMS) {
    const teacherId = userIds.get(spec.teacherEmail);
    const topicId = topicIds.get(spec.topicTitle);
    if (!teacherId || !topicId) continue;
    const classroomId = await ensureClassroom(db, spec, teacherId, topicId, at);
    for (const email of spec.members) {
      const userId = userIds.get(email);
      const account = FIXTURE_ACCOUNTS.find((entry) => entry.email === email);
      if (!userId || !account) continue;
      await run(
        db,
        "INSERT OR IGNORE INTO members (classroom_id, user_id, name, tos_accepted_at, joined_at) VALUES ($cid, $uid, $name, $at, $at)",
        { cid: classroomId, uid: userId, name: account.name, at },
      );
    }
  }
}
