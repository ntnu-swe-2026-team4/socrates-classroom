import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/api";

type VoiceState = "idle" | "listening" | "processing";

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
  onerror: (() => void) | null;
  onend: (() => void) | null;
}

function recognitionCtor(): (new () => SpeechRecognitionLike) | null {
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition) as (new () => SpeechRecognitionLike) | null;
}

export function useVoiceInput(onFinal: (text: string) => void, onAmplitude: (value: number) => void) {
  const [state, setState] = useState<VoiceState>("idle");
  const [interim, setInterim] = useState("");
  const session = useRef<{
    stream: MediaStream;
    recorder: MediaRecorder | null;
    chunks: Blob[];
    recognition: SpeechRecognitionLike | null;
    finalText: string;
    raf: number;
    ctx: AudioContext;
  } | null>(null);

  const stopEverything = useCallback(() => {
    const session0 = session.current;
    if (!session0) return;
    cancelAnimationFrame(session0.raf);
    session0.recognition?.stop();
    if (session0.recorder?.state === "recording") {
      session0.recorder.stop();
    }
    for (const track of session0.stream.getTracks()) {
      track.stop();
    }
    void session0.ctx.close().catch(() => {});
    session.current = null;
    onAmplitude(0);
  }, [onAmplitude]);

  useEffect(() => {
    return () => stopEverything();
  }, [stopEverything]);

  const start = useCallback(async () => {
    if (session.current) return;
    setInterim("");
    setState("listening");
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
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
      onAmplitude(Math.min(1, Math.sqrt(sum / data.length) * 4));
      const s = session.current;
      if (s) s.raf = requestAnimationFrame(tick);
    };

    const Ctor = recognitionCtor();
    let recognition: SpeechRecognitionLike | null = null;
    let finalText = "";
    if (Ctor) {
      recognition = new Ctor();
      recognition.lang = document.documentElement.lang || "zh-Hant";
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.onresult = (event) => {
        let interimText = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i]!;
          const transcript = result[0]!.transcript;
          if (result.isFinal) finalText += transcript;
          else interimText += transcript;
        }
        setInterim((finalText + interimText).trim());
      };
      recognition.onerror = () => {};
      recognition.start();
    }

    let recorder: MediaRecorder | null = null;
    const chunks: Blob[] = [];
    if (!Ctor && typeof MediaRecorder !== "undefined") {
      recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recorder.start(250);
    }

    session.current = { stream, recorder, chunks, recognition, finalText, raf: 0, ctx };
    tick();
  }, [onAmplitude]);

  const stop = useCallback(async () => {
    const s = session.current;
    if (!s) return;

    const capturedFinal = s.finalText + interim;
    const chunks = s.chunks;
    const hasRecognition = Boolean(s.recognition);
    stopEverything();
    setState("processing");
    try {
      if (hasRecognition && capturedFinal.trim()) {
        onFinal(capturedFinal.trim());
      } else if (chunks.length > 0) {
        const blob = new Blob(chunks, { type: chunks[0]!.type });
        const text = await api.stt(blob);
        onFinal(text);
      }
    } finally {
      setState("idle");
      setInterim("");
    }
  }, [interim, onFinal, stopEverything]);

  return { state, interim, start, stop };
}
