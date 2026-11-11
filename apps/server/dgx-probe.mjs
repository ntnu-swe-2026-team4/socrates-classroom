import { openAICompletionsApi } from "@earendil-works/pi-ai/compat";
const api = openAICompletionsApi({
  supportsDeveloperRole: false,
  supportsReasoningEffort: false,
  maxTokensField: "max_tokens",
});
const model = {
  id: "GLM-5.3-Flash",
  name: "GLM-5.3-Flash",
  api: "openai-completions",
  provider: "dgx-spark",
  baseUrl: "http://spark-037c:8888/v1",
  reasoning: false,
  input: ["text"],
  maxTokens: 32768,
};
const ctx = { messages: [{ role: "user", content: "我覺得應該拉桿，因為五條命比一條命重要。你覺得呢？" }], tools: [] };
try {
  const stream = api.stream(model, ctx, { maxTokens: 32768 });
  for await (const chunk of stream) {
    if (chunk.type === "text" && chunk.delta) process.stdout.write(chunk.delta);
    if (chunk.type === "error") console.log("\nSTREAM ERROR:", JSON.stringify(chunk).slice(0, 2500));
    if (chunk.type === "finish") console.log("\nFINISH:", JSON.stringify(chunk).slice(0, 200));
  }
} catch (e) {
  console.log("THROWN:", e.message?.slice(0, 300));
}
