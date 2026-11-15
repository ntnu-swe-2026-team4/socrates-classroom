import { Link } from "@tanstack/react-router";
import { useI18n, type MessageKey } from "@/i18n";

const TABS = [
  { to: "/admin/ops", label: "admin_tab_ops" },
  { to: "/admin/dashboard", label: "admin_tab_db" },
] as const satisfies readonly { to: string; label: MessageKey }[];

export function AdminTabs() {
  const { t } = useI18n();
  return (
    <nav
      aria-label={t("admin_tabs_label")}
      className="inline-flex gap-0.5 rounded-full border border-line-strong bg-card p-0.5"
    >
      {TABS.map((tab) => (
        <Link
          key={tab.to}
          to={tab.to}
          className="whitespace-nowrap rounded-full px-4 py-1.5 text-[13px] transition-colors"
          activeProps={{ "aria-current": "page", className: "bg-ember font-semibold text-on-ember" }}
          inactiveProps={{ className: "text-ink-soft hover:text-ink" }}
        >
          {t(tab.label)}
        </Link>
      ))}
    </nav>
  );
}
