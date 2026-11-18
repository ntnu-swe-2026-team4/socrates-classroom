import { createContext, useContext, useState, type ReactNode } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { cn } from "@/components/ui";
import { usePersistentFlag } from "@/hooks/usePersistentFlag";
import { useMediaQuery } from "@/hooks/useSubscription";
import { useT } from "@/i18n";

const MOBILE_QUERY = "(max-width: 767px)";

const SidebarContext = createContext<{
  open: boolean;
  toggle: () => void;
  overlay: boolean;
} | null>(null);

function useIsMobile(): boolean {
  return useMediaQuery(MOBILE_QUERY);
}

export function ChatLayout({ sidebar, children }: { sidebar?: ReactNode; children: ReactNode }) {
  const t = useT();
  const mobile = useIsMobile();
  const [desktopOpen, setDesktopOpen] = usePersistentFlag("chat_sidebar_open", true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [prevMobile, setPrevMobile] = useState(mobile);
  if (mobile !== prevMobile) {
    setPrevMobile(mobile);
    setMobileOpen(false);
  }
  const open = mobile ? mobileOpen : desktopOpen;
  const toggle = () => (mobile ? setMobileOpen((value) => !value) : setDesktopOpen(!desktopOpen));

  if (!sidebar) return <div className="flex h-full min-h-0 flex-col">{children}</div>;

  return (
    <SidebarContext.Provider value={{ open, toggle, overlay: mobile && open }}>
      <div className="flex h-full min-h-0">
        {open && mobile && (
          <button
            type="button"
            aria-label={t("panel_collapse")}
            onClick={toggle}
            className="anim-fade fixed inset-0 z-40 cursor-default bg-black/40"
          />
        )}
        <aside
          aria-label={t("chat_sidebar")}
          inert={!open}
          className={cn(
            "flex shrink-0 flex-col border-line bg-card",
            mobile
              ? cn("fixed inset-y-0 left-0 z-40 w-[82%] max-w-[300px] border-r", !open && "hidden")
              : open
                ? "w-[264px] border-r"
                : "hidden",
          )}
          onClickCapture={(event) => {
            if (mobile && (event.target as HTMLElement).closest("a")) setMobileOpen(false);
          }}
        >
          {sidebar}
        </aside>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
      </div>
    </SidebarContext.Provider>
  );
}

export function useSidebarOverlay(): boolean {
  return useContext(SidebarContext)?.overlay ?? false;
}

export function SidebarToggle({ className }: { className?: string }) {
  const t = useT();
  const context = useContext(SidebarContext);
  if (!context) return null;
  const label = context.open ? t("panel_collapse") : t("panel_expand");
  const Icon = context.open ? PanelLeftClose : PanelLeftOpen;
  return (
    <button
      type="button"
      onClick={context.toggle}
      aria-label={label}
      aria-expanded={context.open}
      title={label}
      className={cn(
        "flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-ink-soft transition-colors hover:bg-paper-deep hover:text-ink",
        className,
      )}
    >
      <Icon className="size-[17px]" />
    </button>
  );
}

export function SidebarHeader({
  title,
  actions,
  className,
}: {
  title: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex h-14 shrink-0 items-center gap-1 border-b border-line pr-2 pl-3", className)}>
      <h2 className="min-w-0 flex-1 truncate text-[14px] font-medium text-ink">{title}</h2>
      {actions}
      <SidebarToggle />
    </div>
  );
}

export function SidebarItem({
  active,
  title,
  meta,
  children,
}: {
  active?: boolean;
  title: ReactNode;
  meta?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "group flex items-center gap-1 border-l-2 pr-1 transition-colors",
        active ? "border-ember bg-ember-wash text-ink" : "border-transparent text-ink-soft hover:bg-paper-deep",
      )}
    >
      <div className="min-w-0 flex-1 py-2 pl-2.5">
        <div className="truncate text-[13.5px]">{title}</div>
        {meta && <div className="truncate text-[11.5px] text-ink-faint">{meta}</div>}
      </div>
      {children}
    </div>
  );
}
