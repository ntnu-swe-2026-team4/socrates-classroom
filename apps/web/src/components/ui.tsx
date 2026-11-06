import { cva } from "class-variance-authority";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { useI18n } from "@/i18n";

export function cn(...inputs: Parameters<typeof clsx>) {
  return twMerge(clsx(inputs));
}

export const buttonStyles = cva(
  "inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-full font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ember/50 disabled:pointer-events-none disabled:opacity-50 select-none",
  {
    variants: {
      variant: {
        primary: "bg-ember font-semibold text-on-ember hover:brightness-110",
        outline: "border border-line-strong bg-paper-deep text-ink-soft hover:border-ember-deep hover:text-ink",
        ghost: "text-ink-soft hover:bg-paper-deep hover:text-ink",
      },
      size: {
        md: "h-10 px-5 text-sm",
        sm: "h-8 px-3.5 text-xs",
        lg: "h-12 px-7 text-[15px]",
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
        "h-10 w-full rounded-full border border-line-strong bg-paper-deep px-4 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-ember disabled:opacity-60",
        className,
      )}
      {...props}
    />
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="px-1 text-xs text-ink-soft">{label}</span>
      {children}
    </label>
  );
}

export function Card({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("rounded-3xl border border-line bg-card", className)} {...props} />;
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
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-line-strong bg-paper-deep transition-colors peer-checked:border-ember peer-checked:bg-ember peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ember">
        <svg
          aria-hidden
          viewBox="0 0 16 16"
          className="h-3.5 w-3.5 fill-none stroke-on-ember stroke-[2.5]"
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
    <div
      role="tablist"
      aria-label={label}
      className="inline-flex gap-0.5 rounded-full border border-line-strong bg-card p-0.5"
    >
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          role="tab"
          aria-selected={value === item.value}
          onClick={() => onChange(item.value)}
          className={cn(
            "cursor-pointer whitespace-nowrap rounded-full px-4 py-1.5 text-[13px] transition-colors",
            value === item.value ? "bg-ember font-semibold text-on-ember" : "text-ink-soft hover:text-ink",
          )}
        >
          {item.label}
        </button>
      ))}
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

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  width = "max-w-5xl",
}: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  width?: string;
}) {
  return (
    <header className={cn("mx-auto w-full px-6 pt-20 pb-1 md:pt-10", width)}>
      {eyebrow && <div className="mb-2 text-[13px] text-ink-faint">{eyebrow}</div>}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
        <div className="min-w-0 sm:flex-1">
          <h1 className="font-serif text-[26px] leading-tight text-ink md:text-[30px]">{title}</h1>
          {description && <p className="mt-2 max-w-[62ch] text-sm leading-relaxed text-ink-soft">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2 sm:shrink-0">{actions}</div>}
      </div>
    </header>
  );
}

export function TopBar({
  eyebrow,
  title,
  actions,
}: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="flex h-[88px] shrink-0 items-center gap-2 border-b border-line pr-4 pl-16 md:h-14 md:pl-6">
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-[15px] font-medium text-ink">{title}</h1>
        {eyebrow && <p className="truncate text-[11.5px] text-ink-faint">{eyebrow}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
    </header>
  );
}

export function SectionTitle({ step, children }: { step?: number; children: React.ReactNode }) {
  return (
    <h2 className="mb-3 flex items-center gap-2.5 font-serif text-[15.5px] text-ink">
      {step !== undefined && (
        <span className="flex size-6 items-center justify-center rounded-full bg-ember-wash font-sans text-[11.5px] font-semibold text-ember">
          {step}
        </span>
      )}
      {children}
    </h2>
  );
}

export function Initial({ name, className }: { name?: string | null; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-black font-serif text-sm text-white ring-1 ring-line-strong",
        className,
      )}
    >
      {name?.slice(0, 1) ?? ""}
    </span>
  );
}
