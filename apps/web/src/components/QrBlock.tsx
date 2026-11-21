import { useQuery } from "@tanstack/react-query";
import { qrOptions } from "@/api/queries";
import { useT } from "@/i18n";

export const absoluteUrl = (url: string) => (url.startsWith("/") ? `${window.location.origin}${url}` : url);

export function QrBlock({ url: rawUrl, size = 192 }: { url: string; size?: number }) {
  const t = useT();
  const url = absoluteUrl(rawUrl);
  const { data: dataUrl } = useQuery(qrOptions(url, size));
  const box = { width: size, height: size };
  if (!dataUrl) return <div style={box} className="rounded-xl bg-paper-deep" />;
  return (
    <img src={dataUrl} alt={t("qr_alt")} style={box} className="rounded-xl bg-white p-2 ring-1 ring-line-strong" />
  );
}
