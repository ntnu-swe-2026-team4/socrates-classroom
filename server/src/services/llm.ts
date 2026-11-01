import { readFileSync, statSync } from "node:fs";
import type { Config, Lang } from "../config";
import type { Emotion } from "../services/types";

export interface HistoryMessage {
  role: "user" | "assistant";
  text: string;
}

export interface LlmTextPiece {
  emotion?: Emotion;
  text?: string;
}

const LANG_NAME: Record<Lang, string> = {
  zh: "繁體中文",
  en: "English",
  es: "Español",
};

const BUILTIN_PROMPT = `你是蘇格拉底，正在和一位學生進行哲學對話。你的目標不是給答案，而是用提問幫學生把自己的想法想清楚。
每次回覆控制在三句話以內，只用純文字，最後以一個問題結尾。
每次回覆的最前面先寫一個情緒標記：[neutral]、[happy]、[confused] 或 [angry]，再空一格寫回覆內容。`;

let cachedPrompt: string | null = null;
let cachedMtime = 0;

function promptText(config: Config): string {
  try {
    const mtime = statSync(config.promptPath).mtimeMs;
    if (cachedPrompt === null || mtime !== cachedMtime) {
      cachedPrompt = readFileSync(config.promptPath, "utf8");
      cachedMtime = mtime;
    }
  } catch {
    if (cachedPrompt === null) cachedPrompt = BUILTIN_PROMPT;
  }
  return cachedPrompt ?? BUILTIN_PROMPT;
}

export class LlmError extends Error {
  constructor(
    public status: number,
    public key: string,
    public code: string,
    public midStream = false,
  ) {
    super(key);
  }
}

function systemPrompt(config: Config, input: { title: string; statement: string; lang: Lang; extra?: string }): string {
  const context = [
    promptText(config).trim(),
    `\n\n這次討論的題目是「${input.title}」。`,
    input.statement && input.statement !== input.title ? `題目說明：${input.statement}` : "",
    input.extra ? `\n${input.extra}` : "",
    `\n請用${LANG_NAME[input.lang]}回覆。`,
  ].filter(Boolean);
  return context.join("");
}

/**
 * 從 OpenRouter 的 OpenAI 相容串流讀文字。每段內容交給 onDelta；中途錯誤丟 LlmError(midStream)。
 * 這裡只負責傳遞原始文字（含開頭的情緒標記），拆標記由 EmotionSplitter 做。
 */
async function* openRouterText(config: Config, system: string, history: HistoryMessage[], signal?: AbortSignal): AsyncGenerator<string> {
  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const resetTimer = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 60_000);
  };
  resetTimer();
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort);

  let res: Response;
  try {
    res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${config.openRouterKey}`,
        "Content-Type": "application/json",
        ...(config.openRouterReferer ? { "HTTP-Referer": config.openRouterReferer } : {}),
        "X-Title": "詰問 · 蘇格拉底對話教室",
      },
      body: JSON.stringify({
        model: config.openRouterModel,
        stream: true,
        max_tokens: 600,
        temperature: 0.7,
        messages: [
          { role: "system", content: system },
          ...history.map((m) => ({ role: m.role, content: m.text })),
        ],
      }),
    });
  } catch {
    if (timer) clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
    throw new LlmError(503, timedOut ? "llm_timeout" : "llm_unavailable", timedOut ? "llm_timeout" : "llm_unavailable");
  }

  if (!res.ok || !res.body) {
    if (timer) clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
    console.error(`[llm] OpenRouter returned HTTP ${res.status}`);
    if (res.status === 429) throw new LlmError(429, "llm_rate_limited", "llm_rate_limited");
    throw new LlmError(503, "llm_unavailable", "llm_unavailable");
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      resetTimer();
      buf += dec.decode(value, { stream: true });
      for (;;) {
        const idx = buf.indexOf("\n");
        if (idx < 0) break;
        const line = buf.slice(0, idx).replace(/\r$/, "");
        buf = buf.slice(idx + 1);
        if (!line || line.startsWith(":")) continue;
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") return;
        let payload: any;
        try {
          payload = JSON.parse(data);
        } catch {
          continue;
        }
        if (payload.error) {
          const code = payload.error?.code === 429 ? "llm_rate_limited" : "llm_unavailable";
          throw new LlmError(code === "llm_rate_limited" ? 429 : 503, code, code, true);
        }
        const choice = payload.choices?.[0];
        if (choice?.finish_reason === "error") {
          throw new LlmError(503, "llm_unavailable", "llm_unavailable", true);
        }
        const content = choice?.delta?.content;
        if (typeof content === "string" && content.length) yield content;
      }
    }
  } catch (error) {
    if (error instanceof LlmError) throw error;
    throw new LlmError(503, timedOut ? "llm_timeout" : "llm_unavailable", timedOut ? "llm_timeout" : "llm_unavailable", true);
  } finally {
    if (timer) clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
    reader.cancel().catch(() => {});
  }
}

async function* mockText(input: { lang: Lang; history: HistoryMessage[] }): AsyncGenerator<string> {
  const last = [...input.history].reverse().find((m) => m.role === "user")?.text ?? "";
  const round = input.history.filter((m) => m.role === "assistant").length;
  let emotion: Emotion = "neutral";
  if (/喜歡|謝謝|開心|好笑|thank|love|gracias|me gusta/i.test(last)) emotion = "happy";
  else if (/生氣|示範.*情緒|angry|enfad|enoj/i.test(last)) emotion = "angry";
  else if (last.trim().length < 6 || /看情況|不知道|maybe|no sé|quizás/i.test(last)) emotion = "confused";

  const replies: Record<Lang, string[]> = {
    zh: [
      "有意思。但你剛才那句話裡，有沒有哪個詞，其實你自己也還沒完全想清楚是什麼意思？",
      "換個角度想：如果反過來看，你剛剛的說法還會成立嗎？",
      "你會怎麼跟一個完全不同意你的人，解釋你為什麼這樣想？",
      "假設有一個例外情況，你的說法在那個情況下還站得住腳嗎？",
      "你說的這件事，是你自己觀察到的，還是別人告訴你的？這兩者對你來說有差別嗎？",
    ],
    en: [
      "Interesting. Is there a word in what you just said that you have not fully defined for yourself yet?",
      "Try the other side: if we reversed your claim, would it still hold?",
      "How would you explain your reasoning to someone who completely disagrees with you?",
      "Suppose there were an exception. Would your claim still stand in that case?",
      "Did you observe that yourself, or did someone tell you? Does the difference matter to you?",
    ],
    es: [
      "Interesante. ¿Hay alguna palabra en lo que acabas de decir que todavía no hayas definido del todo?",
      "Piensa al revés: si invirtieras tu afirmación, ¿seguiría siendo válida?",
      "¿Cómo le explicarías tu razonamiento a alguien que no está nada de acuerdo contigo?",
      "Supón que hubiera una excepción. ¿Tu afirmación seguiría en pie en ese caso?",
      "¿Lo observaste tú mismo o te lo contó alguien? ¿Esa diferencia te importa?",
    ],
  };
  const reply = replies[input.lang][round % replies[input.lang].length];
  const text = `[${emotion}] ${reply}`;
  for (let i = 0; i < text.length; i += 6) {
    await new Promise((r) => setTimeout(r, 8));
    yield text.slice(i, i + 6);
  }
}

/**
 * 把開頭的情緒標記拆掉。標記不能出現在任何 delta 或存進資料庫的文字裡。
 * 開頭不是 `[`（或超過 24 字還沒對上）就當作 neutral，原文照送。
 */
export class EmotionSplitter {
  private buffer = "";
  private resolved = false;
  emotion: Emotion | null = null;

  push(chunk: string): { emotion?: Emotion; text?: string } {
    if (this.resolved) return { text: chunk };
    this.buffer += chunk;
    const leading = this.buffer.replace(/^\s+/, "");
    if (!leading) return {};
    const m = /^\[(neutral|happy|confused|angry)\]\s*/.exec(leading);
    if (m) {
      this.resolved = true;
      this.emotion = m[1] as Emotion;
      const rest = leading.slice(m[0].length);
      this.buffer = "";
      return { emotion: this.emotion, text: rest || undefined };
    }
    if (leading.startsWith("[") && leading.length <= 24) return {};
    this.resolved = true;
    this.emotion = "neutral";
    const out = this.buffer;
    this.buffer = "";
    return { emotion: "neutral", text: out };
  }

  finish(): { emotion: Emotion; text?: string } {
    if (!this.resolved) {
      this.resolved = true;
      this.emotion = "neutral";
      const out = this.buffer;
      this.buffer = "";
      return { emotion: "neutral", text: out || undefined };
    }
    return { emotion: this.emotion ?? "neutral" };
  }
}

export function socraticStream(
  config: Config,
  input: { title: string; statement: string; history: HistoryMessage[]; lang: Lang; extra?: string },
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const system = systemPrompt(config, {
    title: input.title,
    statement: input.statement,
    lang: input.lang,
    extra: input.extra,
  });
  if (config.llmProvider === "mock") return mockText(input);
  if (!config.openRouterKey) throw new LlmError(503, "llm_not_configured", "llm_not_configured");
  return openRouterText(config, system, input.history, signal);
}

/**
 * 需要結構化輸出的地方（論點草稿、整理論點、反例、裁判）用這個；沒有 key 或失敗時回 null，
 * 呼叫端再退回規則式實作，不讓整個功能壞掉。
 */
export async function completeJson<T>(config: Config, system: string, user: string): Promise<T | null> {
  if (config.llmProvider !== "openrouter" || !config.openRouterKey) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${config.openRouterKey}`,
        "Content-Type": "application/json",
        ...(config.openRouterReferer ? { "HTTP-Referer": config.openRouterReferer } : {}),
        "X-Title": "詰問 · 蘇格拉底對話教室",
      },
      body: JSON.stringify({
        model: config.openRouterModel,
        max_tokens: 700,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as any;
    const text = json.choices?.[0]?.message?.content;
    if (typeof text !== "string") return null;
    return JSON.parse(text) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
