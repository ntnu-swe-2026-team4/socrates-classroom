import { api } from "@/api";

export type VoiceState = "idle" | "listening" | "processing";
export type VoiceError = "denied" | "unsupported" | "failed";

export interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult:
    | ((event: {
        resultIndex: number;
        results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
      }) => void)
    | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
}

export interface MediaStreamLike {
  getTracks(): Array<{ stop(): void }>;
}

export interface AnalyserLike {
  fftSize: number;
  frequencyBinCount: number;
  getByteTimeDomainData(data: Uint8Array): void;
}

export interface AudioContextLike {
  createMediaStreamSource(stream: MediaStreamLike): { connect(node: AnalyserLike): void };
  createAnalyser(): AnalyserLike;
  close(): Promise<void>;
}

export interface MediaRecorderLike {
  state: string;
  ondataavailable: ((event: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  start(timeslice?: number): void;
  stop(): void;
}

export interface VoiceEnv {
  getUserMedia(): Promise<MediaStreamLike> | null;
  createAudioContext(): AudioContextLike;
  recognitionCtor(): (new () => SpeechRecognitionLike) | null;
  createRecorder(stream: MediaStreamLike): MediaRecorderLike | null;
  raf(callback: () => void): number;
  cancelRaf(id: number): void;
  lang(): string;
  stt(audio: Blob): Promise<string>;
}

function windowRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition) as (new () => SpeechRecognitionLike) | null;
}

export const defaultVoiceEnv: VoiceEnv = {
  getUserMedia: () =>
    navigator.mediaDevices?.getUserMedia ? navigator.mediaDevices.getUserMedia({ audio: true }) : null,
  createAudioContext: () => new AudioContext() as unknown as AudioContextLike,
  recognitionCtor: windowRecognitionCtor,
  createRecorder: (stream) =>
    typeof MediaRecorder === "undefined"
      ? null
      : (new MediaRecorder(stream as unknown as MediaStream) as unknown as MediaRecorderLike),
  raf: (callback) => requestAnimationFrame(callback),
  cancelRaf: (id) => cancelAnimationFrame(id),
  lang: () => document.documentElement.lang,
  stt: (audio) => api.stt(audio),
};

export interface VoiceCallbacks {
  onFinal(text: string): void;
  onAmplitude(value: number): void;
  onState(state: VoiceState): void;
  onInterim(text: string): void;
  onError(error: VoiceError | null): void;
}

interface VoiceSession {
  stream: MediaStreamLike;
  recorder: MediaRecorderLike | null;
  chunks: Blob[];
  recognition: SpeechRecognitionLike | null;
  finalText: string;
  liveText: string;
  raf: number;
  ctx: AudioContextLike;
  stopTimer?: ReturnType<typeof setTimeout>;
}

export class VoiceInputController {
  private session: VoiceSession | null = null;
  private starting = false;
  private stopRequested = false;
  private lastError: VoiceError | null = null;

  constructor(
    private readonly env: VoiceEnv,
    private readonly cb: VoiceCallbacks,
  ) {}

  async start(): Promise<void> {
    if (this.session || this.starting) return;
    this.starting = true;
    try {
      await this.begin();
    } finally {
      this.starting = false;
    }
  }

  async stop(): Promise<void> {
    this.stopRequested = true;
    const s = this.session;
    if (!s) return;
    this.session = null;

    const hasRecognition = Boolean(s.recognition);
    const capturedFinal = s.liveText;

    let chunks: Blob[] = [];
    const { recorder } = s;
    if (recorder) {
      chunks = await new Promise<Blob[]>((resolve) => {
        const originalOnData = recorder.ondataavailable;
        const collected: Blob[] = [...s.chunks];
        recorder.ondataavailable = (event) => {
          originalOnData?.call(recorder, event);
          if (event.data.size > 0) collected.push(event.data);
        };
        let insurance: ReturnType<typeof setTimeout> | undefined;
        recorder.onstop = () => {
          clearTimeout(insurance);
          resolve(collected);
        };
        if (recorder.state === "recording") {
          recorder.stop();
          insurance = setTimeout(() => resolve(collected), 1000);
        } else {
          resolve(collected);
        }
      });
    }

    this.stopEverything(s);
    this.cb.onState("processing");
    try {
      if (hasRecognition && capturedFinal) {
        this.cb.onFinal(capturedFinal);
      } else if (chunks.length > 0) {
        const blob = new Blob(chunks, { type: chunks[0].type });
        try {
          const text = await this.env.stt(blob);
          this.cb.onFinal(text);
        } catch {
          this.emitError("failed");
        }
      }
    } finally {
      this.cb.onState("idle");
      this.cb.onInterim("");
    }
  }

  dispose(): void {
    this.stopRequested = true;
    this.stopEverything();
  }

  private emitError(error: VoiceError | null): void {
    if (error === this.lastError) return;
    this.lastError = error;
    this.cb.onError(error);
  }

  private stopEverything(target: VoiceSession | null = this.session): void {
    const s = target;
    if (!s) return;
    this.env.cancelRaf(s.raf);
    s.recognition?.stop();
    if (s.recorder?.state === "recording") {
      s.recorder.stop();
    }
    for (const track of s.stream.getTracks()) {
      track.stop();
    }
    clearTimeout(s.stopTimer);
    void s.ctx.close().catch(() => {});
    this.session = null;
    this.cb.onAmplitude(0);
  }

  private startMeter(analyser: AnalyserLike): void {
    const data = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (const v of data) {
        const dev = (v - 128) / 128;
        sum += dev * dev;
      }
      this.cb.onAmplitude(Math.min(1, Math.sqrt(sum / data.length) * 4));
      if (this.session) this.session.raf = this.env.raf(tick);
    };
    tick();
  }

  private async begin(): Promise<void> {
    this.cb.onInterim("");
    this.emitError(null);
    this.cb.onState("listening");
    this.stopRequested = false;
    let stream: MediaStreamLike | null;
    try {
      stream = await this.env.getUserMedia();
    } catch (cause) {
      this.cb.onState("idle");
      this.emitError(cause instanceof DOMException && cause.name === "NotAllowedError" ? "denied" : "failed");
      return;
    }
    if (!stream) {
      this.cb.onState("idle");
      this.emitError("unsupported");
      return;
    }
    if (this.stopRequested) {
      for (const track of stream.getTracks()) {
        track.stop();
      }
      this.cb.onState("idle");
      return;
    }
    const session0: VoiceSession = {
      stream,
      recorder: null,
      chunks: [],
      recognition: null,
      finalText: "",
      liveText: "",
      raf: 0,
      ctx: null as unknown as AudioContextLike,
    };
    let ctx: AudioContextLike | null = null;
    try {
      ctx = this.env.createAudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);

      const Ctor = this.env.recognitionCtor();
      if (Ctor) {
        const recognition = new Ctor();
        recognition.lang = this.env.lang() || "zh-Hant";
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.onresult = (event) => {
          const s = this.session;
          if (!s) return;
          let interimText = "";
          for (let i = event.resultIndex; i < event.results.length; i++) {
            const result = event.results[i];
            const transcript = result[0].transcript;
            if (result.isFinal) s.finalText += transcript;
            else interimText += transcript;
          }
          s.liveText = (s.finalText + interimText).trim();
          this.cb.onInterim(s.liveText);
        };
        recognition.onerror = (event) => {
          const kind = event.error ?? "";
          if (kind === "aborted" || kind === "no-speech") return;
          this.stopEverything();
          this.cb.onState("idle");
          this.emitError(kind === "not-allowed" || kind === "service-not-allowed" ? "denied" : "failed");
        };
        recognition.onend = () => {
          if (this.session?.recognition !== recognition || this.stopRequested) return;
          void this.stop();
        };
        recognition.start();
        session0.recognition = recognition;
      } else {
        const recorder = this.env.createRecorder(stream);
        if (!recorder) {
          for (const track of stream.getTracks()) {
            track.stop();
          }
          this.cb.onState("idle");
          this.emitError("unsupported");
          return;
        }
        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) session0.chunks.push(event.data);
        };
        recorder.start(250);
        session0.recorder = recorder;
      }

      session0.ctx = ctx;
      if (this.stopRequested) {
        this.stopEverything(session0);
        this.cb.onState("idle");
        return;
      }
      this.session = session0;
      this.startMeter(analyser);
      session0.stopTimer = setTimeout(() => {
        if (this.session === session0) void this.stop();
      }, 60_000);
    } catch {
      for (const track of stream.getTracks()) {
        track.stop();
      }
      void ctx?.close().catch(() => {});
      this.cb.onState("idle");
      this.emitError("failed");
    }
  }
}
