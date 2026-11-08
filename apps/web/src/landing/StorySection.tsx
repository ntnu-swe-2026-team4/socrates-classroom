import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { ArrowRight, Pause, Play, SkipForward } from "lucide-react";
import { useT } from "@/i18n";
import { LandAnimation } from "./LandAnimation";
import { STORY_SCENES } from "./story";
import type { TourApi } from "./useStoryTour";
import "./landing.css";

export function useReducedMotion() {
  const [reduced, setReduced] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return reduced;
}

function useReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("is-visible");
            io.unobserve(e.target);
          }
        }),
      { threshold: 0.25 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return ref;
}

export function useStoryDamping(scroller: RefObject<HTMLDivElement | null>, reduced: boolean) {
  useEffect(() => {
    const root = scroller.current;
    if (!root) return;

    const panels = Array.from(root.querySelectorAll<HTMLElement>(".land-group"));
    const focus = new Map<HTMLElement, number>();
    panels.forEach((panel) => focus.set(panel, 0));
    let frame = 0;
    let previousTime = 0;

    const clearMotion = () =>
      panels.forEach((panel) => {
        panel.dataset.scrollActive = "false";
        panel.dataset.storyCurrent = "true";
        panel.style.removeProperty("--story-offset-y");
        panel.style.removeProperty("--story-scale");
      });
    if (reduced) {
      clearMotion();
      return;
    }

    const update = (time: number) => {
      frame = 0;
      const viewport = root.getBoundingClientRect();
      const center = viewport.top + root.clientHeight / 2;
      const fadeDistance = Math.max(root.clientHeight * 0.68, 1);
      let active: HTMLElement | null = null;
      let nearest = Number.POSITIVE_INFINITY;

      for (const panel of panels) {
        const rect = panel.getBoundingClientRect();
        const distance = Math.abs(rect.top + rect.height / 2 - center);
        if (distance < nearest) {
          nearest = distance;
          active = panel;
        }
      }

      const elapsed = previousTime ? Math.min(time - previousTime, 64) : 16;
      previousTime = time;
      const damping = 1 - Math.exp(-elapsed / 210);
      let settling = false;

      for (const panel of panels) {
        const rect = panel.getBoundingClientRect();
        const distance = Math.abs(rect.top + rect.height / 2 - center);
        const target = panel === active ? Math.max(0, 1 - distance / fadeDistance) : 0;
        const current = focus.get(panel) ?? 0;
        const next = current + (target - current) * damping;
        focus.set(panel, next);
        panel.style.setProperty("--story-offset-y", `${((1 - next) * 10).toFixed(2)}px`);
        panel.style.setProperty("--story-scale", (0.996 + next * 0.004).toFixed(4));
        panel.dataset.scrollActive = String(next > 0.015 || target > 0.015);
        panel.dataset.storyCurrent = String(panel === active && target > 0.015);
        if (Math.abs(target - next) > 0.002) settling = true;
      }

      if (settling) frame = requestAnimationFrame(update);
    };

    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    root.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    schedule();

    return () => {
      root.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame) cancelAnimationFrame(frame);
      clearMotion();
    };
  }, [scroller, reduced]);
}

function Word({ className, children, standalone }: { className?: string; children: ReactNode; standalone?: boolean }) {
  const ref = useReveal<HTMLDivElement>();
  return (
    <div ref={ref} className={`land-word ${standalone ? "land-word-standalone" : ""} ${className ?? ""}`}>
      {children}
    </div>
  );
}

export function StorySection({
  reducedMotion,
  tourApi,
  sceneReady,
  onRecordAnimation,
}: {
  reducedMotion: boolean;
  tourApi: TourApi;
  sceneReady: boolean;
  onRecordAnimation: (n: number, duration: number) => void;
}) {
  const t = useT();
  const { tour, goToEnd, togglePause, nextScene } = tourApi;
  const storyPlayer = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!tour) return;
    const frame = requestAnimationFrame(() => storyPlayer.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [tour?.session, tour]);

  return (
    <>
      {STORY_SCENES.map((scene, index) => (
        <section
          className="land-group"
          id={`land-group-${index + 1}`}
          key={scene.title}
          aria-labelledby={`story-title-${index}`}
          data-tour-active={tour?.scene === index}
          inert={Boolean(tour && tour.scene !== index)}
        >
          <div className="story-stage">
            <header className="story-chapter">
              <span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
              <h2 id={`story-title-${index}`}>{t(scene.title)}</h2>
            </header>
            <div className="land-cluster">
              {scene.animations.map((n, part) => (
                <LandAnimation
                  key={n}
                  n={n}
                  label={t(scene.title)}
                  className={part === 0 ? `is-primary pos-p${index + 1}` : `is-secondary pos-s${index + 1}`}
                  reducedMotion={reducedMotion}
                  tourMode={Boolean(tour)}
                  active={tour?.scene === index}
                  playing={tour?.scene === index && tour.phase === "playing" && sceneReady}
                  preload={Boolean(tour && index >= tour.scene && index <= tour.scene + 1)}
                  session={tour?.session ?? 0}
                  onReady={onRecordAnimation}
                />
              ))}
              <Word className={`pos-w${index + 1}`}>{t(scene.text)}</Word>
            </div>
            {scene.aside && <Word standalone>{t(scene.aside)}</Word>}
          </div>
        </section>
      ))}

      {tour && (
        <div className="story-player" ref={storyPlayer} tabIndex={-1} aria-label={t("故事播放控制")}>
          <span className="story-player-count" aria-hidden="true">
            {String(tour.scene + 1).padStart(2, "0")} / 04
          </span>
          <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
            {t("第 {n} 幕，共 4 幕。", { n: tour.scene + 1 })}
            {t(STORY_SCENES[tour.scene].title)}。
            {!sceneReady ? t("載入故事") : tour.phase === "paused" ? t("已暫停") : ""}
          </p>
          <div className="story-player-actions">
            {reducedMotion ? (
              <button
                className="story-next"
                onClick={nextScene}
                disabled={tour.phase === "moving" || tour.phase === "leaving"}
              >
                {tour.scene === 3 ? t("進入教室") : t("下一幕")}
                <ArrowRight size={16} aria-hidden="true" />
              </button>
            ) : (
              <button
                className="story-pause"
                onClick={togglePause}
                disabled={tour.phase === "moving" || tour.phase === "leaving"}
                aria-label={tour.phase === "paused" ? t("繼續播放故事") : t("暫停故事")}
                title={tour.phase === "paused" ? t("繼續播放") : t("暫停")}
              >
                {tour.phase === "paused" ? (
                  <Play size={18} aria-hidden="true" />
                ) : (
                  <Pause size={18} aria-hidden="true" />
                )}
              </button>
            )}
            <button className="story-skip" onClick={goToEnd} aria-label={t("跳過故事，前往登入")}>
              {t("跳過")}
              <SkipForward size={16} aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
