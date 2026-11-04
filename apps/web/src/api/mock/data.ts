import type { Report, StudentLive, Topic, User } from "../types";

export const topics: Topic[] = [
  {
    id: "trolley",
    title: "電車難題",
    statement: "為了救五個人而犧牲一個人，是對的嗎？",
    summary: "一輛失控的電車即將撞上五個人。你可以拉下操縱桿，讓它轉向另一條軌道——但那條軌道上有一個人。",
    prompts: ["我會拉桿", "我不會拉桿", "這取決於情況"],
  },
  {
    id: "organ",
    title: "器官移植",
    statement: "一位醫生可以犧牲一位健康的人，救五個垂死的病人嗎？",
    summary: "五名病人各自需要一種器官移植，否則會死。一位健康的人正好能提供全部五種器官。",
    prompts: ["不可以，這是謀殺", "如果五條命換一條呢？"],
  },
  {
    id: "merit",
    title: "努力的報酬",
    statement: "收入應該取決於努力，還是取決於貢獻？",
    summary: "一位清潔隊員每天工作十二小時，一位投資銀行家每天工作六小時。後者的收入是前者的三十倍。",
    prompts: ["努力應該決定收入", "貢獻應該決定收入"],
  },
  {
    id: "speech",
    title: "言論的界線",
    statement: "傷害性的言論應該被禁止嗎？",
    summary: "一場集會上的演說激起了對某群體的敵意。沒有直接暴力，但隔天發生了攻擊事件。",
    prompts: ["應該禁止", "不應該禁止", "看情況"],
  },
  {
    id: "future",
    title: "對未來世代的義務",
    statement: "我們有義務為尚未出生的人犧牲現在的享受嗎？",
    summary: "限制今天的碳排放會降低現在的生活水準，但能減少百年後的氣候災害。",
    prompts: ["有義務", "沒有義務"],
  },
];

export const teacher: User = { id: "u-teacher", name: "林老師", role: "teacher" };

const students: { id: string; name: string }[] = [
  { id: "s1", name: "陳冠廷" },
  { id: "s2", name: "王芷晴" },
  { id: "s3", name: "李祐辰" },
  { id: "s4", name: "黃子寧" },
  { id: "s5", name: "張嘉航" },
  { id: "s6", name: "周郁雯" },
  { id: "s7", name: "吳承翰" },
  { id: "s8", name: "林品妍" },
];

const utterances = [
  "我覺得五條命比一條命重要",
  "可是那個人也有活下去的權利",
  "如果那五個人是我的家人…",
  "動手和放任真的有差嗎？",
  "規則不能有例外嗎？",
  "我還是覺得數字不能決定一切",
  "那醫生不就變成殺人了",
  "讓我想想…",
];

const flagReasons = ["疑似數學作業", "離題閒聊", "重複測試系統"];

export function seedLiveStudents(activityId: string): StudentLive[] {
  void activityId;
  return students.map((s, i) => ({
    ...s,
    status: i % 3 === 0 ? "active" : i % 3 === 1 ? "idle" : "speaking",
    rounds: (i * 3 + 2) % 11,
    flagged: i === 2 || i === 6,
    flagReason: i === 2 ? flagReasons[0] : i === 6 ? flagReasons[1] : undefined,
    lastUtterance: utterances[i % utterances.length]!,
  }));
}

export function advanceLive(prev: StudentLive[]): StudentLive[] {
  return prev.map((s) => {
    const speaking = s.status === "speaking";
    if (speaking) return { ...s, status: "idle" };
    const chance = Math.random();
    if (chance < 0.35) {
      return {
        ...s,
        status: "active",
        rounds: s.rounds + 1,
        lastUtterance: utterances[Math.floor(Math.random() * utterances.length)]!,
      };
    }
    if (chance < 0.5) return { ...s, status: "speaking" };
    return { ...s, status: "idle" };
  });
}

export const report: Report = {
  topicTitle: "電車難題",
  group: {
    axes: [
      { name: "立場", left: "絕對不可犧牲", right: "結果決定一切", color: "#e0a83c" },
      { name: "參與", left: "沉默", right: "投入", color: "#6fbf8a" },
    ],
    points: [
      { pseudonym: "學生 A", values: [-0.64, 0.44], cluster: 0 },
      { pseudonym: "學生 B", values: [-0.52, -0.2], cluster: 0 },
      { pseudonym: "學生 C", values: [0.64, -0.4], cluster: 1 },
      { pseudonym: "學生 D", values: [0.76, 0.16], cluster: 1 },
      { pseudonym: "學生 E", values: [0.0, 0.1], cluster: 2 },
      { pseudonym: "學生 F", values: [0.16, -0.04], cluster: 2 },
      { pseudonym: "學生 G", values: [-0.12, 0.24], cluster: 2 },
      { pseudonym: "學生 H", values: [-0.76, -0.7], cluster: 0 },
    ],
    clusters: [
      { id: 0, label: "義務論傾向" },
      { id: 1, label: "結果論傾向" },
      { id: 2, label: "條件論傾向" },
    ],
  },
  individuals: students.slice(0, 5).map((s, i) => ({
    studentName: s.name,
    hexagon: [
      { label: "辨識盲點", value: 0.4 + (i % 3) * 0.2 },
      { label: "區分前提", value: 0.5 + (i % 4) * 0.15 },
      { label: "普遍化原則", value: 0.35 + (i % 2) * 0.3 },
      { label: "理由支持", value: 0.55 + (i % 3) * 0.15 },
      { label: "對立同理", value: 0.3 + (i % 5) * 0.12 },
      { label: "確定度變化", value: 0.45 + (i % 2) * 0.25 },
    ],
    arguments: [
      {
        claim: "不應該拉桿，因為主動殺人在道德上不同於放任死亡",
        reason: "行為與後果之間的道德界線：動手造成死亡比未能阻止死亡更嚴重",
        tension: "若「動手／放任」的界線如此關鍵，為何多數人仍願意轉向電車？",
      },
      {
        claim: "五條命大於一條命",
        reason: "在無法兼得時，減少整體傷害是合理的優先順序",
        tension: "同學在器官移植情境中拒絕了同樣的算式——數量何時重要？",
      },
    ],
    violations: i === 1 ? [{ turn: 7, type: "疑似數學作業", excerpt: "幫我算這題二次函數的極值…" }] : [],
  })),
};

export const aiTopics: Topic[] = [
  {
    id: "ai-labor",
    title: "AI 與工作的價值",
    statement: "當機器能做大多數工作，工作的意義是什麼？",
    summary: "自動化取代了大量職位。人們失去了收入來源，也失去了身份與尊嚴的來源。",
    prompts: ["工作本身就是價值", "工作只是手段"],
  },
  {
    id: "ai-inherit",
    title: "繼承的公平",
    statement: "子女應該繼承父母累積的優勢嗎？",
    summary: "財富、人脈、教育機會代代相傳。起跑點的差距，是努力能夠彌補的嗎？",
    prompts: ["繼承是權利", "繼承不公平"],
  },
  {
    id: "ai-punish",
    title: "懲罰的正当性",
    statement: "懲罰是為了報應，還是為了預防？",
    summary: "一位老人偷竊藥物救妻子。報應論者要求懲罰，預防論者認為懲罰無益。",
    prompts: ["懲罰是報應", "懲罰是預防"],
  },
];
