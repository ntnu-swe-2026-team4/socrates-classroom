import React, { createContext, useContext, useState } from 'react';

// 定義 Context 的資料型態
interface AudioContextType {
  isMuted: boolean;
  toggleMute: () => void;
}

const AudioContext = createContext<AudioContextType | undefined>(undefined);

export const AudioProvider = ({ children }: { children: React.ReactNode }) => {
  // 從 localStorage 讀取紀錄，讓使用者重整網頁不失去靜音設定
  const [isMuted, setIsMuted] = useState(() => {
    return localStorage.getItem('isMuted') === 'true';
  });

  const toggleMute = () => {
    setIsMuted(prev => {
      const newValue = !prev;
      localStorage.setItem('isMuted', String(newValue));
      return newValue;
    });
  };

  return (
    <AudioContext.Provider value={{ isMuted, toggleMute }}>
      {children}
    </AudioContext.Provider>
  );
};

// 這是給各個頁面/組件拿來檢查靜音、切換靜音用的 Hook
export const useAudioSettings = () => {
  const context = useContext(AudioContext);
  // 如果外層沒包 Provider（例如登入頁 LandingPage），就回傳安全預設值，網頁才不會整頁白掉
  if (!context) {
    return { isMuted: false, toggleMute: () => {} };
  }
  return context;
};

// 播放音效工具。任何組件要播音效，直接呼叫這個
export const usePlaySound = () => {
  const context = useContext(AudioContext);
  const isMuted = context ? context.isMuted : false;

  const playEffect = (filename: string, options?: { loop?: boolean; volume?: number }) => {
    if (isMuted) return null; // 靜音時直接不播

    try {
      const audio = new Audio(`/sounds/${filename}`);
      if (options?.loop) audio.loop = true;
      if (options?.volume !== undefined) audio.volume = options.volume;

      audio.play().catch(err => {
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
