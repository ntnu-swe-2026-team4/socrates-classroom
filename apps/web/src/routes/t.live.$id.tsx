import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "@/api";
import { BackLink, Button, Card, PageHeader, Spinner } from "@/components/ui";
import { useT } from "@/i18n";

export const Route = createFileRoute("/t/live/$id")({
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.fetchQuery({ queryKey: ["me"], queryFn: () => api.me(), staleTime: Infinity });
    if (!me || me.guest) throw redirect({ to: "/classrooms" });
  },
  component: LivePage,
});

function LivePage() {
  const t = useT();
  const navigate = useNavigate();
  const { id } = Route.useParams();
  const finish = useMutation({
    mutationFn: () => api.finishActivity(id),
  });

  const info = useQuery({ queryKey: ["activity", id], queryFn: () => api.activityInfo(id), staleTime: Infinity });
  const backToRoom = () =>
    info.data?.classroomId
      ? void navigate({ to: "/classrooms/$classroomId", params: { classroomId: info.data.classroomId } })
      : void navigate({ to: "/classrooms", search: { view: "teacher" } });

  async function finishAndReport() {
    if (finish.isPending) return;
    try {
      await finish.mutateAsync();
    } catch {
      return;
    }
    await navigate({ to: "/report/$id", params: { id } });
  }

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        eyebrow={<BackLink onClick={backToRoom} label={t("classroom_back_to_room")} />}
        title={t("live_title")}
        actions={
          <Button variant="outline" size="sm" onClick={() => void finishAndReport()} disabled={finish.isPending}>
            {finish.isPending ? <Spinner /> : null}
            {t("live_finish")}
          </Button>
        }
      />

      <div className="mx-auto w-full max-w-5xl px-6 py-6">
        {finish.isError && (
          <p role="alert" className="mx-auto mb-4 w-full max-w-5xl text-[13px] text-flag">
            {t("common_error")}
          </p>
        )}
        <Card className="flex flex-col items-center gap-3 p-10 text-center">
          <p className="font-serif text-[15.5px] text-ink">{t("live_pending_title")}</p>
          <p className="max-w-md text-[12.5px] leading-relaxed text-ink-faint">{t("live_pending_body")}</p>
        </Card>
      </div>
    </div>
  );
}
