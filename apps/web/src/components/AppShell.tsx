import { useEffect, useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChartNoAxesColumn,
  Globe,
  MessageSquare,
  Moon,
  PanelLeft,
  Plus,
  Search,
  Settings,
  SquareActivity,
  Sun,
  User,
} from "lucide-react";
import { api } from "@/api";
import { cn } from "@/components/ui";
import { locales, setLocale, useI18n, type Locale } from "@/i18n";
import { toggleTheme, useTheme } from "@/theme";

const SLOTS_COLLAPSED_ROW =
  "flex h-9 w-9 items-center justify-center rounded-xl text-ink-soft transition-colors hover:bg-paper-deep hover:text-ink";
const DRAWER_ROW =
  "flex h-9 items-center gap-2.5 rounded-xl px-2.5 text-[13.5px] text-ink-soft transition-colors hover:bg-paper-deep hover:text-ink";
const ROW_ACTIVE = "bg-paper-deep text-ink";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { t, locale } = useI18n();
  const theme = useTheme();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [localeOpen, setLocaleOpen] = useState(false);
  const [search, setSearch] = useState("");
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  const me = useQuery({ queryKey: ["me"], queryFn: () => api.me(), staleTime: Infinity });
  const termHistory = useQuery({ queryKey: ["termHistory"], queryFn: () => api.termHistory() });
  const logout = useMutation({
    mutationFn: () => api.logout(),
    onSuccess: async () => {
      queryClient.setQueryData(["me"], null);
      await navigate({ to: "/" });
    },
  });

  const isTeacher = me.data?.role === "teacher";
  const [currentActivityId, setCurrentActivityId] = useState<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-read on every navigation（mock 的 localStorage 語意，C 連線後改 server-backed）
  useEffect(() => {
    setCurrentActivityId(api.currentActivityId());
  }, [pathname]);

  const actions = [
    {
      to: "/dialogue",
      match: "/dialogue",
      label: t("nav_dialogue"),
      icon: <MessageSquare size={17} strokeWidth={1.6} />,
    },
    ...(currentActivityId
      ? [
          {
            to: "/report/$id",
            params: { id: currentActivityId },
            match: "/report",
            label: t("nav_reports"),
            icon: <ChartNoAxesColumn size={17} strokeWidth={1.6} />,
          },
        ]
      : []),
    ...(isTeacher
      ? [
          { to: "/t/setup", match: "/t/setup", label: t("nav_setup"), icon: <Plus size={17} strokeWidth={1.6} /> },
          ...(currentActivityId
            ? [
                {
                  to: "/t/live/$id",
                  params: { id: currentActivityId },
                  match: "/t/live",
                  label: t("nav_live"),
                  icon: <SquareActivity size={17} strokeWidth={1.6} />,
                },
              ]
            : []),
        ]
      : []),
    { to: "/settings", match: "/settings", label: t("nav_settings"), icon: <Settings size={17} strokeWidth={1.6} /> },
  ];

  const terms = termHistory.data ?? [];
  const q = search.trim().toLowerCase();
  const matchedTerms = q ? terms.filter((item) => item.term.toLowerCase().includes(q)) : terms;

  function navLink(item: (typeof actions)[number], collapsed: boolean) {
    const active = pathname === item.match || pathname.startsWith(`${item.match}/`);
    return (
      <Link
        key={item.match}
        to={item.to}
        params={"params" in item ? item.params : undefined}
        aria-label={item.label}
        title={item.label}
        onClick={() => setDrawerOpen(false)}
        className={cn(collapsed ? SLOTS_COLLAPSED_ROW : DRAWER_ROW, active && ROW_ACTIVE)}
      >
        <span className="flex h-5 w-5 shrink-0 items-center justify-center">{item.icon}</span>
        {!collapsed && <span className="truncate">{item.label}</span>}
      </Link>
    );
  }

  function sessionList() {
    const empty = matchedTerms.length === 0;
    if (empty) return <p className="px-2.5 text-[12.5px] text-ink-faint">{t("search_none")}</p>;
    return (
      <ul className="flex flex-col gap-0.5">
        {matchedTerms.map((item) => (
          <li key={item.at}>
            <Link
              to="/dialogue"
              search={(prev) => ({ ...prev, term: item.term })}
              onClick={() => setDrawerOpen(false)}
              className="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] text-ink-soft hover:bg-paper-deep hover:text-ink"
            >
              <Search size={14} strokeWidth={1.6} className="shrink-0" />
              <span className="min-w-0 flex-1 truncate">{item.term}</span>
              <span className="shrink-0 text-[11px] text-ink-faint">
                {new Date(item.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    );
  }

  function footerCluster(collapsed: boolean) {
    return (
      <div
        className={cn("flex items-center justify-between gap-2 border-t border-line/60 p-3", collapsed && "flex-col")}
      >
        {me.data ? (
          collapsed ? (
            <button
              type="button"
              onClick={() => logout.mutate()}
              title={`${me.data.name} · ${t("account_logout")}`}
              aria-label={`${me.data.name} · ${t("account_logout")}`}
              className="flex h-9 w-9 items-center justify-center"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-ember-wash font-serif text-[13px] text-ember">
                {me.data.name.slice(0, 1)}
              </span>
            </button>
          ) : (
            <div className="flex min-w-0 items-center gap-2">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ember-wash font-serif text-[13px] text-ember">
                {me.data.name.slice(0, 1)}
              </span>
              <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{me.data.name}</span>
              <button
                type="button"
                onClick={() => logout.mutate()}
                className="shrink-0 rounded-lg px-2 py-1 text-[12px] text-ink-faint hover:bg-paper-deep hover:text-ink"
              >
                {t("account_logout")}
              </button>
            </div>
          )
        ) : collapsed ? (
          <Link to="/login" aria-label={t("login_title")} title={t("login_title")} className={SLOTS_COLLAPSED_ROW}>
            <User size={18} strokeWidth={1.6} />
          </Link>
        ) : (
          <Link to="/login" onClick={() => setDrawerOpen(false)} className={DRAWER_ROW}>
            <User size={17} strokeWidth={1.6} />
            <span>{t("login_title")}</span>
          </Link>
        )}

        <div className={cn("flex items-center gap-1", collapsed && "flex-col")}>
          <div className="relative">
            <button
              type="button"
              onClick={() => setLocaleOpen((v) => !v)}
              aria-label={t("settings_lang")}
              title={`${t("settings_lang")} · ${locale.toUpperCase()}`}
              className={cn(
                collapsed ? SLOTS_COLLAPSED_ROW : DRAWER_ROW,
                "w-9 justify-center",
                localeOpen && ROW_ACTIVE,
              )}
            >
              <Globe size={17} strokeWidth={1.6} />
            </button>
            {localeOpen && (
              <div
                role="listbox"
                className="absolute bottom-11 left-0 z-50 flex flex-col rounded-xl border border-line bg-card p-1 shadow-sm"
              >
                {locales.map((l: Locale) => (
                  <button
                    key={l}
                    type="button"
                    role="option"
                    aria-selected={l === locale}
                    onClick={() => {
                      setLocale(l);
                      setLocaleOpen(false);
                    }}
                    className={cn(
                      "rounded-lg px-4 py-1.5 text-left text-[13px]",
                      l === locale ? "bg-paper-deep font-medium text-ink" : "text-ink-soft",
                    )}
                  >
                    {l === "zh-TW" ? "繁體中文" : l === "en" ? "English" : "Español"}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={t("theme_toggle")}
            title={t("theme_toggle")}
            className={cn(collapsed ? SLOTS_COLLAPSED_ROW : DRAWER_ROW, "w-9 justify-center")}
          >
            {theme === "dark" ? <Sun size={17} strokeWidth={1.6} /> : <Moon size={17} strokeWidth={1.6} />}
          </button>
        </div>
      </div>
    );
  }

  function searchBox(expand: boolean) {
    if (!expand) {
      return (
        <button
          type="button"
          aria-label={t("nav_search")}
          title={t("nav_search")}
          onClick={() => {
            setExpanded(true);
            setDrawerOpen(false);
          }}
          className={SLOTS_COLLAPSED_ROW}
        >
          <Search size={18} strokeWidth={1.6} />
        </button>
      );
    }
    return (
      <div className="relative px-3">
        <Search size={15} strokeWidth={1.6} className="absolute top-1/2 left-5.5 -translate-y-1/2 text-ink-faint" />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t("search_placeholder")}
          className="h-9 w-full rounded-xl border border-line bg-card pr-8 pl-9 text-[13px] text-ink placeholder:text-ink-faint focus:border-ember focus:outline-none"
        />
        {search && (
          <button
            type="button"
            aria-label={t("common_clear")}
            onClick={() => setSearch("")}
            className="absolute top-1/2 right-5 -translate-y-1/2 text-ink-faint hover:text-ink"
          >
            <svg
              viewBox="0 0 14 14"
              className="h-3.5 w-3.5 fill-none stroke-current stroke-[1.6]"
              strokeLinecap="round"
              aria-hidden
            >
              <path d="m3 3 8 8M11 3l-8 8" />
            </svg>
          </button>
        )}
      </div>
    );
  }

  function drawerBody() {
    return (
      <>
        <div className="flex items-center gap-2 px-3 pt-3 pb-2">
          <Link to="/" className="flex h-9 items-center gap-2">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink font-serif text-[15px] font-semibold text-paper">
              詰
            </span>
            <span className="font-serif text-[15px] font-semibold text-ink">{t("app_name")}</span>
          </Link>
          <button
            type="button"
            aria-label={t("menu_open")}
            onClick={() => setExpanded(false)}
            className="ml-auto flex h-9 w-9 items-center justify-center rounded-xl text-ink-faint hover:bg-paper-deep hover:text-ink"
          >
            <PanelLeft size={18} strokeWidth={1.6} />
          </button>
        </div>

        <nav className="flex flex-col gap-0.5 px-3">{actions.map((item) => navLink(item, false))}</nav>

        <div className="mt-4 flex min-h-0 flex-1 flex-col">
          <div className="px-3 pb-2">{searchBox(true)}</div>
          <div className="min-h-0 flex-1 overflow-y-auto px-3">{sessionList()}</div>
        </div>

        {footerCluster(false)}
      </>
    );
  }

  function railCollapsed() {
    return (
      <>
        <button
          type="button"
          aria-label={t("menu_open")}
          title={t("menu_open")}
          onClick={() => setExpanded(true)}
          className={cn(SLOTS_COLLAPSED_ROW, "text-ink-faint")}
        >
          <PanelLeft size={18} strokeWidth={1.6} />
        </button>

        <Link
          to="/"
          aria-label={t("app_name")}
          title={t("app_name")}
          className="mt-2 flex h-9 w-9 items-center justify-center"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-ink font-serif text-[15px] font-semibold text-paper">
            詰
          </span>
        </Link>

        <nav className="mt-4 flex flex-col items-center gap-1">{actions.map((item) => navLink(item, true))}</nav>

        <div className="mt-auto flex flex-col items-center gap-1 pb-4">
          <button
            type="button"
            aria-label={t("nav_search")}
            title={t("nav_search")}
            onClick={() => {
              setExpanded(true);
              setDrawerOpen(false);
            }}
            className={SLOTS_COLLAPSED_ROW}
          >
            <Search size={18} strokeWidth={1.6} />
          </button>

          {footerCluster(true)}
        </div>
      </>
    );
  }

  return (
    <div className="flex min-h-dvh bg-paper">
      <aside
        className={cn(
          "sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-line/60 bg-paper transition-[width] duration-200 md:flex",
          expanded ? "w-72" : "w-16 items-center py-3",
        )}
      >
        {expanded ? drawerBody() : railCollapsed()}
      </aside>

      <button
        type="button"
        aria-label={t("menu_open")}
        onClick={() => setDrawerOpen(true)}
        className="fixed left-3 top-3 z-40 flex h-9 w-9 items-center justify-center rounded-xl border border-line bg-card/90 text-ink-soft backdrop-blur md:hidden"
      >
        <PanelLeft size={18} strokeWidth={1.6} />
      </button>

      {drawerOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-ink/40 backdrop-blur-sm" onClick={() => setDrawerOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-72 flex-col border-r border-line bg-paper">
            <div className="flex min-h-0 flex-1 flex-col">{drawerBody()}</div>
          </aside>
        </div>
      )}

      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
