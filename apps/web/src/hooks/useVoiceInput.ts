import { useLayoutEffect, useRef, useState } from "react";
import {
  defaultVoiceEnv,
  VoiceInputController,
  type VoiceCallbacks,
  type VoiceError,
  type VoiceState,
} from "@/lib/voiceInput";

export type { VoiceError, VoiceState } from "@/lib/voiceInput";

export function useVoiceInput(onFinal: (text: string) => void, onAmplitude: (value: number) => void) {
  const [state, setState] = useState<VoiceState>("idle");
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<VoiceError | null>(null);

  const onFinalRef = useRef(onFinal);
  const onAmplitudeRef = useRef(onAmplitude);
  useLayoutEffect(() => {
    onFinalRef.current = onFinal;
    onAmplitudeRef.current = onAmplitude;
  });

  const controllerRef = useRef<VoiceInputController | null>(null);

  useLayoutEffect(() => {
    const callbacks: VoiceCallbacks = {
      onFinal: (text) => onFinalRef.current(text),
      onAmplitude: (value) => onAmplitudeRef.current(value),
      onState: setState,
      onInterim: setInterim,
      onError: setError,
    };
    const controller = new VoiceInputController(defaultVoiceEnv, callbacks);
    controllerRef.current = controller;
    return () => {
      controller.dispose();
      controllerRef.current = null;
    };
  }, []);

  return {
    state,
    interim,
    error,
    start: () => controllerRef.current?.start() ?? Promise.resolve(),
    stop: () => {
      void controllerRef.current?.stop();
    },
  };
}
