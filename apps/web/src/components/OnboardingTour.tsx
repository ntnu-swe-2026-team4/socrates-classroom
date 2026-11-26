import { useRef, useState } from "react";
import { Button, POPUP_SURFACE, cn, trapDialogFocus } from "@/components/ui";
import { useDomEvent } from "@/hooks/useSubscription";
import { useI18n } from "@/i18n";
import { TOUR_STEPS, finishTour, type TourStep } from "@/lib/tour";

export const TOUR_RAIL_ATTR = "data-tour-rail";

const SPOT_PADDING = 4;
const CARD_GAP = 14;
const EDGE = 12;

const COPY = {
  home: { title: "nav_home", body: "tour_home_body" },
  chat: { title: "nav_chat", body: "tour_chat_body" },
  classrooms: { title: "nav_classrooms", body: "tour_classrooms_body" },
  notifications: { title: "tour_notifications_title", body: "tour_notifications_body" },
  theme: { title: "tour_theme_title", body: "tour_theme_body" },
  account: { title: "tour_account_title", body: "tour_account_body" },
} as const;

function targetRect(step: TourStep): DOMRect | null {
  const target = document.querySelector(`[${TOUR_RAIL_ATTR}] [data-tour="${step}"]`);
  if (!(target instanceof HTMLElement)) return null;
  target.scrollIntoView?.({ block: "nearest" });
  const rect = target.getBoundingClientRect();
  return rect.width === 0 && rect.height === 0 ? null : rect;
}

function place(step: TourStep, spot: HTMLElement | null, card: HTMLElement | null): void {
  if (!spot || !card) return;
  const rect = targetRect(step);
  spot.dataset.located = rect ? "true" : "false";
  card.style.top = "";
  card.style.bottom = "";
  if (!rect) {
    Object.assign(spot.style, { top: "50%", left: "50%", width: "0px", height: "0px" });
    Object.assign(card.style, { top: "50%", left: "50%", transform: "translate(-50%, -50%)" });
    return;
  }
  const top = rect.top - SPOT_PADDING;
  const height = rect.height + SPOT_PADDING * 2;
  Object.assign(spot.style, {
    top: `${top}px`,
    left: `${rect.left - SPOT_PADDING}px`,
    width: `${rect.width + SPOT_PADDING * 2}px`,
    height: `${height}px`,
  });
  card.style.transform = "";
  card.style.left = `${rect.right + SPOT_PADDING + CARD_GAP}px`;
  if (top + height / 2 < window.innerHeight / 2) card.style.top = `${Math.max(EDGE, top)}px`;
  else card.style.bottom = `${Math.max(EDGE, window.innerHeight - top - height)}px`;
}

export function OnboardingTour({ userId, onStep }: { userId: string; onStep: (step: TourStep) => void }) {
  const { t } = useI18n();
  const [index, setIndex] = useState(0);
  const spotRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const step = TOUR_STEPS[index] ?? "home";
  const last = index === TOUR_STEPS.length - 1;

  useDomEvent(window, "resize", () => place(step, spotRef.current, cardRef.current));

  const go = (next: number) => {
    const target = TOUR_STEPS[next];
    if (!target) return;
    onStep(target);
    setIndex(next);
  };
  const close = () => finishTour(userId);

  return (
    <div className="fixed inset-0 z-50">
      <div aria-hidden className="absolute inset-0" />
      <div
        ref={spotRef}
        aria-hidden
        data-tour-spot={step}
        className="pointer-events-none absolute border-2 border-comic-ochre shadow-[0_0_0_9999px] shadow-black/55 motion-safe:transition-all motion-safe:duration-200"
      />
      <div
        ref={trapDialogFocus}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            close();
          }
        }}
      >
        <div
          ref={cardRef}
          className={cn(
            POPUP_SURFACE,
            "absolute flex w-[min(320px,calc(100vw-120px))] flex-col gap-2 border border-line bg-paper p-4",
          )}
        >
          <p className="text-[11.5px] text-ink-faint tabular-nums">
            {index + 1} / {TOUR_STEPS.length}
          </p>
          <h2 id="tour-title" className="text-[16px] leading-tight font-semibold text-ink">
            {t(COPY[step].title)}
          </h2>
          <p aria-live="polite" className="text-[13.5px] leading-relaxed text-ink-soft">
            {t(COPY[step].body)}
          </p>
          <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
            <Button size="sm" className="order-3" onClick={() => (last ? close() : go(index + 1))}>
              {t(last ? "tour_done" : "tour_next")}
            </Button>
            {index > 0 && (
              <Button variant="outline" size="sm" className="order-2" onClick={() => go(index - 1)}>
                {t("tour_back")}
              </Button>
            )}
            <button
              type="button"
              onClick={close}
              className="order-1 mr-auto cursor-pointer text-[13px] text-ink-soft transition-colors hover:text-ink"
            >
              {t("tour_skip")}
            </button>
          </div>
        </div>
      </div>
      <span
        key={step}
        hidden
        ref={(node) => {
          if (node) place(step, spotRef.current, cardRef.current);
        }}
      />
    </div>
  );
}
