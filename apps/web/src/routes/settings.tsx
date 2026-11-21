import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { meOf } from "@/api/me";
import { Card, PageHeader, Segmented, cn } from "@/components/ui";
import { ProviderKeys } from "@/components/ProviderKeys";
import { locales, setLocale, useI18n, useT, type Locale, type MessageKey } from "@/i18n";
import { companion, useCompanion } from "@/lib/companion";
import { KeyRound, MessagesSquare, SlidersHorizontal, Volume1, Volume2, VolumeX } from "lucide-react";

const SECTIONS = [
  { id: "general", label: "settings_nav_general", icon: SlidersHorizontal },
  { id: "dialogue", label: "settings_nav_dialogue", icon: MessagesSquare },
  { id: "keys", label: "settings_nav_keys", icon: KeyRound },
] as const satisfies ReadonlyArray<{ id: string; label: MessageKey; icon: typeof KeyRound }>;
type Section = (typeof SECTIONS)[number]["id"];

export const Route = createFileRoute("/settings")({
  validateSearch: (search: Record<string, unknown>): { section?: Section } => ({
    section: SECTIONS.find((item) => item.id === search.section && item.id !== "general")?.id,
  }),
  beforeLoad: async ({ context }) => {
    const me = await meOf(context.queryClient);
    if (!me) throw redirect({ to: "/home" });
  },
  component: SettingsPage,
});

function SettingsPage() {
  const t = useT();
  const { locale } = useI18n();
  const navigate = useNavigate();
  const wanted = Route.useSearch().section ?? "general";
  const section = SECTIONS.some((item) => item.id === wanted) ? wanted : "general";
  const current = SECTIONS.find((item) => item.id === section) ?? SECTIONS[0]!;
  const hasOwnHeading = section === "keys";

  return (
    <div className="flex min-h-full flex-col bg-paper-deep pb-10">
      <PageHeader width="max-w-5xl" title={t("settings_title")} />
      <div className="mx-auto grid w-full max-w-5xl gap-x-8 gap-y-4 px-4 py-5 md:grid-cols-[200px_minmax(0,1fr)] md:px-6">
        <nav
          aria-label={t("settings_title")}
          className="flex gap-1 overflow-x-auto md:sticky md:top-4 md:flex-col md:self-start md:overflow-visible"
        >
          {SECTIONS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                data-section={item.id}
                aria-current={section === item.id ? "page" : undefined}
                onClick={() =>
                  void navigate({ to: "/settings", search: item.id === "general" ? {} : { section: item.id } })
                }
                className={cn(
                  "flex shrink-0 cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13.5px] whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember",
                  section === item.id
                    ? "bg-paper font-semibold text-ink shadow-sm"
                    : "text-ink-soft hover:bg-paper/60 hover:text-ink",
                )}
              >
                <Icon className="size-4 shrink-0" />
                {t(item.label)}
              </button>
            );
          })}
        </nav>

        <section
          aria-labelledby={hasOwnHeading ? undefined : "settings-section"}
          className="flex min-w-0 max-w-2xl flex-col gap-4"
        >
          {!hasOwnHeading && (
            <h2 id="settings-section" className="text-[17px] font-semibold text-ink">
              {t(current.label)}
            </h2>
          )}
          {section === "general" && (
            <Card className="flex flex-col gap-3 p-5">
              <p className="font-serif text-[15.5px] text-ink">{t("settings_lang")}</p>
              <div className="inline-flex gap-0.5 self-start rounded-lg border border-line-strong bg-paper-deep p-0.5">
                {locales.map((l: Locale) => (
                  <button
                    type="button"
                    key={l}
                    onClick={() => setLocale(l)}
                    className={cn(
                      "cursor-pointer rounded-lg px-4 py-1.5 text-[13px] transition-colors",
                      l === locale ? "bg-ink font-semibold text-paper" : "text-ink-soft hover:text-ink",
                    )}
                  >
                    {l === "zh-TW" ? "繁體中文" : l === "en" ? "English" : "Español"}
                  </button>
                ))}
              </div>
            </Card>
          )}
          {section === "dialogue" && (
            <>
              <ModelCard />
              <VoiceCard />
            </>
          )}
          {section === "keys" && <ProviderKeys />}
        </section>
      </div>
    </div>
  );
}

function ModelCard() {
  const t = useT();
  const { visible } = useCompanion();
  return (
    <Card className="flex flex-col gap-3 p-5">
      <p className="font-serif text-[15.5px] text-ink">{t("settings_model")}</p>
      <div className="flex flex-wrap items-center gap-4">
        <button
          type="button"
          role="switch"
          aria-checked={visible}
          aria-label={t("settings_model_toggle")}
          onClick={() => companion.setVisible(!visible)}
          className={cn(
            "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember",
            visible ? "bg-ember" : "bg-paper-shade",
          )}
        >
          <span
            aria-hidden
            className={cn(
              "inline-block size-5 rounded-full bg-paper shadow transition-transform",
              visible ? "translate-x-5.5" : "translate-x-0.5",
            )}
          />
        </button>
        <span className="text-[13px] text-ink-soft">{visible ? t("settings_model_on") : t("settings_model_off")}</span>
      </div>
      <p className="text-[12px] text-ink-faint">{t("settings_model_hint")}</p>
    </Card>
  );
}

function VoiceCard() {
  const t = useT();
  const { muted, volume, voiceStyle } = useCompanion();
  const enabled = !muted;
  const percent = Math.round(volume * 100);
  const Icon = !enabled || percent === 0 ? VolumeX : percent < 50 ? Volume1 : Volume2;
  return (
    <Card className="flex flex-col gap-3 p-5">
      <p className="font-serif text-[15.5px] text-ink">{t("settings_voice")}</p>
      <div className="flex flex-wrap items-center gap-4">
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={t("settings_voice_toggle")}
          onClick={() => companion.setMuted(enabled)}
          className={cn(
            "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember",
            enabled ? "bg-ember" : "bg-paper-shade",
          )}
        >
          <span
            aria-hidden
            className={cn(
              "inline-block size-5 rounded-full bg-paper shadow transition-transform",
              enabled ? "translate-x-5.5" : "translate-x-0.5",
            )}
          />
        </button>
        <span className="text-[13px] text-ink-soft">{enabled ? t("settings_voice_on") : t("settings_voice_off")}</span>
        <label className={cn("flex min-w-48 flex-1 items-center gap-3", !enabled && "opacity-40")}>
          <Icon className="size-4 shrink-0 text-ink-soft" aria-hidden />
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={percent}
            disabled={!enabled}
            aria-label={t("settings_voice_volume")}
            onChange={(event) => companion.setVolume(Number(event.target.value) / 100)}
            className="h-1.5 min-w-0 flex-1 cursor-pointer accent-ember disabled:cursor-not-allowed"
          />
          <span className="w-10 shrink-0 text-right font-mono text-[12px] text-ink-faint">{percent}%</span>
        </label>
      </div>
      <div className={cn("flex flex-wrap items-center gap-3", !enabled && "opacity-40")}>
        <span className="text-[13px] text-ink-soft">{t("settings_voice_style")}</span>
        <Segmented
          label={t("settings_voice_style")}
          value={voiceStyle}
          onChange={(value) => companion.setVoiceStyle(value)}
          items={[
            { value: "elder", label: t("settings_voice_elder") },
            { value: "natural", label: t("settings_voice_natural") },
          ]}
        />
      </div>
      <p className="text-[12px] text-ink-faint">{t("settings_voice_hint")}</p>
    </Card>
  );
}
