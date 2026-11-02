import type { Db } from "./db/d1";
import { one, run } from "./db/d1";

const DAY = 864e5;
const iso = (days: number) => new Date(Date.now() + days * DAY).toISOString();
const uid = (prefix: string) => `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;

async function user(db: Db, id: string, name: string, role: "student" | "teacher") {
  await run(db, "INSERT INTO users (id, name, role, avatar_url, created_at) VALUES ($id, $name, $role, NULL, $at)", {
    id,
    name,
    role,
    at: iso(-30),
  });
}

async function classroom(db: Db, id: string, name: string, description: string, teacherId: string) {
  await run(
    db,
    "INSERT INTO classrooms (id, name, description, teacher_id, created_at, updated_at) VALUES ($id, $name, $description, $teacher, $at, $at)",
    { id, name, description, teacher: teacherId, at: iso(-20) },
  );
}

async function member(
  db: Db,
  classroomId: string,
  userId: string,
  role: "student" | "assistant" = "student",
  status: "active" | "invited" = "active",
) {
  await run(
    db,
    "INSERT INTO classroom_members (classroom_id, user_id, role, status, created_at) VALUES ($cid, $uid, $role, $status, $at)",
    { cid: classroomId, uid: userId, role, status, at: iso(-19) },
  );
}

async function policy(
  db: Db,
  classroomId: string,
  code: string,
  opts: { discoverable?: boolean; approval?: boolean; questionnaire?: unknown[] } = {},
) {
  await run(
    db,
    `INSERT INTO join_policies (classroom_id, code, code_enabled, discoverable, require_approval, questionnaire)
     VALUES ($cid, $code, 1, $discoverable, $approval, $questions)`,
    {
      cid: classroomId,
      code,
      discoverable: opts.discoverable ? 1 : 0,
      approval: opts.approval ? 1 : 0,
      questions: JSON.stringify(opts.questionnaire ?? []),
    },
  );
}

export async function seedDemo(db: Db): Promise<boolean> {
  const existing = await one<{ n: number }>(db, "SELECT COUNT(*) AS n FROM users");
  if ((existing?.n ?? 0) > 0) return false;

  const axes = [
    { key: "ax0", name: "正義來源", left: "約定", right: "本性" },
    { key: "ax1", name: "判準", left: "結果", right: "動機" },
    { key: "ax2", name: "權力", left: "警惕", right: "信任" },
  ];
  const questions = [
    { id: "q1", prompt: "你為什麼想參加這個讀書會？", kind: "paragraph", required: true },
    { id: "q2", prompt: "你讀過哪些哲學或倫理學的書？", kind: "text", required: false },
    {
      id: "q3",
      prompt: "每週能固定參加嗎？",
      kind: "choice",
      options: ["可以", "大部分可以", "不一定"],
      required: true,
    },
  ];

  // D1：直接依序寫入（示種資料不需單一交易；呼叫端以空庫判斷冪等）
  /* 使用者 */
  user(db, "t_lin", "林老師", "teacher");
  user(db, "t_zhang", "張老師", "teacher");
  user(db, "t_chen", "陳老師", "teacher");
  user(db, "s_guest", "訪客", "student");
  user(db, "s_wang", "王○安", "student");
  user(db, "s_li", "李○恩", "student");
  user(db, "s_chen", "陳○宇", "student");
  user(db, "s_lin", "林○彤", "student");
  user(db, "s_wu", "吳○哲", "student");
  user(db, "s_zhou", "周○妤", "student");

  /* 教室 */
  classroom(db, "c1", "高二哲學選修 A", "從柏拉圖《理想國》出發，練習用提問把自己的想法說清楚。", "t_lin");
  member(db, "c1", "s_guest");
  member(db, "c1", "s_wang");
  member(db, "c1", "s_li");
  member(db, "c1", "s_chen", "assistant");
  member(db, "c1", "s_lin");
  member(db, "c1", "s_wu");
  policy(db, "c1", "PLATO7");

  classroom(db, "c2", "高二哲學選修 B", "", "t_chen");
  member(db, "c2", "s_guest", "student", "invited");
  policy(db, "c2", "PLATO8");

  classroom(
    db,
    "c3",
    "大學先修：邏輯與論證",
    "認識常見的謬誤，練習把一段論證拆成前提與結論。開放所有高中生加入。",
    "t_zhang",
  );
  member(db, "c3", "s_zhou");
  policy(db, "c3", "LOGIC3", { discoverable: true });

  classroom(db, "c4", "倫理學讀書會", "每週讀一篇倫理學經典，名額有限，請簡單說明你想參加的原因。", "t_lin");
  member(db, "c4", "s_wang");
  policy(db, "c4", "ETHIC5", { discoverable: true, approval: true, questionnaire: questions });

  /* 教室議題 + 四階段活動 */
  const t1 = uid("t");
  const a1 = uid("d");
  await run(
    db,
    `INSERT INTO topics (id, classroom_id, title, description, due_at, accepts_reports, activity_id, created_at, updated_at)
       VALUES ($id, 'c1', $title, $desc, $due, 0, $aid, $at, $at)`,
    {
      id: t1,
      title: "正義是否只是強者的利益？",
      desc: "《理想國》第一卷，色拉敘馬霍斯主張「正義就是強者的利益」。先各自和蘇格拉底對話釐清立場，再分組辯論。",
      due: iso(7),
      aid: a1,
      at: iso(-3),
    },
  );
  await run(
    db,
    `INSERT INTO activities (id, classroom_id, title, statement, answer_mode, axes, group_size, stage, stage_deadline, topic_id, created_at, updated_at)
       VALUES ($id, 'c1', $title, $title, 'both', $axes, 3, 'individual', NULL, $tid, $at, $at)`,
    { id: a1, title: "正義是否只是強者的利益？", axes: JSON.stringify(axes), tid: t1, at: iso(-3) },
  );
  await run(db, "UPDATE topics SET activity_id = $aid WHERE id = $id", { aid: a1, id: t1 });
  await run(
    db,
    `INSERT INTO topic_resources (id, topic_id, kind, name, url, file_id, added_at, seq)
       VALUES ($id, $tid, 'link', $name, $url, NULL, $at, 0)`,
    { id: uid("r"), tid: t1, name: "《理想國》第一卷導讀", url: "https://zh.wikipedia.org/wiki/理想國", at: iso(-3) },
  );

  const t2 = uid("t");
  const a2 = uid("d");
  await run(
    db,
    `INSERT INTO topics (id, classroom_id, title, description, due_at, accepts_reports, activity_id, created_at, updated_at)
       VALUES ($id, 'c1', $title, $desc, $due, 1, $aid, $at, $at)`,
    {
      id: t2,
      title: "我們該不該永遠說實話？",
      desc: "康德認為說謊在任何情況下都是錯的，即使門口的殺人犯問你朋友躲在哪裡。你同意嗎？和蘇格拉底聊聊你的理由。",
      due: iso(14),
      aid: a2,
      at: iso(-1),
    },
  );
  await run(
    db,
    `INSERT INTO activities (id, classroom_id, title, statement, answer_mode, axes, group_size, stage, stage_deadline, topic_id, created_at, updated_at)
       VALUES ($id, 'c1', $title, $title, 'both', $axes, 3, 'individual', NULL, $tid, $at, $at)`,
    {
      id: a2,
      title: "我們該不該永遠說實話？",
      axes: JSON.stringify([
        { key: "ax0", name: "道德判準", left: "後果", right: "義務" },
        { key: "ax1", name: "誠實的範圍", left: "有例外", right: "無例外" },
      ]),
      tid: t2,
      at: iso(-1),
    },
  );
  await run(db, "UPDATE topics SET activity_id = $aid WHERE id = $id", { aid: a2, id: t2 });

  /* 公告 */
  await run(
    db,
    `INSERT INTO announcements (id, classroom_id, title, body, pinned, publish_at, author_id, created_at, updated_at)
       VALUES ($id, 'c1', $title, $body, $pinned, $publish, 't_lin', $at, $at)`,
    {
      id: uid("an"),
      title: "期中辯論的評分方式",
      pinned: 1,
      publish: iso(-5),
      at: iso(-5),
      body: "期中辯論占學期成績 30%：\n・個人調查 30%\n・團隊提純 30%\n・辯論比賽 40%\n\nAI 裁判的分數僅供參考，最後由老師確認。",
    },
  );
  await run(
    db,
    `INSERT INTO announcements (id, classroom_id, title, body, pinned, publish_at, author_id, created_at, updated_at)
       VALUES ($id, 'c1', $title, $body, $pinned, $publish, 't_lin', $at, $at)`,
    {
      id: uid("an"),
      title: "下週請先讀完《理想國》第一卷",
      pinned: 0,
      publish: iso(-1),
      at: iso(-1),
      body: "辯論「正義是否只是強者的利益？」的閱讀材料已放在辯論頁，上課前請先讀完。",
    },
  );
  await run(
    db,
    `INSERT INTO announcements (id, classroom_id, title, body, pinned, publish_at, author_id, created_at, updated_at)
       VALUES ($id, 'c1', $title, $body, $pinned, $publish, 't_lin', $at, $at)`,
    {
      id: uid("an"),
      title: "第二場辯論開放報名",
      pinned: 0,
      publish: iso(3),
      at: iso(0),
      body: "（排程中的公告：學生要到發布時間才看得到）",
    },
  );

  /* 討論區 */
  const p1 = uid("p");
  const p2 = uid("p");
  await run(
    db,
    `INSERT INTO posts (id, classroom_id, topic_id, parent_id, author_id, body, anonymous, author_role, deleted, created_at)
       VALUES ($id, 'c1', NULL, NULL, 't_lin', $body, 0, 'teacher', 0, $at)`,
    { id: p1, body: "課堂上來不及問的問題，都可以在這裡發問。也可以匿名，同學看不到你是誰。", at: iso(-4) },
  );
  await run(
    db,
    `INSERT INTO posts (id, classroom_id, topic_id, parent_id, author_id, body, anonymous, author_role, deleted, created_at)
       VALUES ($id, 'c1', NULL, NULL, 's_chen', $body, 1, 'student', 0, $at)`,
    { id: p2, body: "期中辯論可以和別組的同學一起準備資料嗎？", at: iso(-2) },
  );
  await run(
    db,
    `INSERT INTO posts (id, classroom_id, topic_id, parent_id, author_id, body, anonymous, author_role, deleted, created_at)
       VALUES ($id, 'c1', NULL, $parent, 't_lin', $body, 0, 'teacher', 0, $at)`,
    { id: uid("p"), parent: p2, body: "可以一起找資料，但發言內容請自己準備。", at: iso(-1.8) },
  );
  await run(
    db,
    `INSERT INTO posts (id, classroom_id, topic_id, parent_id, author_id, body, anonymous, author_role, deleted, created_at)
       VALUES ($id, 'c1', $tid, NULL, 's_wang', $body, 0, 'student', 0, $at)`,
    { id: uid("p"), tid: t1, body: "色拉敘馬霍斯說的「強者」，是指統治者，還是任何有力量的人？", at: iso(-1) },
  );

  /* 多人討論 */
  const dq = uid("dq");
  await run(
    db,
    `INSERT INTO discussions (id, classroom_id, title, prompt, conclusion_hint, due_at, max_rounds, status, created_at, updated_at)
       VALUES ($id, 'c1', $title, $prompt, $hint, $due, 12, 'open', $at, $at)`,
    {
      id: dq,
      title: "AI 可以替老師打成績嗎？",
      prompt:
        "有人說 AI 評分更客觀、也更快；也有人說評分本來就包含老師對學生的理解。\n先自己跟蘇格拉底聊，把你的理由講清楚，再寫下你的結論。",
      hint: "請在結論裡寫出：你的主張、最主要的一個理由，以及你想到最強的反對意見要怎麼回應。",
      due: iso(5),
      at: iso(-2),
    },
  );
  const studentIds = ["s_guest", "s_wang", "s_li", "s_lin", "s_wu"];
  const sessionIds = new Map<string, string>();
  for (const sid of studentIds) {
    const id = uid("ds");
    sessionIds.set(sid, id);
    await run(
      db,
      "INSERT INTO discussion_sessions (id, discussion_id, student_id, conclusion, submitted_at, last_active_at) VALUES ($id, $did, $sid, NULL, NULL, NULL)",
      { id, did: dq, sid },
    );
  }
  const exchanges: Record<string, string[][]> = {
    s_wang: [
      [
        "我覺得 AI 評分比較客觀，因為它不會因為喜不喜歡這個學生而加分。",
        "客觀和公平是同一件事嗎？如果 AI 的訓練資料本身就偏頗，你還會說它客觀嗎？",
      ],
      [
        "這樣說的話，AI 的偏頗可能比老師更難發現，因為大家會以為機器沒有偏見。",
        "所以你在意的其實是「偏見能不能被檢查」，而不是「有沒有偏見」嗎？",
      ],
      [
        "對，我現在的主張是：AI 可以輔助評分，但最後的分數要能說清楚理由，而且老師要能推翻。",
        "如果老師最後都照 AI 的分數走，你剛剛說的「能推翻」還剩下什麼意義？",
      ],
    ],
    s_li: [
      [
        "我反對，因為打分數不只是看答案對不對，還要看這個學生進步了多少。",
        "進步要怎麼衡量？如果一個學生進步很多但還是全班最後，你會給他高分嗎？",
      ],
    ],
  };
  for (const [sid, pairs] of Object.entries(exchanges)) {
    let t = Date.now() - 2 * DAY;
    for (const [userText, aiText] of pairs) {
      await run(
        db,
        "INSERT INTO discussion_messages (id, discussion_id, student_id, role, text, emotion, created_at) VALUES ($id, $did, $sid, 'user', $text, NULL, $at)",
        { id: uid("m"), did: dq, sid, text: userText, at: new Date(t).toISOString() },
      );
      await run(
        db,
        "INSERT INTO discussion_messages (id, discussion_id, student_id, role, text, emotion, created_at) VALUES ($id, $did, $sid, 'assistant', $text, 'neutral', $at)",
        { id: uid("m"), did: dq, sid, text: aiText, at: new Date(t + 60_000).toISOString() },
      );
      t += 7 * 60_000;
    }
    await run(db, "UPDATE discussion_sessions SET last_active_at = $at WHERE id = $id", {
      at: new Date(t).toISOString(),
      id: sessionIds.get(sid),
    });
  }
  await run(
    db,
    "UPDATE discussion_sessions SET conclusion = $text, submitted_at = $at, last_active_at = $at WHERE id = $id",
    {
      text: "我的結論是：AI 可以協助評分，但不能取代老師最後的判斷。最主要的理由是：分數必須附上可檢查的理由，而 AI 的偏見往往藏在資料裡。最強的反對意見是「老師也會有偏見」，我的回應是：至少老師的偏見可以被學生當面質疑。",
      at: iso(-1),
      id: sessionIds.get("s_wang"),
    },
  );

  /* 私人題庫分享 */
  for (const [id, title, bank, snippet] of [
    [
      "a_demo1",
      "正義是否只是強者的利益？",
      "public",
      "我一開始認為強者說了算，但後來發現「強者也可能誤判自己的利益」這件事把我的論點推翻了一半。",
    ],
    [
      "a_demo2",
      "我們該不該永遠說實話？",
      "private",
      "蘇格拉底一直追問「救人一命」跟「誠實」哪個才是更根本的原則，我後來也說不清楚了。",
    ],
    [
      "a_demo3",
      "忒修斯之船：改變了多少才不是原來的你？",
      null,
      "從一片木板到整艘船，我發現「同一性」比我想的更依賴我們怎麼定義它。",
    ],
  ] as const) {
    await run(
      db,
      `INSERT INTO archives (id, owner_id, title, date, rounds, snippet, bank, in_summary, activity_id, created_at, updated_at)
         VALUES ($id, 's_guest', $title, $date, $rounds, $snippet, $bank, 0, NULL, $at, $at)`,
      { id, title, date: iso(-3), rounds: 6, snippet, bank, at: iso(-3) },
    );
  }
  await run(
    db,
    `INSERT INTO archives (id, owner_id, title, date, rounds, snippet, bank, in_summary, activity_id, created_at, updated_at)
       VALUES ('a_demo4', 's_wang', $title, $date, 9, $snippet, 'private', 0, NULL, $at, $at)`,
    {
      title: "如果記憶可以複製，那個人還是原來的人嗎？",
      date: iso(-4),
      snippet: "我們從「換掉一個零件」一路推到「全部換掉」，到後來我分不清問題是出在記憶還是身體。",
      at: iso(-4),
    },
  );
  await run(db, "INSERT INTO archive_shares (archive_id, user_id) VALUES ('a_demo4', 's_guest')", {});
  await run(
    db,
    "INSERT INTO join_applications (id, classroom_id, student_id, answers, status, created_at, reviewed_at, note) VALUES ($id, 'c4', 's_li', $answers, 'pending', $at, NULL, NULL)",
    {
      id: uid("ap"),
      answers: JSON.stringify([
        { questionId: "q1", prompt: questions[0].prompt, answer: "上學期讀了《正義：一場思辨之旅》，想找人一起討論。" },
        { questionId: "q2", prompt: questions[1].prompt, answer: "桑德爾《正義》、《蘇菲的世界》" },
        { questionId: "q3", prompt: questions[2].prompt, answer: "可以" },
      ]),
      at: iso(-2),
    },
  );

  /* 行事曆自訂事件 */
  await run(
    db,
    "INSERT INTO calendar_events (id, classroom_id, title, at, note, created_by, created_at) VALUES ($id, 'c1', $title, $at, $note, 't_lin', $now)",
    { id: uid("ce"), title: "哲學週座談", at: iso(10), note: "放學後在圖書館三樓。", now: iso(-1) },
  );
  return true;
}
