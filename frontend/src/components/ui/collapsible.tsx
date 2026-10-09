import { useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/** 可以收合的區塊：標題列點一下展開 / 收起；次要資訊放這裡，把版面留給主要內容 */
export function Collapsible({ title, hint, defaultOpen = false, action, className, children }: {
  title: string; hint?: ReactNode; defaultOpen?: boolean; action?: ReactNode; className?: string; children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={cn("border-b border-line last:border-b-0", className)}>
      <div className="flex items-center gap-2 py-2.5">
        <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left text-[13px] text-ink-dim hover:text-ink">
          <ChevronRight className={cn("size-4 shrink-0 text-ink-faint transition-transform", open && "rotate-90")} />
          <span className="font-medium">{title}</span>
          {hint != null && <span className="text-[11.5px] text-ink-faint">{hint}</span>}
        </button>
        {open && action}
      </div>
      {open && <div className="pb-4 pl-5.5">{children}</div>}
    </section>
  );
}
