const OPENERS = [
  "你說的有道理，但讓我追問：",
  "我聽見你的立場了。不過，",
  "有趣的判斷。可是，",
  "你似乎很確定。那麼，",
  "暫且站在你的對面：",
];

const CHALLENGES = [
  "如果把當事人換成你自己的家人，你的原則還站得住嗎？",
  "你依據的是後果，還是義務？兩者衝突時你選哪個？",
  "這個原則可以普遍化嗎？每個人都這樣做會怎樣？",
  "你有沒有可能只是接受了社會給你的預設，而沒有檢視它？",
  "支撐你判斷的理由，換一個案例還成立嗎？舉個極端一點的例子。",
  "如果對方用完全一樣的理由反對你，你會怎麼回應？",
  "你用的例子裡，哪一個條件是案例給的，哪一個是你自己加上去的？",
  "把你的理由推到極端，它會在哪裡崩塌？",
];

export function openingMessage(topicTitle: string): string {
  return `我們今天談「${topicTitle}」。先別急著找標準答案——你的直覺判斷是什麼？說說看，你為什麼會這樣想？`;
}

export function mockSocratesReply(userText: string, turn: number): string {
  const opener = OPENERS[turn % OPENERS.length]!;
  const challenge = CHALLENGES[turn % CHALLENGES.length]!;
  const echoed = userText.length > 24 ? `${userText.slice(0, 24)}……` : userText;
  return `${opener}「${echoed}」——${challenge}`;
}
