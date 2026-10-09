import { useEffect, useRef, useState, type CSSProperties } from "react";
import lottie from "lottie-web/build/player/lottie_canvas";
import type { AnimationItem } from "lottie-web";
import { ANIMATION_ASPECT_RATIOS } from "./story";

type Props = {
  n: number;
  className: string;
  label: string;
  reducedMotion: boolean;
  tourMode: boolean;
  active: boolean;
  playing: boolean;
  preload: boolean;
  session: number;
  onReady: (n: number, duration: number) => void;
};

export function LandAnimation({ n, className, label, reducedMotion, tourMode, active, playing, preload, session, onReady }: Props) {
  const box = useRef<HTMLButtonElement>(null);
  const inner = useRef<HTMLSpanElement>(null);
  const anim = useRef<AnimationItem | null>(null);
  const playedSession = useRef<number | null>(null);
  const [requested, setRequested] = useState(false);
  const [inView, setInView] = useState(false);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [pageVisible, setPageVisible] = useState(!document.hidden);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const root = el.closest("#site-scroll");
    const loader = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setRequested(true); loader.disconnect(); }
    }, { root, rootMargin: "200px 0px" });
    const visibility = new IntersectionObserver(([entry]) => {
      setInView(entry.isIntersecting);
      if (entry.isIntersecting) el.classList.add("is-visible");
    }, { root, threshold: 0.15 });
    const onVisibility = () => setPageVisible(!document.hidden);
    loader.observe(el);
    visibility.observe(el);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      loader.disconnect(); visibility.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  useEffect(() => { if (preload) setRequested(true); }, [preload]);

  useEffect(() => {
    const container = inner.current;
    if (!requested || !container) return;
    const animation = lottie.loadAnimation({
      container, renderer: "canvas", loop: false, autoplay: false,
      path: `/landing/landing-${n}.json`, rendererSettings: { preserveAspectRatio: "xMidYMid slice" },
    });
    anim.current = animation;
    const loaded = () => {
      animation.resize();
      setReady(true);
      onReady(n, animation.getDuration(false) * 1000);
    };
    const loadFailed = () => { setFailed(true); onReady(n, 0); };
    animation.addEventListener("DOMLoaded", loaded);
    animation.addEventListener("data_failed", loadFailed);
    const resize = new ResizeObserver(() => { if (animation.isLoaded) animation.resize(); });
    resize.observe(container);
    return () => {
      resize.disconnect();
      animation.removeEventListener("DOMLoaded", loaded);
      animation.removeEventListener("data_failed", loadFailed);
      animation.destroy();
      anim.current = null;
    };
  }, [n, requested, onReady]);

  useEffect(() => {
    const animation = anim.current;
    if (!animation || !ready) return;
    if (reducedMotion) {
      animation.goToAndStop(Math.floor(animation.totalFrames * 0.35), true);
      return;
    }
    animation.loop = true;
    if (!pageVisible) { animation.pause(); return; }
    if (tourMode) {
      if (!active) {
        animation.goToAndStop(0, true);
        playedSession.current = null;
      } else if (!playing) animation.pause();
      else if (playedSession.current !== session) {
        playedSession.current = session;
        animation.goToAndPlay(0, true);
      } else animation.play();
    } else {
      playedSession.current = null;
      if (inView) animation.play();
      else animation.pause();
    }
  }, [ready, reducedMotion, tourMode, active, playing, session, inView, pageVisible]);

  const onMove = (event: React.MouseEvent) => {
    if (reducedMotion || tourMode || !window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    const rect = box.current!.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - 0.5;
    const y = (event.clientY - rect.top) / rect.height - 0.5;
    box.current!.style.transform = `perspective(1000px) rotateX(${-y * 2}deg) rotateY(${x * 2}deg)`;
  };

  return (
    <button
      type="button" ref={box} className={`land-json ${className}`} disabled={tourMode || reducedMotion}
      style={{ "--animation-ratio": ANIMATION_ASPECT_RATIOS[n] } as CSSProperties}
      data-loaded={ready} data-animation={n} aria-label={`重播「${label}」的插畫`}
      onClick={() => { if (ready) anim.current?.goToAndPlay(0, true); }}
      onMouseMove={onMove} onMouseLeave={() => { if (box.current) box.current.style.transform = ""; }}
    >
      <span ref={inner} className="land-json-inner" aria-hidden="true" />
      {!ready && <span className="animation-loading">{failed ? "插畫暫時無法顯示" : "插畫載入中…"}</span>}
    </button>
  );
}
