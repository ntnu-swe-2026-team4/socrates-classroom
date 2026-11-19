import { useEffect, useId, useRef } from "react";
import { focusNextIn, focusRestoreOnUnmount } from "@/lib/focus";

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const titleId = useId();
  const messageId = useId();
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const restore = focusRestoreOnUnmount();
    cancelRef.current?.focus();
    return restore;
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4" onClick={onCancel}>
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            onCancel();
          }
          if (event.key === "Tab") {
            event.preventDefault();
            if (dialogRef.current) focusNextIn(dialogRef.current);
          }
        }}
        className="flex w-full max-w-sm flex-col gap-3 rounded-2xl border border-line bg-card p-5 shadow-lg"
      >
        <h3 id={titleId} className="font-serif text-[16px] text-ink">
          {title}
        </h3>
        <p id={messageId} className="text-[13px] leading-relaxed text-ink-soft">
          {message}
        </p>
        <div className="mt-1 flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="cursor-pointer rounded-full border border-line-strong px-4 py-2 text-[13px] font-medium text-ink-soft transition-colors hover:text-ink"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="cursor-pointer rounded-full bg-flag px-4 py-2 text-[13px] font-semibold text-paper transition-[filter] hover:brightness-110"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
