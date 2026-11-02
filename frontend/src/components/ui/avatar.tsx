import { tr } from "@/i18n";
import { cn } from "@/lib/utils";

/** 使用者頭像：有圖片就顯示圖片，沒有就是黑底白字的姓名首字 */
export function Avatar({ name, src, className }: { name?: string; src?: string | null; className?: string }) {
  return (
    <span className={cn("relative inline-flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-black font-serif text-[15px] text-white ring-1 ring-line-strong", className)} aria-hidden="true">
      {src ? <img src={src} alt="" className="size-full object-cover" draggable={false} /> : (name?.trim()[0] ?? "?")}
    </span>
  );
}

/** 把使用者選的圖片置中裁成正方形、縮成 256×256，回傳 data URL（頭像不需要更大，也避免上傳過大的檔案） */
export async function imageToAvatar(file: File, size = 256): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error(tr("請選擇圖片檔（JPG、PNG、WebP…）"));
  if (file.size > 10 * 1024 * 1024) throw new Error(tr("圖片太大（上限 10 MB）"));
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error(tr("無法讀取這張圖片")));
      i.src = url;
    });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error(tr("無法處理圖片"));
    ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size);
    return canvas.toDataURL("image/jpeg", 0.88);
  } finally {
    URL.revokeObjectURL(url);
  }
}
