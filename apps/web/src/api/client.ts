import { readActivityId, persistActivityId, recordTerm } from "./local";
import type { Api, ByokStatus, Topic, User } from "./types";

export const DEFAULT_JOIN_CODE = "socrat";

const latency = (ms = 220 + Math.random() * 320) => new Promise<void>((r) => setTimeout(r, ms));

const store = {
  me: null as User | null,
  lastActivityId: readActivityId(),
  byok: null as ByokStatus,
  joined: new Map<string, { user: User; activityId: string }>(),
  live: new Map<string, ReturnType<typeof import("./mock/data").seedLiveStudents>>(),
  turns: new Map<string, number>(),
  classrooms: new Map<string, { name: string; topicId: string }>(),
  activities: new Map<string, string>(),
  customTopics: new Map<string, Topic>(),
};

import { advanceLive, aiTopics, seedLiveStudents, teacher, teacherReport, topics } from "./mock/data";
import { mockSocrates, openingMessage } from "./mock/dialogue";

function topicById(topicId: string): Topic {
  return (
    topics.find((item) => item.id === topicId) ??
    aiTopics.find((item) => item.id === topicId) ??
    store.customTopics.get(topicId) ??
    topics[0]!
  );
}

export const mockApi: Api = {
  async me() {
    await latency(120);
    return store.me;
  },
  async login(_email, _password) {
    await latency(420);
    store.me = teacher;
    return teacher;
  },
  async logout() {
    await latency(120);
    store.me = null;
  },
  async joinByCode(code) {
    await latency(360);
    if (!/^[a-z0-9]{4,8}$/i.test(code)) throw new Error("invalid_code");
    const room = store.classrooms.get(code);
    const topic = room ? topicById(room.topicId) : topics[0]!;
    return { code, classroomName: room?.name ?? "公民課 · 第四週", topic };
  },
  async joinAsGuest(code, name) {
    await latency(420);
    const room = store.classrooms.get(code);
    const activityId = room ? `a-${code}` : `a-${code}-${crypto.randomUUID().slice(0, 6)}`;
    if (room && !store.activities.has(activityId)) {
      store.activities.set(activityId, room.topicId);
    }
    store.lastActivityId = activityId;
    persistActivityId(activityId);
    const user: User = { id: crypto.randomUUID(), name, role: "student" };
    store.me = user;
    store.joined.set(activityId, { user, activityId });
    store.live.set(activityId, seedLiveStudents(activityId));
    return { user, activityId };
  },
  async listTopics() {
    await latency(260);
    return [...topics, ...aiTopics.filter((item) => !store.customTopics.has(item.id)), ...store.customTopics.values()];
  },
  async generateTopics(_direction) {
    await latency(1400);
    return aiTopics;
  },
  async createTopic(input) {
    await latency(500);
    const topic: Topic = {
      id: `t-${crypto.randomUUID().slice(0, 8)}`,
      title: input.title,
      statement: input.statement,
      summary: input.summary ?? "",
      prompts: input.prompts,
    };
    store.customTopics.set(topic.id, topic);
    return topic;
  },
  async createClassroom(name, topicId) {
    await latency(520);
    const code = DEFAULT_JOIN_CODE;
    const activityId = `a-${crypto.randomUUID().slice(0, 8)}`;
    store.classrooms.set(code, { name, topicId });
    store.activities.set(activityId, topicId);
    store.lastActivityId = activityId;
    persistActivityId(activityId);
    store.live.set(activityId, seedLiveStudents(activityId));
    return { code, url: `${location.origin}/join/${code}`, activityId };
  },
  async liveStudents(activityId) {
    await latency(300);
    const prev = store.live.get(activityId) ?? seedLiveStudents(activityId);
    const next = advanceLive(prev);
    store.live.set(activityId, next);
    return next;
  },
  async dialogueHistory(activityId) {
    await latency(280);
    const topicId = store.activities.get(activityId);
    const topic = topicId ? topicById(topicId) : topics[0]!;
    return [openingMessage(topic.prompts, topic.statement)];
  },
  async sendDialogue(activityId, text, onDelta, signal) {
    const historyLength = store.turns.get(activityId) ?? 0;
    store.turns.set(activityId, historyLength + 1);
    let acc = "";
    for await (const { delay, chunk } of mockSocrates(text, historyLength, signal)) {
      await new Promise<void>((r) => setTimeout(r, delay));
      if (signal?.aborted) throw new DOMException("aborted", "AbortError");
      acc += chunk;
      onDelta(chunk);
    }
    return { id: crypto.randomUUID(), role: "assistant" as const, text: acc, at: new Date().toISOString() };
  },
  async stt(audio) {
    void audio;
    await latency(900 + Math.random() * 700);
    return "我認為可以拉桿，因為五條命比一條命重要";
  },
  async tts(text, onAmplitude, signal) {
    return new Promise<void>((resolve) => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = document.documentElement.lang || "zh-Hant";
      const timer = setInterval(() => onAmplitude(0.45 + 0.4 * Math.abs(Math.sin(Date.now() / 110))), 70);
      const stop = () => {
        clearInterval(timer);
        speechSynthesis.cancel();
        resolve();
      };
      signal?.addEventListener("abort", stop, { once: true });
      utterance.onend = () => {
        clearInterval(timer);
        resolve();
      };
      utterance.onerror = () => {
        clearInterval(timer);
        resolve();
      };
      speechSynthesis.speak(utterance);
    });
  },
  async report(_activityId) {
    await latency(500);
    return teacherReport;
  },
  async activityInfo(activityId) {
    await latency(200);
    const topicId = store.activities.get(activityId);
    const topic = topicId ? topicById(topicId) : topics[0]!;
    return {
      id: activityId,
      classroomId: "c-mock",
      classroomName: "公民課 · 第四週",
      topic,
      finishedAt: null,
    };
  },
  async finishActivity(_activityId) {
    await latency(200);
  },
  async byokStatus() {
    await latency(140);
    return store.byok;
  },
  async byokSet(provider, key) {
    await latency(300);
    store.byok = { provider, last4: key.slice(-4) };
    return store.byok;
  },
  async byokClear() {
    await latency(200);
    store.byok = null;
    return store.byok;
  },
  async lookupTerm(term) {
    await latency(500 + Math.random() * 500);
    recordTerm(term);
    return { term, markdown: buildTermMarkdown(term) };
  },
};

function buildTermMarkdown(term: string): string {
  const tiebacks = [
    "這個概念正是蘇格拉底會追問的地方——你用它支持你的立場，但它的定義本身站得住嗎？",
    "注意：你引用這個詞時，其實預設了一整套價值排序。說說看那個排序從何而來？",
    "如果對造人用完全相反的方式定義這個詞，你的論證還成立嗎？",
  ];
  const pick = tiebacks[term.length % tiebacks.length]!;
  return [
    `**${term}**`,
    "",
    `> 一句話：關於「${term}」的精確定義，此處為查詢管線（#76）串接 wiki／SEP 後的摘要輸出。`,
    "",
    "## 哲學連結",
    "",
    pick,
    "",
    "## 常見混淆",
    "",
    "- 「直覺定義」與「原則化定義」的差異——後者才能普遍化",
    "- 詞義的規範性（應然）與描述性（實然）層次",
    "",
    "## 來源",
    "",
    `1. [Stanford Encyclopedia of Philosophy](https://plato.stanford.edu/search/searcher.py?query=${encodeURIComponent(term)})`,
    `2. [中文維基百科](https://zh.wikipedia.org/wiki/${encodeURIComponent(term)})`,
    "",
    "*查詢結果會融入對話流，不另計輪數。*",
  ].join("\n");
}
