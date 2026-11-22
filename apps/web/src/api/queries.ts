import { queryOptions } from "@tanstack/react-query";
import QRCode from "qrcode";
import { api, ApiError } from "@/api";
import { readTermHistory } from "./local";

export const classroomsOptions = queryOptions({
  queryKey: ["classrooms"],
  queryFn: () => api.listClassrooms(),
});

export const topicsOptions = queryOptions({
  queryKey: ["topics"],
  queryFn: () => api.listTopics(),
  staleTime: Infinity,
});

export function classroomTopicsOptions(classroomId: string | null) {
  return queryOptions({
    queryKey: ["classroomTopics", classroomId],
    queryFn: () => api.listClassroomTopics(classroomId as string),
    enabled: classroomId !== null,
  });
}

export function activityOptions(activityId: string, participantId?: string) {
  return queryOptions({
    queryKey: ["activity", activityId, participantId ?? null],
    queryFn: () => api.activityInfo(activityId, participantId),
    staleTime: Infinity,
  });
}

export function teacherActivityOptions(activityId: string) {
  return queryOptions({
    queryKey: ["activity", activityId, "teacher"],
    queryFn: () => api.activityInfo(activityId),
  });
}

export function activitySlotsOptions(activityId: string) {
  return queryOptions({
    queryKey: ["activity-slots", activityId],
    queryFn: () => api.listActivitySlots(activityId),
  });
}

export function soloThreadsOptions(userId: string) {
  return queryOptions({
    queryKey: ["soloThreads", userId],
    queryFn: () => api.listSoloThreads(),
  });
}

export function soloThreadOptions(userId: string, id: string) {
  return queryOptions({
    queryKey: [...soloThreadsOptions(userId).queryKey, id],
    queryFn: () => api.getSoloThread(id),
    retry: (failureCount, error) => failureCount < 1 && !(error instanceof ApiError && error.code === "not_found"),
  });
}

export function reportOptions(id: string) {
  return queryOptions({
    queryKey: ["report", id],
    queryFn: () => api.report(id),
    retry: (failureCount, error) => error instanceof ApiError && error.code === "report_pending" && failureCount < 30,
    retryDelay: 4000,
  });
}

export function joinOptions(code: string) {
  return queryOptions({
    queryKey: ["join", code],
    queryFn: () => api.joinByCode(code),
  });
}

export function inviteOptions(token: string) {
  return queryOptions({
    queryKey: ["invite", token],
    queryFn: () => api.inviteInfo(token),
    retry: false,
  });
}

export const teacherKeysOptions = queryOptions({
  queryKey: ["teacherKeys"],
  queryFn: () => api.listTeacherKeys(),
});

export const keyProvidersOptions = queryOptions({
  queryKey: ["keyProviders"],
  queryFn: () => api.listKeyProviders(),
  staleTime: Infinity,
});

export function keyProviderModelsOptions(provider: string) {
  return queryOptions({
    queryKey: ["keyProviderModels", provider],
    queryFn: () => api.listKeyProviderModels(provider),
    staleTime: Infinity,
  });
}

export const adminUsersOptions = queryOptions({
  queryKey: ["admin-users"],
  queryFn: () => api.listAdminUsers(),
});

export const authProvidersOptions = queryOptions({
  queryKey: ["authProviders"],
  queryFn: () => api.authProviders(),
  staleTime: Infinity,
});

export const notificationsOptions = queryOptions({
  queryKey: ["notifications"],
  queryFn: () => api.notifications(),
});

export function accountNotificationsOptions(userId: string) {
  return queryOptions({
    ...notificationsOptions,
    queryKey: [...notificationsOptions.queryKey, userId],
    refetchInterval: 5 * 60 * 1000,
  });
}

export const devAccountsOptions = queryOptions({
  queryKey: ["dev-accounts"],
  queryFn: () => api.devAccounts(),
  retry: false,
  staleTime: Infinity,
});

export const termHistoryOptions = queryOptions({
  queryKey: ["termHistory"],
  queryFn: () => readTermHistory(),
});

export function qrOptions(url: string, size: number) {
  return queryOptions({
    queryKey: ["qr", url, size],
    queryFn: () =>
      QRCode.toDataURL(url, {
        margin: 1,
        width: size,
        color: { dark: "#17181c", light: "#ffffff" },
      }),
    staleTime: Infinity,
  });
}
