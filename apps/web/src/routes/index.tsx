import { useCallback, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AmbientGlow } from "@/components/AmbientGlow";
import { Wordmark } from "@/components/ui";
import { useT } from "@/i18n";
import { DEFAULT_JOIN_CODE } from "@/api";
import { STORY_SCENES } from "@/landing/story";
import { StorySection, useReducedMotion, useStoryDamping } from "@/landing/StorySection";
import { useStoryTour } from "@/landing/useStoryTour";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  const t = useT();
  const navigate = useNavigate();
  const [text, setText] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
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

  function begin() {
    const draft = text.trim();
    void navigate({
      to: "/join/$code",
      params: { code: DEFAULT_JOIN_CODE },
      ...(draft ? { search: { draft } } : {}),
    });
  }

  return (
    <div
      className="landing-root"
      id="site-scroll"
      ref={scroller}
      data-story-tour={Boolean(tour)}
      data-tour-phase={tour?.phase ?? "idle"}
    >
      <section
        className="flex min-h-dvh flex-col items-center justify-center overflow-hidden px-6 text-center"
        inert={Boolean(tour)}
      >
        <AmbientGlow />

        <div className="relative z-10 flex flex-col items-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-ink font-serif text-xl font-semibold text-paper shadow-sm">
            詰
          </span>
          <h1 className="mt-7 font-serif text-3xl font-medium tracking-wide text-ink sm:text-4xl">
            {t("hero_greeting")}
          </h1>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              begin();
            }}
            className="mt-9 flex h-13 w-full max-w-xl items-center gap-2 rounded-full border border-line bg-card py-2 pr-2 pl-6 shadow-sm"
          >
            <input
              value={text}
              placeholder={t("hero_placeholder")}
              onChange={(event) => setText(event.target.value)}
              className="h-9 min-w-0 flex-1 bg-transparent text-left text-[15px] text-ink placeholder:text-ink-faint focus:outline-none"
            />
            <button
              type="submit"
              aria-label={t("join_start")}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ember text-paper transition-colors hover:bg-ember-deep"
            >
              <svg
                aria-hidden
                viewBox="0 0 20 20"
                className="h-4.5 w-4.5 fill-none stroke-current stroke-[1.8]"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M4 10h11M10.5 5.5 15 10l-4.5 4.5" />
              </svg>
            </button>
          </form>

          <div className="mt-5 flex flex-wrap items-center justify-center gap-2 text-[13px]">
            <button
              type="button"
              onClick={() => void navigate({ to: "/join/$code", params: { code: DEFAULT_JOIN_CODE } })}
              className="rounded-full border border-line bg-card/70 px-4 py-1.5 text-ink-soft transition-colors hover:border-ember hover:text-ember"
            >
              {t("hero_chip_join")}
            </button>
            <button
              type="button"
              onClick={() => void navigate({ to: "/login" })}
              className="rounded-full border border-line bg-card/70 px-4 py-1.5 text-ink-soft transition-colors hover:border-ember hover:text-ember"
            >
              {t("hero_chip_teach")}
            </button>
            <button
              type="button"
              data-story-start
              onClick={tourApi.startTour}
              className="rounded-full border border-line bg-card/70 px-4 py-1.5 text-ink-soft transition-colors hover:border-ember hover:text-ember"
            >
              {t("hero_watch_story")} <span aria-hidden="true">↓</span>
            </button>
          </div>
        </div>
      </section>

      <StorySection
        reducedMotion={reducedMotion}
        tourApi={tourApi}
        sceneReady={sceneReady}
        onRecordAnimation={recordAnimation}
      />

      <section id="story-end" className="land-group" aria-labelledby="story-end-title">
        <div className="story-stage flex flex-col items-center gap-6 py-20 text-center">
          <h2 id="story-end-title" className="font-serif text-2xl font-medium text-ink sm:text-3xl">
            {t("story_end_title")}
          </h2>
          <p className="max-w-md text-[14.5px] leading-[1.85] text-ink-soft">{t("story_end_sub")}</p>
          <div className="flex flex-wrap justify-center gap-3">
            <button
              type="button"
              id="story-end-cta"
              onClick={() => void navigate({ to: "/join/$code", params: { code: DEFAULT_JOIN_CODE } })}
              className="rounded-full bg-ember px-6 py-2.5 text-[14.5px] text-paper shadow-sm transition-colors hover:bg-ember-deep"
            >
              {t("story_end_cta")}
            </button>
            <button
              type="button"
              onClick={() => void navigate({ to: "/login" })}
              className="rounded-full border border-line bg-card px-6 py-2.5 text-[14.5px] text-ink-soft transition-colors hover:border-ember hover:text-ember"
            >
              {t("story_end_teacher")}
            </button>
          </div>
        </div>
      </section>

      <div className="flex flex-col items-center gap-2 pb-10">
        <Wordmark sub />
        <p className="text-[12px] text-ink-faint">{t("landing_kicker")}</p>
      </div>
    </div>
  );
}
