import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Button, Input } from "@/components/ui";
import { useT } from "@/i18n";

export const Route = createFileRoute("/join")({
  validateSearch: (search: Record<string, unknown>): { draft?: string } => ({
    draft: typeof search.draft === "string" ? search.draft : undefined,
  }),
  component: JoinEntry,
});

function JoinEntry() {
  const { draft } = Route.useSearch();
  const t = useT();
  const navigate = useNavigate();
  const [code, setCode] = useState("");

  function go() {
    const trimmed = code.trim();
    if (!trimmed) return;
    void navigate({ to: "/join/$code", params: { code: trimmed }, ...(draft ? { search: { draft } } : {}) });
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6">
      <div className="w-full max-w-sm">
        <label htmlFor="join-code" className="mb-2 block text-[13px] font-medium text-ink-soft">
          {t("join_code_label")}
        </label>
        <div className="flex gap-2">
          <Input
            id="join-code"
            value={code}
            placeholder={t("join_code_placeholder")}
            onChange={(event) => setCode(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || event.keyCode === 229) return;
              if (event.key === "Enter") go();
            }}
            autoCapitalize="characters"
            autoCorrect="off"
            className="font-mono uppercase"
          />
          <Button onClick={go} disabled={!code.trim()}>
            {t("join_code_go")}
          </Button>
        </div>
      </div>
    </div>
  );
}
