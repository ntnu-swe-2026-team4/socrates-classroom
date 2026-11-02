import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium", {
  variants: {
    tone: {
      neutral: "bg-bg-3 text-ink-dim",
      bronze: "bg-bronze-soft text-bronze",
      olive: "bg-olive-soft text-olive",
      wine: "bg-wine-soft text-wine",
    },
  },
  defaultVariants: { tone: "neutral" },
});

export function Badge({ className, tone, ...p }: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...p} />;
}
