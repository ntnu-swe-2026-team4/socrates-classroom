import wsPkg from "/home/g36maid/Code/ntnu-swe-2026-team4/socrates-classroom/node_modules/.pnpm/ws@8.21.0/node_modules/ws/index.js";
const { WebSocket } = wsPkg;
import { readFileSync } from "node:fs";

const cookie = readFileSync("/tmp/student.jar", "utf8")
  .split("\n")
  .filter((l) => l.includes("socrates_session") || l.includes("session"))
  .map((l) => l.split("\t").slice(-2).join("="))
  .join("; ");
const activityId = "a_7c2a61ac06d94ba6840b99f2b86f3a0d";
const userId = "u_f2803ed68b5d42a087d7ecb5e63a06a9";

const ws = new WebSocket(`ws://[::1]:5173/agents/chat/${activityId}:${userId}`, { headers: { Cookie: cookie } });
const frames = [];
let answer = "";
let emotion = null;
let done = false;

ws.on("message", (data) => {
  const frame = JSON.parse(data.toString());
  frames.push(frame);
  if (frame.type === "error") console.log("ERROR FRAME:", JSON.stringify(frame).slice(0, 200));
  if (frame.type === "ops" && frame.ops) {
    for (const [, value] of frame.ops) {
      const doc = value?.docs ?? {};
      const live = doc["pi.live"]?.generation?.message?.content;
      if (Array.isArray(live))
        answer = live
          .filter((p) => p.type === "text")
          .map((p) => p.text)
          .join("");
    }
  }
  if (frame.type === "view" && frame.view) {
    for (const entry of [...frame.view.entries].reverse()) {
      if (entry.kind === "app.emotion") {
        emotion = entry.data;
        break;
      }
    }
  }
});
ws.on("error", (e) => {
  console.error("WS error:", e.message);
  process.exit(1);
});
ws.on("unexpected-response", (_req, res) => {
  console.error("UPGRADE REJECTED:", res.statusCode);
  process.exit(3);
});
ws.on("open", () => console.log("OPEN"));
const frameLog = setInterval(() => console.log("frames:", frames.length, "answer-len:", answer.length), 5000);

ws.on("open", () => {
  ws.send(JSON.stringify({ type: "watch" }));
  setTimeout(
    () =>
      ws.send(
        JSON.stringify({ id: "s1", type: "submit", input: "我覺得應該拉桿，因為五條命比一條命重要。你覺得呢？" }),
      ),
    500,
  );
});

setTimeout(() => {
  console.log("TIMEOUT");
  ws.close();
  process.exit(2);
}, 90_000);

const check = setInterval(() => {
  console.log("frame-types:", JSON.stringify(frames.map((f) => f.type)));
  const ops = frames.filter((f) => f.type === "ops").at(-1);
  if (ops && answer) {
    const view = frames.filter((f) => f.type === "view").at(-1);
    const entries = ops.ops.flatMap(([, v]) => v?.entries ?? []).filter(Boolean);
    const all = [...(view?.view?.entries ?? []), ...entries];
    const lastAssistant = [...all]
      .reverse()
      .find((e) => e.kind === "pi.assistant" && e.model?.[0]?.stopReason === "stop");
    if (lastAssistant) {
      const content = lastAssistant.model[0].content;
      const text =
        typeof content === "string"
          ? content
          : content
              .filter((p) => p.type === "text")
              .map((p) => p.text)
              .join("");
      for (const e of [...all].reverse())
        if (e.kind === "app.emotion") {
          emotion = e.data;
          break;
        }
      console.log("=== REAL MODEL ANSWER ===");
      console.log(text);
      console.log("=== EMOTION ===");
      console.log(JSON.stringify(emotion ?? "none"));
      done = true;
    }
  }
  if (done) {
    clearInterval(check);
    clearInterval(frameLog);
    ws.close();
    process.exit(0);
  }
}, 1000);
