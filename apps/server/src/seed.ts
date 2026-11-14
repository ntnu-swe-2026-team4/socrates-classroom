import type { Db } from "./db/d1";
import { all, batch, one, run } from "./db/d1";
import { hashPassword } from "./auth";
import { newId, nowIso } from "./http";

export const DEMO_TEACHER = { email: "demo@socrates.tw", password: "demo-demo", name: "林老師" };
const DEMO_SCHOOL = "示範學校";

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
    i18n: {
      en: {
        title: "The trolley problem: would you pull the lever?",
        statement:
          "A runaway trolley is about to hit five people. You can pull a lever to send it onto another track, where it will kill one person. Do you pull it?",
        prompts: [
          "What is your gut answer — pull or not? Why?",
          "What if that one person were your family?",
          "What if the five were criminals?",
        ],
      },
      es: {
        title: "El dilema del tranvía: ¿tirarías de la palanca?",
        statement:
          "Un tranvía sin control está a punto de atropellar a cinco personas. Puedes tirar de una palanca para desviarlo a otra vía, donde matará a una persona. ¿Tiras de ella?",
        prompts: [
          "¿Cuál es tu intuición: tirar o no? ¿Por qué?",
          "¿Y si esa persona fuera de tu familia?",
          "¿Y si los cinco fueran criminales?",
        ],
      },
    },
    statement: "一輛失控電車即將撞上五個人；你可以拉桿讓它轉向另一條軌道，但會撞死一個人。你拉嗎？",
    prompts: ["你的直覺是拉還是不拉？為什麼？", "如果那一個人是你的家人呢？", "如果那五個人是罪犯呢？"],
  },
  {
    title: "代理孕母的承諾",
    i18n: {
      en: {
        title: "The surrogate’s promise",
        statement:
          "A surrogate mother agreed by contract to give up the child, but after giving birth she wants to keep him. Should the contract be honored?",
        prompts: [
          "What makes a contract valid in the first place?",
          "Can a body be the object of a contract?",
          "Whose interests does the child’s welfare belong to?",
        ],
      },
      es: {
        title: "La promesa de la madre subrogada",
        statement:
          "Una madre subrogada aceptó por contrato renunciar al bebé, pero tras el parto quiere quedárselo. ¿Debe cumplirse el contrato?",
        prompts: [
          "¿Qué hace válido un contrato?",
          "¿Puede el cuerpo ser objeto de un contrato?",
          "¿A quién le corresponde el bienestar del niño?",
        ],
      },
    },
    statement: "孕母在契約中同意放棄孩子，生產後卻想留下他。契約應該被遵守嗎？",
    prompts: ["契約成立的前提是什麼？", "身體可以成為契約標的嗎？", "孩子的利益算誰的？"],
  },
  {
    title: "AI 應該有權利嗎？",
    i18n: {
      en: {
        title: "Should AI have rights?",
        statement: "If an AI showed suffering indistinguishable from a human’s, would we owe it moral consideration?",
        prompts: [
          "Where do rights come from?",
          "Is showing pain the same as having pain?",
          "Does your judgment rest on consequences or on principles?",
        ],
      },
      es: {
        title: "¿Debería la IA tener derechos?",
        statement: "Si una IA mostrara un sufrimiento indistinguible del humano, ¿le deberíamos consideración moral?",
        prompts: [
          "¿De dónde vienen los derechos?",
          "¿Mostrar dolor es lo mismo que sentirlo?",
          "¿Tu juicio se basa en consecuencias o en principios?",
        ],
      },
    },
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

export async function seedDemo(db: Db, teacherPassword = DEMO_TEACHER.password): Promise<{ teacherCreated: boolean }> {
  const at = nowIso();
  let teacherId = (
    await one<{ id: string }>(db, "SELECT id FROM users WHERE email = $email", { email: DEMO_TEACHER.email })
  )?.id;
  let teacherCreated = false;
  if (!teacherId) {
    teacherCreated = true;
    teacherId = newId("u_");
    const hash = await hashPassword(teacherPassword);
    await run(
      db,
      "INSERT INTO users (id, name, is_guest, email, password_hash, created_at) VALUES ($id, $name, 0, $email, $hash, $at)",
      { id: teacherId, name: DEMO_TEACHER.name, email: DEMO_TEACHER.email, hash, at },
    );
  }

  let schoolId = (await one<{ id: string }>(db, "SELECT id FROM schools WHERE name = $name", { name: DEMO_SCHOOL }))
    ?.id;
  if (!schoolId) {
    schoolId = newId("sch_");
    await run(db, "INSERT INTO schools (id, name, created_at) VALUES ($id, $name, $at)", {
      id: schoolId,
      name: DEMO_SCHOOL,
      at,
    });
  }
  await run(
    db,
    "UPDATE users SET is_admin = 1, teacher_plan = 'school', school_id = $sid, teacher_terms_at = COALESCE(teacher_terms_at, $at) WHERE id = $id",
    { id: teacherId, sid: schoolId, at },
  );

  const topicCount = await one<{ n: number }>(db, "SELECT COUNT(*) AS n FROM topics WHERE owner_id IS NULL");
  if ((topicCount?.n ?? 0) === 0) {
    for (const topic of SYSTEM_TOPICS) {
      await run(
        db,
        "INSERT INTO topics (id, owner_id, title, statement, prompts, i18n, created_at) VALUES ($id, NULL, $title, $statement, $prompts, $i18n, $at)",
        {
          id: newId("t_"),
          title: topic.title,
          statement: topic.statement,
          prompts: JSON.stringify(topic.prompts),
          i18n: JSON.stringify(topic.i18n),
          at,
        },
      );
    }
  }
  for (const topic of SYSTEM_TOPICS) {
    await run(db, "UPDATE topics SET i18n = $i18n WHERE owner_id IS NULL AND title = $title AND i18n IS NULL", {
      title: topic.title,
      i18n: JSON.stringify(topic.i18n),
    });
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
    await batch(db, [
      {
        sql: "INSERT INTO classrooms (id, name, teacher_id, join_code, current_activity_id, created_at) VALUES ($id, $name, $tid, $code, $aid, $at)",
        params: { id: classroomId, name, tid: teacherId, code, aid: activityId, at },
      },
      {
        sql: "INSERT INTO activities (id, classroom_id, topic_id, created_at) VALUES ($id, $cid, $tid, $at)",
        params: { id: activityId, cid: classroomId, tid: topic.id, at },
      },
    ]);
  }
  return { teacherCreated };
}
