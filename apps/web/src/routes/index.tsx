import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui";
import { useT } from "@/i18n";

export const Route = createFileRoute("/")({
  component: Landing,
});

function Landing() {
  const t = useT();
  return (
    <div className="relative mx-auto flex min-h-[calc(100vh-3.5rem)] w-full max-w-3xl flex-col items-center justify-center px-6 py-16 text-center">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.5]"
        style={{
          background:
            "radial-gradient(42rem 30rem at 50% 8%, var(--color-ember-wash), transparent 70%), radial-gradient(30rem 22rem at 85% 90%, var(--color-moss-wash), transparent 70%)",
        }}
      />
      <p className="relative mb-6 font-serif text-[15px] tracking-widest text-ink-faint">{t("landing_kicker")}</p>
      <h1 className="relative max-w-2xl font-serif text-4xl font-semibold leading-[1.35] text-ink sm:text-5xl sm:leading-[1.3]">
        {t("landing_title")}
      </h1>
      <p className="relative mt-6 max-w-xl text-[15.5px] leading-[1.9] text-ink-soft">{t("landing_body")}</p>
      <div className="relative mt-10 flex flex-col items-center gap-3 sm:flex-row">
        <Link to="/t/setup">
          <Button size="lg">{t("landing_cta_teach")}</Button>
        </Link>
        <Link to="/join/$code" params={{ code: "socrat" }}>
          <Button size="lg" variant="outline">
            {t("landing_cta_join")}
          </Button>
        </Link>
      </div>
      <p className="relative mt-6 text-[12.5px] text-ink-faint">{t("landing_hint")}</p>
    </div>
  );
}
