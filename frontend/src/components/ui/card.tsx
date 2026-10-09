import * as React from "react";
import { cn } from "@/lib/utils";

export const Card = ({ className, ...p }: React.ComponentProps<"div">) => (
  <div className={cn("rounded-3xl border border-line bg-bg-1 p-5", className)} {...p} />
);
export const CardTitle = ({ className, ...p }: React.ComponentProps<"h3">) => (
  <h3 className={cn("mb-3 font-serif text-[15.5px] text-ink", className)} {...p} />
);
