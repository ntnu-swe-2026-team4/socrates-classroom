import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { STORY_SCENES } from "./story";

type TourPhase = "moving" | "playing" | "paused" | "leaving";
type StoryTour = { scene: number; phase: TourPhase; session: number };

export function useStoryTour(
  scroller: RefObject<HTMLDivElement | null>,
  reducedMotion: boolean,
  animationDurations: Record<number, number>,
) {
  const [tour, setTour] = useState<StoryTour | null>(null);
  const session = useRef(0);
  const clock = useRef({ key: "", elapsed: 0 });
  const scene = tour ? STORY_SCENES[tour.scene] : null;
  const ready = Boolean(scene?.animations.every((n) => n in animationDurations));
  const sceneKey = tour ? `${tour.session}:${tour.scene}` : "";

  const goToLogin = useCallback(() => {
    setTour(null);
    const root = scroller.current;
    const login = root?.querySelector<HTMLElement>("#login-screen");
    if (root && login) {
      const top = root.scrollTop + login.getBoundingClientRect().top - root.getBoundingClientRect().top;
      root.scrollTo({ top, behavior: reducedMotion ? "instant" : "smooth" });
      root.querySelector<HTMLElement>("#login-title")?.focus({ preventScroll: true });
    }
  }, [scroller, reducedMotion]);

  const goToTop = useCallback(() => {
    setTour(null);
    scroller.current?.scrollTo({ top: 0, behavior: reducedMotion ? "instant" : "smooth" });
    scroller.current?.querySelector<HTMLElement>(".hero-enter")?.focus({ preventScroll: true });
  }, [scroller, reducedMotion]);

  const startTour = useCallback(() => {
    session.current += 1;
    setTour({ scene: 0, phase: "moving", session: session.current });
  }, []);

  const togglePause = useCallback(() => {
    setTour((current) => {
      if (current?.phase === "playing") return { ...current, phase: "paused" };
      if (current?.phase === "paused") return { ...current, phase: "playing" };
      return current;
    });
  }, []);

  const nextScene = useCallback(() => {
    setTour((current) => current ? { ...current, phase: "leaving" } : null);
  }, []);

  // Each move has its own completion boundary; playback starts after arriving.
  useEffect(() => {
    const root = scroller.current;
    if (!root || tour?.phase !== "moving") return;
    const panel = root.querySelector<HTMLElement>(`#land-group-${tour.scene + 1}`);
    if (!panel) return;
    const currentTour = tour;
    const from = root.scrollTop;
    const started = performance.now();
    const moveDuration = currentTour.scene === 0 ? 850 : 620;
    let frame = 0;

    const move = (now: number) => {
      const progress = reducedMotion ? 1 : Math.min(1, (now - started) / moveDuration);
      const eased = progress < 0.5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2;
      const destination = root.scrollTop + panel.getBoundingClientRect().top - root.getBoundingClientRect().top;
      root.scrollTo({ top: from + (destination - from) * eased, behavior: "instant" });
      if (progress < 1) frame = requestAnimationFrame(move);
      else setTour((current) => current?.session === currentTour.session && current.scene === currentTour.scene && current.phase === "moving"
        ? { ...current, phase: "playing" } : current);
    };
    frame = requestAnimationFrame(move);
    return () => cancelAnimationFrame(frame);
  }, [scroller, tour?.scene, tour?.phase, tour?.session, reducedMotion]);

  // Hold each loaded scene for five seconds; pausing preserves the remaining time.
  useEffect(() => {
    if (clock.current.key !== sceneKey) clock.current = { key: sceneKey, elapsed: 0 };
    if (!tour || tour.phase !== "playing" || !ready || reducedMotion) return;
    const currentTour = tour;
    const started = performance.now();
    const timer = window.setTimeout(() => {
      setTour((current) => current?.session === currentTour.session && current.scene === currentTour.scene && current.phase === "playing"
        ? { ...current, phase: "leaving" } : current);
    }, Math.max(0, 5000 - clock.current.elapsed));
    return () => {
      window.clearTimeout(timer);
      if (clock.current.key === sceneKey) clock.current.elapsed += performance.now() - started;
    };
  }, [sceneKey, tour?.phase, ready, reducedMotion]);

  useEffect(() => {
    if (tour?.phase !== "leaving") return;
    const currentTour = tour;
    const timer = window.setTimeout(() => {
      if (currentTour.scene === STORY_SCENES.length - 1) goToLogin();
      else setTour((current) => current?.session === currentTour.session && current.scene === currentTour.scene && current.phase === "leaving"
        ? { ...current, scene: current.scene + 1, phase: "moving" } : current);
    }, reducedMotion ? 0 : 260);
    return () => window.clearTimeout(timer);
  }, [tour?.scene, tour?.phase, tour?.session, goToLogin, reducedMotion]);

  useEffect(() => {
    const root = scroller.current;
    if (!root || !tour) return;
    const interrupt = (event: Event) => {
      // Tapping the playback controls on a phone must not cancel the tour.
      if (event.type === "touchstart" && event.target instanceof Element && event.target.closest(".story-player")) return;
      setTour(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setTour(null);
      else if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)
        && !(event.target instanceof Element && event.target.closest("button, input, textarea, select, a"))) setTour(null);
    };
    const onVisibility = () => {
      if (document.hidden) setTour((current) => current?.phase === "playing"
        ? { ...current, phase: "paused" } : current?.phase === "paused" ? current : null);
    };
    root.addEventListener("wheel", interrupt, { passive: true });
    root.addEventListener("touchstart", interrupt, { passive: true });
    root.addEventListener("keydown", onKey);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      root.removeEventListener("wheel", interrupt);
      root.removeEventListener("touchstart", interrupt);
      root.removeEventListener("keydown", onKey);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [scroller, Boolean(tour)]);

  return { tour, ready, startTour, goToLogin, goToTop, togglePause, nextScene };
}
