import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-bronze/50",
  {
    variants: {
      variant: {
        default: "bg-bronze text-[#221a0c] font-semibold hover:brightness-110",
        outline: "border border-line-strong bg-bg-2 text-ink-dim hover:text-ink hover:border-bronze-dim",
        ghost: "text-ink-dim hover:bg-bg-2 hover:text-ink",
        danger: "text-wine hover:bg-wine-soft",
      },
      size: { default: "h-9 px-4", sm: "h-8 px-3 text-xs", icon: "size-9" },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps extends React.ComponentProps<"button">, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({ className, variant, size, asChild, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
