import { Hono } from "hono";
import { TtsInputSchema } from "@socrates/shared";
import { enforceIpLimit, fail, langOf, parseBody, requireUser, type AppEnv } from "../http";
import { routingConfig } from "../routing/config.gen";

const MAX_AUDIO_BYTES = 15 * 1024 * 1024;
const SAMPLE_RATE = 22050;

function mockTranscript(): string {
  return "正義是什麼？請說說你的看法。";
}

function wavBytes(samples: Float32Array): Uint8Array {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeText = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  writeText(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, "data");
  view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (const sample of samples) {
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += 2;
  }
  return new Uint8Array(buffer);
}

function synthWav(text: string, lang: string): Uint8Array {
  const baseFreq = lang === "en" ? 196 : 220;
  const durationSec = Math.min(20, Math.max(0.9, 0.5 + text.length * 0.045));
  const total = Math.floor(durationSec * SAMPLE_RATE);
  const samples = new Float32Array(total);
  let phase = 0;
  let vibPhase = 0;
  for (let i = 0; i < total; i += 1) {
    const t = i / SAMPLE_RATE;
    vibPhase += (2 * Math.PI * 5.2) / SAMPLE_RATE;
    const vibrato = Math.sin(vibPhase) * 4;
    const syllableGate = 0.55 + 0.45 * Math.sin((2 * Math.PI * 3.1 * t) % (2 * Math.PI));
    const freq = baseFreq + vibrato;
    phase += (2 * Math.PI * freq) / SAMPLE_RATE;
    const envelope = Math.min(1, t / 0.08, (durationSec - t) / 0.25);
    samples[i] = (Math.sin(phase) * 0.62 + Math.sin(phase * 2) * 0.18) * envelope * syllableGate * 0.5;
  }
  return wavBytes(samples);
}

export function voiceRoutes() {
  return new Hono<AppEnv>()
    .post("/stt", async (c) => {
      requireUser(c);
      await enforceIpLimit(c, "stt", 20);
      const form = await c.req.formData().catch(() => null);
      const audio = form?.get("audio");
      if (!(audio instanceof File) || audio.size === 0) fail(422, "validation");
      if (audio.size > MAX_AUDIO_BYTES) fail(422, "validation");
      if (c.env.LLM_PROVIDER === "mock") {
        return c.json({ text: mockTranscript() });
      }
      if (!c.env.AI) fail(502, "llm_unavailable");
      const bytes = new Uint8Array(await audio.arrayBuffer());
      let binary = "";
      for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
      }
      const input = { audio: btoa(binary), language: langOf(c) };
      try {
        const ai = c.env.AI as unknown as { run(model: string, input: unknown): Promise<unknown> };
        const result = (await ai.run(routingConfig.voice.stt, input)) as { text?: string };
        if (result?.text) return c.json({ text: result.text });
        fail(502, "llm_unavailable");
      } catch (error) {
        console.error("[stt] binding failed", error);
        fail(502, "llm_unavailable");
      }
    })
    .post("/tts", async (c) => {
      requireUser(c);
      await enforceIpLimit(c, "tts", 30);
      const input = await parseBody(c, TtsInputSchema);
      const ttsModel = c.env.TTS_MODEL ?? routingConfig.voice.tts;
      if (c.env.AI && ttsModel) {
        try {
          const ai = c.env.AI as unknown as { run(model: string, input: unknown): Promise<unknown> };
          const result = (await ai.run(ttsModel, { prompt: input.text, lang: input.lang })) as
            | ReadableStream
            | ArrayBuffer
            | Uint8Array
            | string
            | { audio?: ReadableStream | ArrayBuffer | Uint8Array | string };
          let bytes: Uint8Array | null = null;
          if (result instanceof ReadableStream) {
            bytes = new Uint8Array(await new Response(result).arrayBuffer());
          } else if (result instanceof ArrayBuffer) {
            bytes = new Uint8Array(result);
          } else if (result instanceof Uint8Array) {
            bytes = result;
          } else if (typeof result === "string" && /^[A-Za-z0-9+/=]+$/.test(result.slice(0, 8))) {
            bytes = Uint8Array.from(atob(result), (ch) => ch.charCodeAt(0));
          } else if (result && typeof result === "object" && "audio" in result) {
            const field = (result as { audio?: ReadableStream | ArrayBuffer | Uint8Array | string }).audio;
            if (typeof field === "string") bytes = Uint8Array.from(atob(field), (ch) => ch.charCodeAt(0));
            else if (field instanceof ArrayBuffer) bytes = new Uint8Array(field);
            else if (field instanceof Uint8Array) bytes = field;
          }
          if (bytes && bytes.length > 0) {
            const isWav = bytes[0] === 0x52 && bytes[1] === 0x49;
            const isMp3 = bytes[0] === 0x49 || bytes[0] === 0xff;
            const contentType = isWav ? "audio/wav" : isMp3 ? "audio/mpeg" : "application/octet-stream";
            return new Response(bytes as unknown as BodyInit, {
              headers: { "Content-Type": contentType, "Cache-Control": "no-store" },
            });
          }
          console.error("[tts] unexpected binding result", typeof result);
        } catch (error) {
          console.error("[tts] binding failed", error);
        }
        fail(502, "llm_unavailable");
      }
      if (c.env.LLM_PROVIDER !== "mock") fail(502, "llm_unavailable");
      const wav = synthWav(input.text, input.lang);
      return new Response(wav as unknown as BodyInit, {
        headers: { "Content-Type": "audio/wav", "Cache-Control": "no-store" },
      });
    });
}
