import { useCallback } from "react";
import { usePersistentFlag } from "@/hooks/usePersistentFlag";
import { playSound, type SoundName, UX_SOUND_STORAGE_KEY } from "@/lib/sound";

export function useSound() {
  const [enabled, setEnabled] = usePersistentFlag(UX_SOUND_STORAGE_KEY, false);

  const play = useCallback(
    (name: SoundName, volume?: number) => {
      if (!enabled) return;
      playSound(name, volume);
    },
    [enabled],
  );

  return { enabled, setEnabled, play };
}
