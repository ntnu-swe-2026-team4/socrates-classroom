import { useCallback, useEffect, useRef, useState } from "react";

const ACTIVITY_EVENTS = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"] as const;
const CHECK_EVERY_MS = 15_000;

export function useIdle(timeoutMs: number, watching: boolean) {
  const [idle, setIdle] = useState(false);
  const lastActivity = useRef(Date.now());

  useEffect(() => {
    if (!watching) return;
    lastActivity.current = Date.now();
    const touch = () => {
      lastActivity.current = Date.now();
    };
    for (const name of ACTIVITY_EVENTS) window.addEventListener(name, touch, { passive: true });
    const timer = window.setInterval(() => {
      if (Date.now() - lastActivity.current >= timeoutMs) setIdle(true);
    }, CHECK_EVERY_MS);
    return () => {
      for (const name of ACTIVITY_EVENTS) window.removeEventListener(name, touch);
      window.clearInterval(timer);
    };
  }, [timeoutMs, watching]);

  useEffect(() => {
    if (!watching) setIdle(false);
  }, [watching]);

  const resume = useCallback(() => {
    lastActivity.current = Date.now();
    setIdle(false);
  }, []);

  return { idle, resume };
}
