import * as React from "react";
import { cn } from "@/lib/utils";

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "h-10 w-full rounded-full border border-line-strong bg-bg-2 px-4 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-bronze",
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "w-full resize-none rounded-2xl border border-line-strong bg-bg-2 px-4 py-2.5 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-bronze",
        className,
      )}
      {...props}
    />
  );
}
