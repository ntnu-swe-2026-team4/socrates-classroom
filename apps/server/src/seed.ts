import type { Db } from "./db/d1";
import { all, one, run } from "./db/d1";
import { hashPassword } from "./auth";
import { newId, nowIso } from "./http";

export const DEMO_TEACHER = { email: "demo@socrates.tw", password: "demo-demo", name: "林老師" };

const CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const CODE_MAX = 256 - (256 % CODE_ALPHABET.length);

function newCode(): string {
  let code = "";
  while (code.length < 6) {
    const [byte] = crypto.getRandomValues(new Uint8Array(1));
    if (byte === undefined || byte >= CODE_MAX) continue;
    code += CODE_ALPHABET[byte % CODE_ALPHABET.length]!;
  }
  return code;
}

const SYSTEM_TOPICS = [
  {
    title: "電車難題：你會拉桿嗎？",
    statement: "一輛失控電車即將撞上五個人；你可以拉桿讓它轉向另一條軌道，但會撞死一個人。你拉嗎？",
    prompts: ["你的直覺是拉還是不拉？為什麼？", "如果那一個人是你的家人呢？", "如果那五個人是罪犯呢？"],
  },
  {
    title: "代理孕母的承諾",
    statement: "孕母在契約中同意放棄孩子，生產後卻想留下他。契約應該被遵守嗎？",
    prompts: ["契約成立的前提是什麼？", "身體可以成為契約標的嗎？", "孩子的利益算誰的？"],
  },
  {
    title: "AI 應該有權利嗎？",
    statement: "如果 AI 表現出與人無異的痛苦，我們有義務顧慮它嗎？",
    prompts: ["權利來自什麼？", "表現出痛苦等於擁有痛苦嗎？", "你的判斷依賴後果還是原則？"],
  },
];

const DEMO_CLASSROOMS = ["高二哲學選修 A", "倫理學讀書會"];

export interface DemoClassroom {
  name: string;
  code: string;
  activityId: string;
  topicId: string;
}

export async function seedDemo(db: Db): Promise<void> {
  const at = nowIso();
  let teacherId = (
    await one<{ id: string }>(db, "SELECT id FROM users WHERE email = $email", { email: DEMO_TEACHER.email })
  )?.id;
  if (!teacherId) {
    teacherId = newId("u_");
    const hash = await hashPassword(DEMO_TEACHER.password);
    await run(
      db,
      "INSERT INTO users (id, name, role, email, password_hash, created_at) VALUES ($id, $name, 'teacher', $email, $hash, $at)",
      { id: teacherId, name: DEMO_TEACHER.name, email: DEMO_TEACHER.email, hash, at },
    );
  }

  const topicCount = await one<{ n: number }>(db, "SELECT COUNT(*) AS n FROM topics WHERE owner_id IS NULL");
  if ((topicCount?.n ?? 0) === 0) {
    for (const topic of SYSTEM_TOPICS) {
      await run(
        db,
        "INSERT INTO topics (id, owner_id, title, statement, prompts, created_at) VALUES ($id, NULL, $title, $statement, $prompts, $at)",
        { id: newId("t_"), title: topic.title, statement: topic.statement, prompts: JSON.stringify(topic.prompts), at },
      );
    }
  }

  const topics = await all<{ id: string; title: string }>(
    db,
    "SELECT id, title FROM topics WHERE owner_id IS NULL ORDER BY created_at",
  );
  const classrooms = await all<{ name: string }>(db, "SELECT name FROM classrooms WHERE teacher_id = $tid", {
    tid: teacherId,
  });
  const existingNames = new Set(classrooms.map((row) => row.name));

  for (const [index, name] of DEMO_CLASSROOMS.entries()) {
    if (existingNames.has(name)) continue;
    const topic = topics[index % topics.length];
    if (!topic) break;
    const classroomId = newId("c_");
    const activityId = newId("a_");
    const code = newCode();
    await run(
      db,
      "INSERT INTO classrooms (id, name, teacher_id, join_code, current_activity_id, created_at) VALUES ($id, $name, $tid, $code, $aid, $at)",
      { id: classroomId, name, tid: teacherId, code, aid: activityId, at },
    );
    await run(db, "INSERT INTO activities (id, classroom_id, topic_id, created_at) VALUES ($id, $cid, $tid, $at)", {
      id: activityId,
      cid: classroomId,
      tid: topic.id,
      at,
    });
  }
}
