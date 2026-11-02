/**
 * 開發用的 LLM 轉接器（只在 `bun run dev` 時存在，打包後不會有）：
 * 在後端完成之前，讓 mock 模式的「單人 → 對話」也能拿到 OpenRouter 的真實回覆。
 *
 *   瀏覽器 ──POST /__llm/dialogue──▶ Vite 開發伺服器（這個檔案，讀 server/.env 的 key）──▶ OpenRouter
 *
 * API key 只在這個 Node 程序裡，不會送到瀏覽器。回應格式與 docs/api-contract.md〈對話 API〉相同
 * （SSE：delta / done / error），所以前端直接沿用 api/http.ts 的串流解析。
 * 後端做好 POST /api/archives/:id/dialogue 之後，這個檔案就可以刪掉。
 */
import fs from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { loadEnv, type Plugin } from "vite";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const SERVER_DIR = path.join(ROOT, "server");
const PROMPT_FILE = path.join(ROOT, "llm", "prompts", "socrates.md");
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "anthropic/claude-sonnet-5.5";
const IDLE_TIMEOUT_MS = 60_000;
const HISTORY_LIMIT = 40;

type Lang = "zh-TW" | "en" | "es";
type Emotion = "neutral" | "happy" | "confused" | "angry";
/** 提示詞要求 AI 在回覆最前面加上情緒標記，例如 "[confused] 你說的「善意」是指…" */
const EMOTION_TAG = /^\s*\[(neutral|happy|confused|angry)\]\s*/i;
type Body = { title?: string; lang?: Lang; messages?: { role: "user" | "assistant"; text: string }[] };

const LANG_NAME: Record<Lang, string> = { "zh-TW": "繁體中文", en: "English", es: "Español" };
const MSG: Record<string, Record<Lang, string>> = {
  notConfigured: { "zh-TW": "還沒有設定 OpenRouter API key（server/.env 的 OPENROUTER_API_KEY）", en: "OpenRouter API key is not set (OPENROUTER_API_KEY in server/.env)", es: "Falta la clave de OpenRouter (OPENROUTER_API_KEY en server/.env)" },
  unavailable: { "zh-TW": "蘇格拉底暫時無法回應，請稍後再試", en: "Socrates can't answer right now. Please try again later.", es: "Sócrates no puede responder ahora. Inténtalo más tarde." },
  rateLimited: { "zh-TW": "說得太快了，請稍等一下再試", en: "Too many requests. Please wait a moment.", es: "Demasiadas solicitudes. Espera un momento." },
  timeout: { "zh-TW": "蘇格拉底想太久了，請再送一次", en: "Socrates took too long. Please send again.", es: "Sócrates tardó demasiado. Envíalo de nuevo." },
};

/** 每次請求都重新讀，改 server/.env 或提示詞不用重開伺服器 */
function config() {
  const env = loadEnv("development", SERVER_DIR, "");
  let prompt = "You are Socrates. Ask one short question at a time.";
  try { prompt = fs.readFileSync(PROMPT_FILE, "utf8"); } catch { /* 沒有提示詞檔就用預設 */ }
  return { key: env.OPENROUTER_API_KEY?.trim(), model: env.OPENROUTER_MODEL?.trim() || DEFAULT_MODEL, prompt };
}

function readJson(req: IncomingMessage): Promise<Body> {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (c: string) => { raw += c; if (raw.length > 1_000_000) req.destroy(); });
    req.on("end", () => { try { resolve(JSON.parse(raw || "{}") as Body); } catch (e) { reject(e); } });
    req.on("error", reject);
  });
}

const sendJson = (res: ServerResponse, status: number, body: unknown) => {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
};
const sse = (res: ServerResponse, event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

async function handle(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== "POST") return sendJson(res, 405, { message: "POST only" });
  let body: Body;
  try { body = await readJson(req); } catch { return sendJson(res, 400, { message: "Invalid JSON" }); }
  const lang: Lang = body.lang && body.lang in LANG_NAME ? body.lang : "zh-TW";
  const history = (body.messages ?? []).filter((m) => m.text?.trim()).slice(-HISTORY_LIMIT);
  if (history.at(-1)?.role !== "user") return sendJson(res, 422, { message: "The last message must be from the user" });

  const { key, model, prompt } = config();
  if (!key) return sendJson(res, 503, { message: MSG.notConfigured[lang], code: "llm_not_configured" });

  const system = `${prompt}\n\n本次討論的議題：「${body.title ?? ""}」\n請一律使用${LANG_NAME[lang]}回覆。`;
  const abort = new AbortController();
  let idle = setTimeout(() => abort.abort("timeout"), IDLE_TIMEOUT_MS);
  const bump = () => { clearTimeout(idle); idle = setTimeout(() => abort.abort("timeout"), IDLE_TIMEOUT_MS); };
  // 開發用：使用者關掉頁面就停止產生，省額度（正式後端依契約要產生完並保存）
  res.on("close", () => { if (!res.writableEnded) abort.abort("client closed"); });

  let upstream: Response;
  try {
    upstream = await fetch(OPENROUTER_URL, {
      method: "POST",
      signal: abort.signal,
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "X-Title": "Socrates Classroom (dev)" },
      body: JSON.stringify({
        model, stream: true, max_tokens: 600, temperature: 0.7,
        messages: [{ role: "system", content: system }, ...history.map((m) => ({ role: m.role, content: m.text }))],
      }),
    });
  } catch (e) {
    clearTimeout(idle);
    console.error("[dev-llm] OpenRouter request failed:", e);
    return sendJson(res, abort.signal.aborted ? 504 : 503, { message: abort.signal.aborted ? MSG.timeout[lang] : MSG.unavailable[lang] });
  }
  if (!upstream.ok || !upstream.body) {
    clearTimeout(idle);
    console.error(`[dev-llm] OpenRouter ${upstream.status}:`, await upstream.text().catch(() => ""));
    if (upstream.status === 429) return sendJson(res, 429, { message: MSG.rateLimited[lang] });
    return sendJson(res, 503, { message: MSG.unavailable[lang] });
  }

  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  let text = "";
  const fail = (code: string, message: string) => { sse(res, "error", { message, code }); res.end(); };
  // 回覆開頭的情緒標記（例如 "[happy]"）先攔下來，不送給前端、不會被朗讀；確定之後其餘文字照常串流
  let emotion: Emotion | null = null;
  let head = "";
  const emit = (piece: string) => {
    if (!text) piece = piece.trimStart();
    if (!piece) return;
    text += piece;
    sse(res, "delta", { text: piece });
  };
  // 情緒一確定就先送 event: emotion，前端馬上做表情，回覆文字再接著來
  const decide = (e: Emotion, rest: string) => { emotion = e; sse(res, "emotion", { emotion: e }); emit(rest); };
  const push = (piece: string) => {
    if (emotion) return emit(piece);
    head += piece;
    const m = EMOTION_TAG.exec(head);
    if (m) return decide(m[1].toLowerCase() as Emotion, head.slice(m[0].length));
    // 開頭不像標記（或太長）：當作沒有標記，原文照送
    if (!/^\s*(\[[a-z]*)?$/i.test(head) || head.length > 24) decide("neutral", head);
  };
  try {
    const reader = upstream.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bump();
      buf += dec.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, "");
        buf = buf.slice(nl + 1);
        if (!line.startsWith("data:")) continue; // 空行、": OPENROUTER PROCESSING" 之類的註解
        const data = line.slice(5).trim();
        if (data === "[DONE]") continue;
        const chunk = JSON.parse(data) as { error?: { message?: string }; choices?: { delta?: { content?: string } }[] };
        if (chunk.error) {
          console.error("[dev-llm] OpenRouter stream error:", chunk.error);
          return fail("llm_unavailable", MSG.unavailable[lang]);
        }
        const piece = chunk.choices?.[0]?.delta?.content;
        if (piece) push(piece);
      }
    }
  } catch (e) {
    if (res.writableEnded || res.destroyed) return;
    const timedOut = abort.signal.reason === "timeout";
    console.error("[dev-llm] stream failed:", e);
    return fail(timedOut ? "llm_timeout" : "llm_error", timedOut ? MSG.timeout[lang] : MSG.unavailable[lang]);
  } finally {
    clearTimeout(idle);
  }
  if (!emotion) decide("neutral", head); // 回覆很短、還沒判斷完就結束了
  if (!text.trim()) return fail("llm_error", MSG.unavailable[lang]);
  sse(res, "done", { message: { id: `a${Date.now()}`, role: "assistant", text, at: new Date().toISOString(), emotion } });
  res.end();
}

/** Vite 外掛：只在開發伺服器上提供 POST /__llm/dialogue */
export function devLlm(): Plugin {
  return {
    name: "dev-llm",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__llm/dialogue", (req, res) => { void handle(req, res); });
      const { key, model } = config();
      server.config.logger.info(key ? `  [dev-llm] OpenRouter 已啟用（${model}）` : "  [dev-llm] 沒有 server/.env 的 OPENROUTER_API_KEY，對話會用示範回覆");
    },
  };
}
