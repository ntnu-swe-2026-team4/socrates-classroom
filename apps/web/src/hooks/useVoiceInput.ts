import { useLayoutEffect, useRef, useState } from "react";
import { useOnUnmount } from "@/hooks/useSubscription";
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

  const [controller] = useState(() => {
    const callbacks: VoiceCallbacks = {
      onFinal: (text) => onFinalRef.current(text),
      onAmplitude: (value) => onAmplitudeRef.current(value),
      onState: setState,
      onInterim: setInterim,
      onError: setError,
    };
    return new VoiceInputController(defaultVoiceEnv, callbacks);
  });

  useOnUnmount(() => controller.dispose());

  return { state, interim, error, start: () => controller.start(), stop: () => controller.stop() };
}
