import type { DialogueMessage } from "../types";

const openings = [
  "在你回答之前，我想先確認一件事：你說「{stance}」——這是你的直覺，還是你已經想過理由了？",
  "很好。那麼「{stance}」這個判斷，可以套用到任何類似的情況嗎？還是只適用於這一次？",
];

const challenges = [
  "讓我站在你的對面：如果「{stance}」成立，那麼任何人以同樣理由傷害無辜者，你都得接受。你確定嗎？",
  "有人會說，你只是在數人頭——五比一。可是道德能這樣算嗎？如果那個人是你的家人，你的算式還站得住嗎？",
  "你給了我一個規則。現在把它普遍化：如果每個人都照這條規則行事，世界會變成什麼樣子？你還願意住在那裡嗎？",
  "我注意到你換了一個說法。剛才你說的是「應該」，現在你說的是「可能」。哪一個才是你真正相信的？",
  "假設情況改變：那五個人其實自願承擔風險才身處險境。你的判斷會改變嗎？如果會，你原本的原則出了什麼問題？",
  "你說「這取決於情況」。那麼是什麼特徵讓情況不同？給我一條界線——一條你自己願意遵守的界線。",
  "讓我把你的邏輯推到盡頭：如果可以犧牲一個人救五個人，那犧牲五個人救一百個人也應該成立。你要接受這個結論，還是要修改前提？",
  "你剛剛其實沒有回答我的問題——你在描述你的感覺。感覺可以是一個起點，但它是一個理由嗎？",
];

const closings = [
  "所以我再問一次，而且這是最後一次：你的底線，究竟是什麼？",
  "記住你現在的回答。等一下我會用它來反對你。",
];

function stanceOf(text: string): string {
  const trimmed = text.trim().replace(/[。！？!?.]+$/, "");
  return trimmed.length > 24 ? `${trimmed.slice(0, 24)}…` : trimmed;
}

export async function* mockSocrates(
  userText: string,
  historyLength: number,
  signal?: AbortSignal,
): AsyncGenerator<{ delay: number; chunk: string }> {
  const pool = historyLength === 0 ? openings : historyLength > 8 ? closings : challenges;
  const base = pool[historyLength % pool.length]!;
  const reply = base.replaceAll("{stance}", stanceOf(userText));
  const segments = reply.match(/[^，。？！,?!]+[，。？！,?!]?/g) ?? [reply];
  let elapsed = 0;
  for (const segment of segments) {
    if (signal?.aborted) return;
    const delay = elapsed === 0 ? 650 + Math.random() * 500 : 260 + Math.random() * 340;
    elapsed += delay;
    yield { delay, chunk: segment };
  }
}

export function openingMessage(topicPrompts: string[], topicStatement: string): DialogueMessage {
  const body = `這一場的主題是——「${topicStatement}」\n\n先別急著給答案。告訴我：你的第一個直覺是什麼？${topicPrompts.length > 0 ? `例如：${topicPrompts.slice(0, 2).join("、")}。` : ""}`;
  return { id: crypto.randomUUID(), role: "assistant", text: body, at: new Date().toISOString() };
}
