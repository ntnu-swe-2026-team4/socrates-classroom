import { useState } from "react";
import { cva } from "class-variance-authority";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { locales, setLocale, useI18n, type Locale } from "@/i18n";

export function cn(...inputs: Parameters<typeof clsx>) {
  return twMerge(clsx(inputs));
}

export const buttonStyles = cva(
  "inline-flex items-center justify-center gap-2 rounded-full font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember disabled:pointer-events-none disabled:opacity-45 select-none",
  {
    variants: {
      variant: {
        primary: "bg-ember text-paper hover:bg-ember-deep",
        outline: "border border-line bg-card text-ink hover:border-ink-faint hover:bg-paper-deep",
        ghost: "text-ink-soft hover:bg-paper-deep hover:text-ink",
      },
      size: {
        md: "h-11 px-6 text-[15px]",
        sm: "h-8 px-4 text-[13px]",
        lg: "h-13 px-8 text-base",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export function Button({
  variant,
  size,
  className,
  type,
  ...props
}: React.ComponentProps<"button"> & { variant?: "primary" | "outline" | "ghost"; size?: "sm" | "md" | "lg" }) {
  return <button type={type ?? "button"} className={cn(buttonStyles({ variant, size }), className)} {...props} />;
}

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "h-11 w-full rounded-xl border border-line bg-card px-4 text-[15px] text-ink placeholder:text-ink-faint focus:border-ember focus:outline-none",
        className,
      )}
      {...props}
    />
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[13px] font-medium text-ink-soft">{label}</span>
      {children}
    </label>
  );
}

export function Card({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("rounded-2xl border border-line bg-card", className)} {...props} />;
}

export function Checkbox({
  label,
  checked,
  onCheckedChange,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 text-left">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onCheckedChange(event.target.checked)}
        className="peer sr-only"
      />
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-line bg-card transition-colors peer-checked:border-ember peer-checked:bg-ember peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ember">
        <svg
          aria-hidden
          viewBox="0 0 16 16"
          className="h-3.5 w-3.5 fill-none stroke-paper stroke-[2.5]"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3 8.5 6.5 12 13 4.5" />
        </svg>
      </span>
      <span className="text-[13.5px] leading-relaxed text-ink-soft">{label}</span>
    </label>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  items,
  label,
}: {
  value: T;
  onChange: (value: T) => void;
  items: { value: T; label: string }[];
  label: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="flex gap-1 rounded-full border border-line bg-paper-deep p-1">
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          role="tab"
          aria-selected={value === item.value}
          onClick={() => onChange(item.value)}
          className={cn(
            "rounded-full px-4 py-1.5 text-[13px] font-medium transition-colors",
            value === item.value ? "bg-card text-ink shadow-sm" : "text-ink-soft hover:text-ink",
          )}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

export function LocaleSwitch({ className }: { className?: string }) {
  const { locale } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <div className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-8 items-center rounded-full border border-line bg-card px-3 font-mono text-[12px] font-medium text-ink-soft"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {locale.toUpperCase()}
      </button>
      {open && (
        <div
          role="listbox"
          className="absolute right-0 top-10 z-50 flex flex-col rounded-xl border border-line bg-card p-1 shadow-sm"
        >
          {locales.map((l: Locale) => (
            <button
              key={l}
              type="button"
              role="option"
              aria-selected={l === locale}
              onClick={() => {
                setLocale(l);
                setOpen(false);
              }}
              className={cn(
                "rounded-lg px-4 py-1.5 text-left text-[13px]",
                l === locale ? "bg-paper-deep font-medium text-ink" : "text-ink-soft",
              )}
            >
              {l === "zh" ? "繁體中文" : l === "en" ? "English" : "Español"}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Wordmark({ sub }: { sub?: boolean }) {
  const { t } = useI18n();
  return (
    <span className="font-serif leading-none">
      <span className="text-lg font-semibold tracking-wide text-ink">{t("app_name")}</span>
      {sub && <span className="ml-2 hidden text-[12.5px] text-ink-faint sm:inline">{t("app_sub")}</span>}
    </span>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cn("inline-block h-4 w-4 animate-spin rounded-full border-2 border-line border-t-ember", className)}
    />
  );
}
