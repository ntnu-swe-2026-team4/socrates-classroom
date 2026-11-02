import type React from "react";
import { createContext, useContext, useState } from "react";

interface AudioContextType {
  isMuted: boolean;
  toggleMute: () => void;
}

const AudioContext = createContext<AudioContextType | undefined>(undefined);

export const AudioProvider = ({ children }: { children: React.ReactNode }) => {
  const [isMuted, setIsMuted] = useState(() => {
    return localStorage.getItem("isMuted") === "true";
  });

  const toggleMute = () => {
    setIsMuted((prev) => {
      const newValue = !prev;
      localStorage.setItem("isMuted", String(newValue));
      return newValue;
    });
  };

  return <AudioContext.Provider value={{ isMuted, toggleMute }}>{children}</AudioContext.Provider>;
};

export const useAudioSettings = () => {
  const context = useContext(AudioContext);
  if (!context) {
    return { isMuted: false, toggleMute: () => {} };
  }
  return context;
};

export const usePlaySound = () => {
  const context = useContext(AudioContext);
  const isMuted = context ? context.isMuted : false;

  const playEffect = (filename: string, options?: { loop?: boolean; volume?: number }) => {
    if (isMuted) return null;

    try {
      const audio = new Audio(`/sounds/${filename}`);
      if (options?.loop) audio.loop = true;
      if (options?.volume !== undefined) audio.volume = options.volume;

      audio.play().catch((err) => {
        console.warn(`音效播放被瀏覽器阻擋或發生錯誤: ${filename}`, err);
      });

      return audio;
    } catch (err) {
      console.error("音效初始化失敗:", err);
      return null;
    }
  };

  return playEffect;
};
