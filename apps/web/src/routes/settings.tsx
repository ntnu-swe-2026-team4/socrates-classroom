import { createFileRoute, redirect } from "@tanstack/react-router";
import { api } from "@/api";
import { Card, PageHeader } from "@/components/ui";
import { locales, setLocale, useI18n, useT, type Locale } from "@/i18n";
import { cn } from "@/components/ui";

export const Route = createFileRoute("/settings")({
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.fetchQuery({ queryKey: ["me"], queryFn: () => api.me(), staleTime: Infinity });
    if (me?.role !== "teacher") throw redirect({ to: "/home" });
  },
  component: SettingsPage,
});

function SettingsPage() {
  const t = useT();
  const { locale } = useI18n();

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader width="max-w-2xl" eyebrow={t("eyebrow_teacher")} title={t("settings_title")} />
      <div className="mx-auto w-full max-w-2xl px-6 py-6">
        <Card className="flex flex-col gap-3 p-5">
          <p className="font-serif text-[15.5px] text-ink">{t("settings_lang")}</p>
          <div className="inline-flex gap-0.5 self-start rounded-full border border-line-strong bg-paper-deep p-0.5">
            {locales.map((l: Locale) => (
              <button
                type="button"
                key={l}
                onClick={() => setLocale(l)}
                className={cn(
                  "cursor-pointer rounded-full px-4 py-1.5 text-[13px] transition-colors",
                  l === locale ? "bg-ember font-semibold text-on-ember" : "text-ink-soft hover:text-ink",
                )}
              >
                {l === "zh-TW" ? "繁體中文" : l === "en" ? "English" : "Español"}
              </button>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
