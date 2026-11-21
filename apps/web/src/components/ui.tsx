import type React from "react";
import { useId } from "react";
import { createPortal } from "react-dom";
import { cva } from "class-variance-authority";
import { clsx } from "clsx";
import { ArrowLeft } from "lucide-react";
import { twMerge } from "tailwind-merge";
import { useI18n } from "@/i18n";

export function cn(...inputs: Parameters<typeof clsx>) {
  return twMerge(clsx(inputs));
}

export const buttonStyles = cva(
  "inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ember/50 disabled:pointer-events-none disabled:opacity-50 select-none",
  {
    variants: {
      variant: {
        primary: "btn-primary bg-ink font-semibold text-paper hover:bg-ember hover:text-on-ember",
        outline:
          "btn-outline border border-line-strong bg-paper-deep text-ink-soft hover:border-ember-deep hover:text-ink",
        ghost: "text-ink-soft hover:bg-paper-deep hover:text-ink",
      },
      size: {
        md: "h-9 px-4 text-sm",
        sm: "h-8 px-3 text-xs",
        lg: "h-11 px-6 text-[15px]",
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
        "h-9 w-full rounded-lg border border-line-strong bg-paper px-3 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-ink disabled:opacity-60",
        className,
      )}
      {...props}
    />
  );
}

export function Backdrop({ onClick, className }: { onClick: () => void; className?: string }) {
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: pointer-only by design — the keyboard path is the dialog's Escape handling and cancel button
    // biome-ignore lint/a11y/noStaticElementInteractions: pointer-only by design — the keyboard path is the dialog's Escape handling and cancel button
    <div className={className} onClick={onClick} />
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: children always contain the form control — the wrapping label is the WCAG-preferred implicit association
    <label className="flex flex-col gap-1">
      <span className="text-xs text-ink-soft">{label}</span>
      {children}
    </label>
  );
}

export function HalftoneFade({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-0 bg-[radial-gradient(var(--color-ink)_1.2px,transparent_1.6px)] bg-size-[11px_11px] opacity-45 [mask-image:linear-gradient(to_left,black,transparent_62%)]",
        className,
      )}
    />
  );
}

export function Card({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("rounded-xl border border-line bg-paper shadow-sm", className)} {...props} />;
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
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-line-strong bg-paper-deep transition-colors peer-checked:border-ink peer-checked:bg-ink peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ember peer-checked:[&>svg]:opacity-100">
        <svg
          aria-hidden
          viewBox="0 0 16 16"
          className="h-3.5 w-3.5 fill-none stroke-paper stroke-[2.5] opacity-0 transition-opacity"
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
      className="inline-flex gap-0.5 rounded-lg border border-line-strong bg-card p-0.5"
    >
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          role="tab"
          aria-selected={value === item.value}
          onClick={() => onChange(item.value)}
          className={cn(
            "cursor-pointer whitespace-nowrap rounded-md px-3.5 py-1.5 text-[13px] transition-colors",
            value === item.value ? "bg-ink font-semibold text-paper" : "text-ink-soft hover:text-ink",
          )}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

export function BackLink({ onClick, label, className }: { onClick: () => void; label: string; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "-ml-1.5 inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-1.5 py-1 text-[12.5px] text-ink-soft hover:bg-paper-deep hover:text-ink",
        className,
      )}
    >
      <ArrowLeft className="size-3.5" aria-hidden />
      {label}
    </button>
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
  className,
}: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  width?: string;
  className?: string;
}) {
  return (
    <header className={cn("mx-auto w-full px-4 pt-16 md:px-6 md:pt-6", width, className)}>
      {eyebrow && <div className="mb-1 text-[12.5px] text-ink-faint">{eyebrow}</div>}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
        <div className="min-w-0 sm:flex-1">
          <h1 className="text-[22px] leading-tight font-semibold tracking-tight text-ink md:text-[26px]">{title}</h1>
          {description && <p className="mt-1 max-w-[62ch] text-sm leading-relaxed text-ink-soft">{description}</p>}
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
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line pr-3 pl-16 md:pl-4">
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
    <h2 className="mb-2 flex items-center gap-2 font-serif text-[15px] text-ink">
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
        "inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-ink font-serif text-sm text-paper",
        className,
      )}
    >
      {name?.slice(0, 1) ?? ""}
    </span>
  );
}

const FOCUSABLE_SELECTOR =
  "a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])";

const inertCounts = new Map<Element, number>();

export function trapDialogFocus(node: HTMLElement | null): (() => void) | undefined {
  if (!node) return;
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const focusables = () =>
    Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
      (element) => element.getClientRects().length > 0 || element === document.activeElement,
    );
  focusables()[0]?.focus();
  const inerted: Element[] = [];
  for (const child of document.body.children) {
    if (child.contains(node)) continue;
    const held = inertCounts.get(child) ?? 0;
    inertCounts.set(child, held + 1);
    child.setAttribute("inert", "");
    inerted.push(child);
  }
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Tab") return;
    const items = focusables();
    if (items.length === 0) return;
    event.preventDefault();
    const index = items.indexOf(document.activeElement as HTMLElement);
    const next = event.shiftKey ? items[(index <= 0 ? items.length : index) - 1] : items[(index + 1) % items.length];
    next?.focus();
  };
  node.addEventListener("keydown", onKeyDown);
  return () => {
    node.removeEventListener("keydown", onKeyDown);
    for (const child of inerted) {
      const held = (inertCounts.get(child) ?? 0) - 1;
      if (held > 0) inertCounts.set(child, held);
      else {
        inertCounts.delete(child);
        child.removeAttribute("inert");
      }
    }
    previous?.focus();
  };
}

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel,
  danger = false,
  extra,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body?: React.ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  danger?: boolean;
  extra?: React.ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const confirmTitleId = useId();
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <Backdrop className="anim-fade absolute inset-0 bg-black/40" onClick={onCancel} />
      <div
        ref={trapDialogFocus}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={confirmTitleId}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            onCancel();
          }
        }}
        className="anim-rise relative w-full max-w-sm rounded-2xl border border-line bg-paper p-5 shadow-xl"
      >
        <h2 id={confirmTitleId} className="font-serif text-[17px] text-ink">
          {title}
        </h2>
        {body && <div className="mt-1.5 text-[13.5px] leading-relaxed text-ink-soft">{body}</div>}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>
            {cancelLabel}
          </Button>
          {extra}
          <Button
            variant={danger ? "outline" : "primary"}
            className={
              danger ? "border-flag text-flag hover:border-flag hover:bg-flag-wash hover:text-flag" : undefined
            }
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function FormDialog({
  open,
  title,
  description,
  submitLabel,
  cancelLabel,
  canSubmit,
  submitting,
  onSubmit,
  onCancel,
  children,
}: {
  open: boolean;
  title: string;
  description?: React.ReactNode;
  submitLabel: string;
  cancelLabel: string;
  canSubmit: boolean;
  submitting?: boolean;
  onSubmit: () => void;
  onCancel: () => void;
  children: React.ReactNode;
}) {
  const formTitleId = useId();
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <Backdrop className="anim-fade absolute inset-0 bg-black/40" onClick={onCancel} />
      <form
        ref={trapDialogFocus}
        role="dialog"
        aria-modal="true"
        aria-labelledby={formTitleId}
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit && !submitting) onSubmit();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            onCancel();
          }
        }}
        className="anim-rise relative flex w-full max-w-md flex-col gap-4 rounded-2xl border border-line bg-paper p-5 shadow-xl"
      >
        <div>
          <h2 id={formTitleId} className="font-serif text-[17px] text-ink">
            {title}
          </h2>
          {description && <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">{description}</p>}
        </div>
        {children}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button type="submit" disabled={!canSubmit || submitting}>
            {submitting ? <Spinner /> : submitLabel}
          </Button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

export function TrapDialog({
  className,
  onClose,
  ariaLabelledBy,
  plain,
  children,
}: {
  className: string;
  onClose: () => void;
  ariaLabelledBy?: string;
  plain?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50">
      <Backdrop className={cn("absolute inset-0", !plain && "anim-fade bg-black/40")} onClick={onClose} />
      <div
        ref={trapDialogFocus}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        {...(ariaLabelledBy ? { "aria-labelledby": ariaLabelledBy } : {})}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            onClose();
          }
        }}
        className={className}
      >
        {children}
      </div>
    </div>
  );
}
