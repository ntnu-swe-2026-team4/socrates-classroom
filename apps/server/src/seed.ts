import type { Db } from "./db/d1";
import { one, run } from "./db/d1";
import { hashPassword } from "./auth";
import { newId, nowIso } from "./http";

export const DEMO_TEACHER = { email: "demo@socrates.tw", password: "demo-demo", name: "林老師" };

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

export async function seedDemo(db: Db): Promise<void> {
  const at = nowIso();
  const existing = await one<{ id: string }>(db, "SELECT id FROM users WHERE email = $email", {
    email: DEMO_TEACHER.email,
  });
  if (!existing) {
    const hash = await hashPassword(DEMO_TEACHER.password);
    await run(
      db,
      "INSERT INTO users (id, name, role, email, password_hash, created_at) VALUES ($id, $name, 'teacher', $email, $hash, $at)",
      { id: newId("u_"), name: DEMO_TEACHER.name, email: DEMO_TEACHER.email, hash, at },
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
}
