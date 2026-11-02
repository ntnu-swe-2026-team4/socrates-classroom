import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n";

/** 從右邊拉出的抽屜：沿用 Dialog 的開關與焦點處理，只是換成貼右邊的面板 */
export const Sheet = DialogPrimitive.Root;

export function SheetContent({ className, children, ...props }: React.ComponentProps<typeof DialogPrimitive.Content>) {
  const t = useT();
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="sheet-overlay fixed inset-0 z-50 bg-black/45" />
      <DialogPrimitive.Content
        className={cn(
          "sheet fixed inset-y-0 right-0 z-50 flex h-full w-[92vw] max-w-md flex-col overflow-y-auto border-l border-line-strong bg-bg-1 p-6 text-ink shadow-2xl",
          className,
        )}
        {...props}
      >
        <DialogPrimitive.Close aria-label={t("關閉")} className="absolute right-4 top-4 flex size-8 cursor-pointer items-center justify-center rounded-full text-ink-faint hover:bg-bg-2 hover:text-ink">
          <X className="size-4" />
        </DialogPrimitive.Close>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
export { DialogTitle as SheetTitle, DialogDescription as SheetDescription } from "./dialog";
