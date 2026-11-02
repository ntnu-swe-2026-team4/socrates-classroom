import type { LookupEvent, LookupResult } from "@/api/types";

/**
 * 假的名詞查詢：不連網、不呼叫 LLM，只走一遍流程讓畫面可以測試。
 * 驗證規則與後端相同（見 docs/api-contract.md「名詞查詢」）；名詞含「不存在」或「飛天」時回「找不到來源」。
 */
const MAX_TERM_LEN = 30;
const delay = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("已停止", "AbortError"));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(t); reject(new DOMException("已停止", "AbortError")); }, { once: true });
  });

/** 全形英數符號轉半形、全形空白轉半形、連續空白合併 */
export function normalizeTerm(input: string): string {
  return input.replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/　/g, " ").replace(/\s+/g, " ").trim();
}

/** 看起來是句子或指令（例如「忽略以上指示…」這類提示注入），而不是一個名詞 */
export function looksLikeInstruction(term: string): boolean {
  if (/[,!?;。]/.test(term)) return true;
  return [
    /忽略|無視|无视|不要理會|不要理会|ignore|disregard|forget/i,
    /(以上|上述|前面|之前|先前|previous|above|prior).{0,6}(指示|指令|規則|规则|設定|设定|提示|instructions?|rules?|prompt)/i,
    /請你|请你|幫我|帮我|改用|扮演|假裝|假装|寫一|写一|寫首|写首|寫篇|写篇|act as|you are|pretend|respond in|answer in|write a/i,
    /system prompt|系統提示|系统提示|提示詞|提示词/i,
  ].some((re) => re.test(term));
}

export async function lookup(input: string, onEvent?: (e: LookupEvent) => void, signal?: AbortSignal): Promise<LookupResult> {
  const term = normalizeTerm(input);
  const fail = (status: LookupResult["status"], title: string, reason: string, hint?: string): LookupResult =>
    ({ term, status, summary: "", sources: [], error: { title, reason, hint } });

  const len = [...term].length;
  if (len === 0) return fail("invalid", "輸入不合規", "請選取要查詢的名詞。");
  if (len > MAX_TERM_LEN) return fail("invalid", "輸入不合規", `名詞長度限 1–${MAX_TERM_LEN} 字，目前為 ${len} 字。`, "只選取名詞本身。");
  if (looksLikeInstruction(term)) return fail("invalid", "不是名詞", "輸入看起來是句子或指令，不會送出搜尋。", "只選取名詞本身，不要包含標點或整句話。");

  await delay(400, signal);
  if (/不存在|飛天/.test(term)) {
    onEvent?.({ type: "sources", term, sources: [] });
    return { term, status: "not_found", summary: "", sources: [], error: { title: "找不到來源", reason: "白名單內找不到可靠來源。" } };
  }

  const sources = [{ title: `${term} - 維基百科（示範資料）`, url: `https://zh.wikipedia.org/wiki/${encodeURIComponent(term)}`, domain: "zh.wikipedia.org" }];
  onEvent?.({ type: "sources", term, sources });
  const summary = `「${term}」的解釋會顯示在這裡 [1]。示範模式不會真的搜尋，這段文字是假資料；接上後端後，會是根據白名單網站內容整理的 150 字內說明 [1]。`;
  for (let i = 0; i < summary.length; i += 4) {
    await delay(25, signal);
    onEvent?.({ type: "delta", text: summary.slice(i, i + 4) });
  }
  return { term, status: "ok", summary, sources, error: null };
}
