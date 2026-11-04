import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AmbientGlow } from "@/components/AmbientGlow";
import { Wordmark } from "@/components/ui";
import { useT } from "@/i18n";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  const t = useT();
  const navigate = useNavigate();
  const [text, setText] = useState("");

  function begin() {
    const draft = text.trim();
    void navigate({ to: "/dialogue", search: draft ? { q: draft } : {} });
  }

  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden px-6 text-center">
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
              viewBox="0 0 20 20"
              className="h-4.5 w-4.5 fill-none stroke-current stroke-[1.8]"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4 10h11M10.5 5.5 15 10l-4.5 4.5" />
            </svg>
          </button>
        </form>

        <div className="mt-5 flex items-center gap-2 text-[13px]">
          <button
            type="button"
            onClick={() => void navigate({ to: "/join/$code", params: { code: "socrat" } })}
            className="rounded-full border border-line bg-card/70 px-4 py-1.5 text-ink-soft transition-colors hover:border-ember hover:text-ember"
          >
            {t("hero_chip_join")}
          </button>
          <button
            type="button"
            onClick={() => void navigate({ to: "/t/setup" })}
            className="rounded-full border border-line bg-card/70 px-4 py-1.5 text-ink-soft transition-colors hover:border-ember hover:text-ember"
          >
            {t("hero_chip_teach")}
          </button>
        </div>
      </div>

      <div className="absolute bottom-6 z-10 flex flex-col items-center gap-2">
        <Wordmark sub />
        <p className="text-[12px] text-ink-faint">{t("landing_kicker")}</p>
      </div>
    </div>
  );
}
