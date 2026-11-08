import { useCallback, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useT } from "@/i18n";
import { BackgroundPaths, LandingTopNav, LogoTitle, useRevealOnce } from "@/landing/LandingChrome";
import { STORY_SCENES } from "@/landing/story";
import { StorySection, useReducedMotion, useStoryDamping } from "@/landing/StorySection";
import { useStoryTour } from "@/landing/useStoryTour";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  const t = useT();
  const navigate = useNavigate();
  const scroller = useRef<HTMLDivElement>(null);
  const logo = useRevealOnce<HTMLDivElement>();
  const reducedMotion = useReducedMotion();
  const [durations, setDurations] = useState<Record<number, number>>({});
  useStoryDamping(scroller, reducedMotion);
  const tourApi = useStoryTour(scroller, reducedMotion, durations);
  const sceneReady = Boolean(tourApi.tour && STORY_SCENES[tourApi.tour.scene].animations.every((n) => n in durations));
  const recordAnimation = useCallback(
    (n: number, duration: number) =>
      setDurations((current) => (current[n] === duration ? current : { ...current, [n]: duration })),
    [],
  );
  const tour = tourApi.tour;

  return (
    <div
      className="landing-root"
      id="site-scroll"
      ref={scroller}
      data-story-tour={Boolean(tour)}
      data-tour-phase={tour?.phase ?? "idle"}
    >
      <LandingTopNav>
        <button type="button" className="top-nav-btn" onClick={() => void navigate({ to: "/login" })}>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="4" y="10" width="16" height="10" rx="2" />
            <path d="M8 10V7a4 4 0 0 1 8 0v3" />
          </svg>
          <span>{t("login_title")}</span>
        </button>
      </LandingTopNav>

      <section className="land-hero" id="land-hero" inert={Boolean(tour)}>
        <BackgroundPaths variant="hero" />
        <div className="land-logo" ref={logo}>
          <p className="hero-eyebrow">{t("app_sub")}</p>
          <LogoTitle text={t("hero_brand")} reduced={reducedMotion} />
          <p className="logo-sub">{t("hero_motto")}</p>

          <button type="button" className="hero-enter" data-story-start onClick={tourApi.startTour}>
            {t("hero_watch_story")} <span aria-hidden="true">↓</span>
          </button>
        </div>
      </section>

      <StorySection
        reducedMotion={reducedMotion}
        tourApi={tourApi}
        sceneReady={sceneReady}
        onRecordAnimation={recordAnimation}
      />

      <section id="story-end" className="land-group" aria-labelledby="story-end-title">
        <BackgroundPaths variant="story" />
        <div className="story-stage" style={{ textAlign: "center", padding: "80px 24px" }}>
          <header className="story-chapter" style={{ justifyContent: "center" }}>
            <h2 id="story-end-title">{t("story_end_title")}</h2>
          </header>
          <p className="login-alt-note" style={{ fontSize: 14.5, margin: "0 auto 28px", maxWidth: 420 }}>
            {t("landing_end_sub")}
          </p>
          <div className="story-end-actions">
            <button
              type="button"
              id="story-end-cta"
              className="pill-btn primary"
              onClick={() => void navigate({ to: "/login" })}
            >
              {t("landing_start")} <span aria-hidden="true">→</span>
            </button>
          </div>
          <p className="entry-note" style={{ marginTop: 40 }}>
            {t("landing_kicker")}
          </p>
        </div>
      </section>
    </div>
  );
}
