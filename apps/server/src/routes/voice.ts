import { Hono } from "hono";
import { TtsInputSchema } from "@socrates/shared";
import { fail, parseBody, requireUser, type AppEnv } from "../http";

const MAX_AUDIO_BYTES = 15 * 1024 * 1024;
const WHISPER_MODEL = "@cf/openai/whisper-large-v3-turbo";
const SAMPLE_RATE = 22050;

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
      const form = await c.req.formData().catch(() => null);
      const audio = form?.get("audio");
      if (!(audio instanceof File) || audio.size === 0) fail(422, "validation");
      if (audio.size > MAX_AUDIO_BYTES) fail(422, "validation");
      if (!c.env.AI) {
        return c.json({ text: "正義是什麼？請說說你的看法。" });
      }
      const input = { audio: Array.from(new Uint8Array(await audio.arrayBuffer())), source_language: "zh" };
      const ai = c.env.AI as unknown as { run(model: string, input: unknown): Promise<unknown> };
      const result = (await ai.run(WHISPER_MODEL, input)) as { text?: string };
      if (!result?.text) fail(500, "internal_error");
      return c.json({ text: result.text });
    })
    .post("/tts", async (c) => {
      const user = requireUser(c);
      void user;
      const input = await parseBody(c, TtsInputSchema);
      if (c.env.AI && c.env.TTS_MODEL) {
        const ai = c.env.AI as unknown as { run(model: string, input: unknown): Promise<unknown> };
        const result = (await ai.run(c.env.TTS_MODEL, { text: input.text, lang: input.lang })) as
          | ReadableStream
          | { audio?: ReadableStream | ArrayBuffer };
        const stream =
          result instanceof ReadableStream ? result : result.audio instanceof ReadableStream ? result.audio : null;
        if (stream) {
          return new Response(stream, {
            headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" },
          });
        }
      }
      const wav = synthWav(input.text, input.lang);
      return new Response(wav as unknown as BodyInit, {
        headers: { "Content-Type": "audio/wav", "Cache-Control": "no-store" },
      });
    });
}
