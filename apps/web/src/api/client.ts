import type { Api, ByokStatus, User } from "./types";
import { aiTopics, advanceLive, report, seedLiveStudents, teacher, topics } from "./mock/data";
import { mockSocrates, openingMessage } from "./mock/dialogue";

const latency = (ms = 220 + Math.random() * 320) => new Promise<void>((r) => setTimeout(r, ms));

const store = {
  me: null as User | null,
  byok: null as ByokStatus,
  joined: new Map<string, { user: User; activityId: string }>(),
  live: new Map<string, ReturnType<typeof seedLiveStudents>>(),
  turns: new Map<string, number>(),
};

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
    return { code, classroomName: "公民課 · 第四週", topic: topics[0]! };
  },
  async joinAsGuest(code, name) {
    await latency(420);
    const activityId = `a-${code}`;
    const user: User = { id: crypto.randomUUID(), name, role: "student" };
    store.me = user;
    store.joined.set(activityId, { user, activityId });
    store.live.set(activityId, seedLiveStudents(activityId));
    return { user, activityId };
  },
  async listTopics() {
    await latency(260);
    return topics;
  },
  async generateTopics(_direction) {
    await latency(1400);
    return aiTopics;
  },
  async createClassroom(name, topicId) {
    void name;
    void topicId;
    await latency(520);
    const code = "socrat";
    const activityId = `a-${crypto.randomUUID().slice(0, 8)}`;
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
    const topic = topics[0]!;
    void activityId;
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
  async tts(text, onBoundary, signal) {
    return new Promise<void>((resolve) => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = document.documentElement.lang || "zh-Hant";
      utterance.onboundary = (event) => onBoundary(event.charIndex);
      utterance.onend = () => resolve();
      utterance.onerror = () => resolve();
      const stop = () => {
        speechSynthesis.cancel();
        resolve();
      };
      signal?.addEventListener("abort", stop, { once: true });
      speechSynthesis.speak(utterance);
    });
  },
  async report(_activityId) {
    await latency(500);
    return report;
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
};
