import amazonBedrock from "@/assets/providers/amazon-bedrock.svg";
import anthropic from "@/assets/providers/anthropic.svg";
import azure from "@/assets/providers/azure.svg";
import baseten from "@/assets/providers/baseten.svg";
import cerebras from "@/assets/providers/cerebras.svg";
import cloudflare from "@/assets/providers/cloudflare-ai-gateway.svg";
import codex from "@/assets/providers/openai-codex.svg";
import copilot from "@/assets/providers/github-copilot.svg";
import deepseek from "@/assets/providers/deepseek.svg";
import fireworks from "@/assets/providers/fireworks.svg";
import google from "@/assets/providers/google.svg";
import groq from "@/assets/providers/groq.svg";
import huggingface from "@/assets/providers/huggingface.svg";
import kimi from "@/assets/providers/kimi-coding.svg";
import meta from "@/assets/providers/meta.svg";
import minimax from "@/assets/providers/minimax.svg";
import mistral from "@/assets/providers/mistral.svg";
import moonshot from "@/assets/providers/moonshotai.svg";
import nvidia from "@/assets/providers/nvidia.svg";
import openai from "@/assets/providers/openai.svg";
import opencode from "@/assets/providers/opencode.svg";
import openrouter from "@/assets/providers/openrouter.svg";
import qwen from "@/assets/providers/qwen-token-plan.svg";
import together from "@/assets/providers/together.svg";
import typesafe from "@/assets/providers/typesafe.png";
import vercel from "@/assets/providers/vercel-ai-gateway.svg";
import vertexai from "@/assets/providers/google-vertex.svg";
import xai from "@/assets/providers/xai.svg";
import xiaomi from "@/assets/providers/xiaomi.svg";

const icons: Record<string, string> = {
  "amazon-bedrock": amazonBedrock,
  anthropic,
  azure,
  baseten,
  cerebras,
  "cloudflare-ai-gateway": cloudflare,
  "cloudflare-workers-ai": cloudflare,
  "openai-codex": codex,
  "github-copilot": copilot,
  deepseek,
  fireworks,
  google,
  "google-vertex": vertexai,
  groq,
  huggingface,
  "kimi-coding": kimi,
  meta,
  minimax,
  "minimax-cn": minimax,
  mistral,
  moonshotai: moonshot,
  "moonshotai-cn": moonshot,
  nvidia,
  openai,
  opencode,
  "opencode-go": opencode,
  openrouter,
  "qwen-token-plan": qwen,
  "qwen-token-plan-cn": qwen,
  "qwen-token-plan-individual": qwen,
  together,
  typesafe,
  "vercel-ai-gateway": vercel,
  xai,
  xiaomi,
  "xiaomi-token-plan-ams": xiaomi,
  "xiaomi-token-plan-cn": xiaomi,
  radius: nvidia,
};

export type ProviderKind = "vendor" | "relay" | "platform";

const relays = new Set([
  "openrouter",
  "vercel-ai-gateway",
  "together",
  "fireworks",
  "nvidia",
  "opencode",
  "opencode-go",
  "github-copilot",
  "radius",
  "typesafe",
  "baseten",
  "huggingface",
]);

const platform = new Set(["cloudflare-workers-ai", "cloudflare-ai-gateway"]);

export function providerIcon(id: string): string | undefined {
  return icons[id];
}

export function providerKind(id: string): ProviderKind {
  if (platform.has(id)) return "platform";
  if (relays.has(id)) return "relay";
  return "vendor";
}
