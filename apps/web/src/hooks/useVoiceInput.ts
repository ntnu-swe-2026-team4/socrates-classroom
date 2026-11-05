import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/api";

type VoiceState = "idle" | "listening" | "processing";
export type VoiceError = "denied" | "unsupported" | "failed";

interface SpeechRecognitionLike {
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

function recognitionCtor(): (new () => SpeechRecognitionLike) | null {
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition) as (new () => SpeechRecognitionLike) | null;
}

interface VoiceSession {
  stream: MediaStream;
  recorder: MediaRecorder | null;
  chunks: Blob[];
  recognition: SpeechRecognitionLike | null;
  finalText: string;
  liveText: string;
  raf: number;
  ctx: AudioContext;
}

export function useVoiceInput(onFinal: (text: string) => void, onAmplitude: (value: number) => void) {
  const [state, setState] = useState<VoiceState>("idle");
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<VoiceError | null>(null);
  const session = useRef<VoiceSession | null>(null);

  const onFinalRef = useRef(onFinal);
  const onAmplitudeRef = useRef(onAmplitude);
  useEffect(() => {
    onFinalRef.current = onFinal;
  });
  useEffect(() => {
    onAmplitudeRef.current = onAmplitude;
  });

  const stopEverything = useCallback(() => {
    const s = session.current;
    if (!s) return;
    cancelAnimationFrame(s.raf);
    s.recognition?.stop();
    if (s.recorder?.state === "recording") {
      s.recorder.stop();
    }
    for (const track of s.stream.getTracks()) {
      track.stop();
    }
    void s.ctx.close().catch(() => {});
    session.current = null;
    onAmplitudeRef.current(0);
  }, []);

  const stopEverythingRef = useRef(stopEverything);
  useEffect(() => {
    stopEverythingRef.current = stopEverything;
  }, [stopEverything]);

  useEffect(() => () => stopEverythingRef.current(), []);

  const start = useCallback(async () => {
    if (session.current) return;
    setInterim("");
    setError(null);
    setState("listening");
    if (!navigator.mediaDevices?.getUserMedia) {
      setState("idle");
      setError("unsupported");
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setState("idle");
      setError("denied");
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
      ctx: null as unknown as AudioContext,
    };
    try {
      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (const v of data) {
          const dev = (v - 128) / 128;
          sum += dev * dev;
        }
        onAmplitudeRef.current(Math.min(1, Math.sqrt(sum / data.length) * 4));
        if (session.current) session.current.raf = requestAnimationFrame(tick);
      };

      const Ctor = recognitionCtor();
      if (Ctor) {
        const recognition = new Ctor();
        recognition.lang = document.documentElement.lang || "zh-Hant";
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.onresult = (event) => {
          const s = session.current;
          if (!s) return;
          let interimText = "";
          for (let i = event.resultIndex; i < event.results.length; i++) {
            const result = event.results[i]!;
            const transcript = result[0]!.transcript;
            if (result.isFinal) s.finalText += transcript;
            else interimText += transcript;
          }
          s.liveText = (s.finalText + interimText).trim();
          setInterim(s.liveText);
        };
        recognition.onerror = (event) => {
          const kind = event.error ?? "";
          if (kind === "aborted" || kind === "no-speech") return;
          stopEverything();
          setState("idle");
          setError("failed");
        };
        recognition.start();
        session0.recognition = recognition;
      } else if (typeof MediaRecorder === "undefined") {
        stream.getTracks().forEach((track) => {
          track.stop();
        });
        setState("idle");
        setError("unsupported");
        return;
      } else {
        const recorder = new MediaRecorder(stream);
        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) session0.chunks.push(event.data);
        };
        recorder.start(250);
        session0.recorder = recorder;
      }

      session0.ctx = ctx;
      session.current = session0;
      tick();
    } catch {
      stream.getTracks().forEach((track) => {
        track.stop();
      });
      setState("idle");
      setError("failed");
    }
  }, [stopEverything]);

  const stop = useCallback(async () => {
    const s = session.current;
    if (!s) return;

    const capturedFinal = s.liveText;
    const chunks = s.chunks;
    const hasRecognition = Boolean(s.recognition);
    stopEverything();
    setState("processing");
    try {
      if (hasRecognition && capturedFinal) {
        onFinalRef.current(capturedFinal);
      } else if (chunks.length > 0) {
        const blob = new Blob(chunks, { type: chunks[0]!.type });
        const text = await api.stt(blob);
        onFinalRef.current(text);
      }
    } finally {
      setState("idle");
      setInterim("");
    }
  }, [stopEverything]);

  return { state, interim, error, start, stop };
}
