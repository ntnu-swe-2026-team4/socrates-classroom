import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./index";
import type { Activity, AnnouncementInput, ArgumentSummary, BankKind, CalendarEventInput, ClassroomInput, ClassroomRole, ClassroomTopic, JoinInput, JoinPolicy, NoteInput, PostInput, TopicInput } from "./index";

/** 每個查詢的 key 集中在這裡，讓後端事件（SSE）進來時知道要讓哪些資料失效 */
export const keys = {
  me: ["me"] as const,
  archives: ["archives"] as const,
  classrooms: ["classrooms"] as const,
  classroom: (id: string) => ["classroom", id] as const,
  classroomMembers: (id: string) => ["classroomMembers", id] as const,
  activities: (cid: string) => ["activities", cid] as const,
  topics: (cid: string) => ["topics", cid] as const,
  announcements: (cid: string) => ["announcements", cid] as const,
  joinPolicy: (cid: string) => ["joinPolicy", cid] as const,
  applications: (cid: string) => ["applications", cid] as const,
  myApplications: ["myApplications"] as const,
  discover: (q: string) => ["discover", q] as const,
  posts: (cid: string, topicId: string | null) => ["posts", cid, topicId ?? "classroom"] as const,
  calendar: (cid: string, month: string) => ["calendar", cid, month] as const,
  reports: (tid: string) => ["reports", tid] as const,
  notes: (aid: string) => ["notes", aid] as const,
  topic: (id: string) => ["topic", id] as const,
  activity: (id: string) => ["activity", id] as const,
  dialogue: (id: string) => ["dialogue", id] as const,
  progress: (id: string) => ["progress", id] as const,
  positions: (id: string) => ["positions", id] as const,
  members: (id: string) => ["members", id] as const,
  groups: (id: string) => ["groups", id] as const,
  groupMessages: (gid: string) => ["groupMessages", gid] as const,
  arguments: (gid: string) => ["arguments", gid] as const,
  rooms: (id: string) => ["rooms", id] as const,
  turns: (rid: string) => ["turns", rid] as const,
  scores: (id: string) => ["scores", id] as const,
  star: (id: string) => ["star", id] as const,
};

export const useMe = () => useQuery({ queryKey: keys.me, queryFn: () => api.me(), staleTime: Infinity });
export const useArchives = () => useQuery({ queryKey: keys.archives, queryFn: () => api.listArchives() });
export const useClassrooms = () => useQuery({ queryKey: keys.classrooms, queryFn: () => api.listClassrooms() });
export const useClassroom = (id: string) => useQuery({ queryKey: keys.classroom(id), queryFn: () => api.getClassroom(id) });
export const useActivities = (cid: string) => useQuery({ queryKey: keys.activities(cid), queryFn: () => api.listActivities(cid) });
/** 每分鐘重抓一次：排程的公告到時間後，學生不用重新整理就看得到 */
export const useAnnouncements = (cid: string) => useQuery({ queryKey: keys.announcements(cid), queryFn: () => api.listAnnouncements(cid), refetchInterval: 60_000 });
export const useJoinPolicy = (cid: string) => useQuery({ queryKey: keys.joinPolicy(cid), queryFn: () => api.getJoinPolicy(cid) });
export const usePendingApplications = (cid: string) => useQuery({ queryKey: keys.applications(cid), queryFn: () => api.listApplications(cid, "pending") });
export const useMyApplications = () => useQuery({ queryKey: keys.myApplications, queryFn: () => api.listMyApplications() });
export const useDiscoverClassrooms = (q: string) => useQuery({ queryKey: keys.discover(q), queryFn: () => api.discoverClassrooms(q || undefined), placeholderData: (prev) => prev });
export const usePosts = (cid: string, topicId: string | null) => useQuery({ queryKey: keys.posts(cid, topicId), queryFn: () => api.listPosts(cid, topicId) });
/** 教室在 [from, to) 之間的行事曆事件（通常是一個月） */
export const useCalendar = (cid: string, from: Date, to: Date) =>
  useQuery({ queryKey: keys.calendar(cid, from.toISOString()), queryFn: () => api.listCalendar({ classroomId: cid, from: from.toISOString(), to: to.toISOString() }), placeholderData: (prev) => prev });
export const useReports = (tid: string, enabled = true) => useQuery({ queryKey: keys.reports(tid), queryFn: () => api.listReports(tid), enabled });
export const useNotes = (aid: string, enabled = true) => useQuery({ queryKey: keys.notes(aid), queryFn: () => api.listNotes(aid), enabled });
export const useTopics = (cid: string) => useQuery({ queryKey: keys.topics(cid), queryFn: () => api.listTopics(cid) });
export const useTopic = (id: string) => useQuery({ queryKey: keys.topic(id), queryFn: () => api.getTopic(id) });
export const useActivity = (id: string) => useQuery({ queryKey: keys.activity(id), queryFn: () => api.getActivity(id), enabled: !!id });
export const useDialogue = (id: string) => useQuery({ queryKey: keys.dialogue(id), queryFn: () => api.listDialogue(id) });
export const useProgress = (id: string) => useQuery({ queryKey: keys.progress(id), queryFn: () => api.getProgress(id) });
export const usePositions = (id: string) => useQuery({ queryKey: keys.positions(id), queryFn: () => api.listPositions(id) });

export function useUpdateArchive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; bank?: BankKind | null; inSummary?: boolean }) =>
      api.updateArchive(v.id, { bank: v.bank, inSummary: v.inSummary }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.archives }),
  });
}

export function useSaveClassroom(classroomId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ClassroomInput) => (classroomId ? api.updateClassroom(classroomId, input) : api.createClassroom(input)),
    onSuccess: (c) => {
      qc.setQueryData(keys.classroom(c.id), c);
      qc.invalidateQueries({ queryKey: keys.classrooms });
    },
  });
}

/** 辯論（API 上的 topic）變動後要更新的資料：辯論列表、單一辯論，以及連動的活動與教室統計 */
export function useInvalidateTopic(classroomId: string) {
  const qc = useQueryClient();
  return (topic?: Pick<ClassroomTopic, "id" | "activityId">) => {
    qc.invalidateQueries({ queryKey: keys.topics(classroomId) });
    qc.invalidateQueries({ queryKey: keys.activities(classroomId) });
    qc.invalidateQueries({ queryKey: keys.classrooms });
    qc.invalidateQueries({ queryKey: keys.classroom(classroomId) });
    if (topic) qc.invalidateQueries({ queryKey: keys.topic(topic.id) });
    if (topic?.activityId) qc.invalidateQueries({ queryKey: keys.activity(topic.activityId) });
  };
}

/** 新增（不帶 topicId）或編輯辯論；編輯時不能改類型 */
export function useSaveTopic(classroomId: string, topicId?: string) {
  const invalidate = useInvalidateTopic(classroomId);
  return useMutation({
    mutationFn: (input: TopicInput) => (topicId ? api.updateTopic(topicId, input) : api.createTopic(classroomId, input)),
    onSuccess: (t) => invalidate(t),
  });
}

/** 新增（不帶 announcementId）或編輯公告 */
export function useSaveAnnouncement(classroomId: string, announcementId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AnnouncementInput) => (announcementId ? api.updateAnnouncement(announcementId, input) : api.createAnnouncement(classroomId, input)),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.announcements(classroomId) }),
  });
}

export function useDeleteAnnouncement(classroomId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteAnnouncement(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.announcements(classroomId) }),
  });
}

/** 加入設定：開關與問卷用 PATCH；重新產生邀請碼另外一個動作 */
export function useUpdateJoinPolicy(classroomId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<Omit<JoinPolicy, "code">>) => api.updateJoinPolicy(classroomId, patch),
    onSuccess: (p) => qc.setQueryData(keys.joinPolicy(classroomId), p),
  });
}

export function useRegenerateJoinCode(classroomId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.regenerateJoinCode(classroomId),
    onSuccess: (p) => qc.setQueryData(keys.joinPolicy(classroomId), p),
  });
}

/** 老師審核申請；通過時成員名單與人數也要更新 */
export function useReviewApplication(classroomId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; decision: "approve" | "reject"; note?: string }) => api.reviewApplication(v.id, v.decision, v.note),
    onSuccess: () => {
      for (const k of [keys.applications(classroomId), keys.classroomMembers(classroomId), keys.classroom(classroomId), keys.classrooms]) qc.invalidateQueries({ queryKey: k });
    },
  });
}

export function useImportMembers(classroomId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (names: string[]) => api.importClassroomMembers(classroomId, names),
    onSuccess: () => {
      for (const k of [keys.classroomMembers(classroomId), keys.classroom(classroomId), keys.classrooms]) qc.invalidateQueries({ queryKey: k });
    },
  });
}

/** 學生加入教室（直接加入或送出申請）後，教室列表、探索列表、我的申請都要更新 */
export function useJoinClassroom() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { classroomId: string; input: JoinInput }) => api.joinClassroom(v.classroomId, v.input),
    onSuccess: () => {
      for (const k of [keys.classrooms, keys.myApplications, ["discover"]]) qc.invalidateQueries({ queryKey: k });
    },
  });
}

export function useCancelApplication() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.cancelApplication(id),
    onSuccess: () => {
      for (const k of [keys.myApplications, ["discover"]]) qc.invalidateQueries({ queryKey: k });
    },
  });
}

/** 發文或回覆；辯論討論區的則數也要更新 */
export function useCreatePost(classroomId: string, topicId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<PostInput, "topicId">) => api.createPost(classroomId, { ...input, topicId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.posts(classroomId, topicId) });
      if (topicId) { qc.invalidateQueries({ queryKey: keys.topic(topicId) }); qc.invalidateQueries({ queryKey: keys.topics(classroomId) }); }
    },
  });
}

export function useDeletePost(classroomId: string, topicId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deletePost(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.posts(classroomId, topicId) });
      if (topicId) { qc.invalidateQueries({ queryKey: keys.topic(topicId) }); qc.invalidateQueries({ queryKey: keys.topics(classroomId) }); }
    },
  });
}

export function useSubmitReport(topicId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { file: File; comment: string }) => api.submitReport(topicId, v.file, v.comment),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.reports(topicId) }),
  });
}

export function useDeleteReport(topicId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteReport(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.reports(topicId) }),
  });
}

/** 思路筆記的新增、修改、刪除共用一個 hook */
export function useNoteActions(activityId: string) {
  const qc = useQueryClient();
  const onSuccess = () => qc.invalidateQueries({ queryKey: keys.notes(activityId) });
  return {
    create: useMutation({ mutationFn: (input: NoteInput) => api.createNote(activityId, input), onSuccess }),
    update: useMutation({ mutationFn: (v: { id: string; text: string }) => api.updateNote(v.id, v.text), onSuccess }),
    remove: useMutation({ mutationFn: (id: string) => api.deleteNote(id), onSuccess }),
  };
}

/** 老師的活動控制：直接結束、設定階段截止時間 */
export function useActivityControls(id: string) {
  const qc = useQueryClient();
  const onSuccess = (a: Activity) => { qc.setQueryData(keys.activity(id), a); qc.invalidateQueries({ queryKey: keys.activities(a.classroomId) }); };
  return {
    finish: useMutation({ mutationFn: () => api.finishActivity(id), onSuccess }),
    deadline: useMutation({ mutationFn: (deadline: string | null) => api.setStageDeadline(id, deadline), onSuccess }),
  };
}

export function useSetReady(id: string) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (ready: boolean) => api.setReady(id, ready), onSuccess: () => qc.invalidateQueries({ queryKey: keys.members(id) }) });
}

export function useAdvanceActivity(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.advanceActivity(id),
    onSuccess: (a) => {
      qc.setQueryData(keys.activity(id), a);
      qc.invalidateQueries({ queryKey: keys.activities(a.classroomId) });
    },
  });
}

export function useConfirmPosition(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (summary: ArgumentSummary) => api.confirmPosition(id, summary),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.positions(id) }),
  });
}

export const useMembers = (id: string, enabled = true) => useQuery({ queryKey: keys.members(id), queryFn: () => api.listMembers(id), enabled: enabled && !!id });
export const useGroups = (id: string, enabled = true) => useQuery({ queryKey: keys.groups(id), queryFn: () => api.listGroups(id), enabled });
export const useGroupMessages = (gid: string | undefined) => useQuery({ queryKey: keys.groupMessages(gid ?? ""), queryFn: () => api.listGroupMessages(gid!), enabled: !!gid });
export const useArguments = (gid: string | undefined) => useQuery({ queryKey: keys.arguments(gid ?? ""), queryFn: () => api.listArguments(gid!), enabled: !!gid });
export const useRooms = (id: string, enabled = true) => useQuery({ queryKey: keys.rooms(id), queryFn: () => api.listRooms(id), enabled });
export const useTurns = (rid: string | undefined) => useQuery({ queryKey: keys.turns(rid ?? ""), queryFn: () => api.listTurns(rid!), enabled: !!rid });
export const useScores = (id: string, enabled = true) => useQuery({ queryKey: keys.scores(id), queryFn: () => api.listScores(id), enabled });
/** 立場星圖：活動結束前只有老師拿得到（學生呼叫會被拒絕），所以學生端要傳 enabled = false */
export const useStar = (id: string, stage: string, enabled = true) => useQuery({ queryKey: [...keys.star(id), stage], queryFn: () => api.getStarData(id), enabled });

/** 訂閱活動的即時事件（SSE）：有事件就讓相關的查詢重新抓，畫面自然更新 */
export function useActivityEvents(activityId: string) {
  const qc = useQueryClient();
  useEffect(() => {
    return api.subscribe(activityId, (e) => {
      switch (e.type) {
        case "stage_changed":
          for (const k of [keys.activity(activityId), keys.groups(activityId), keys.rooms(activityId), keys.star(activityId), keys.scores(activityId), keys.members(activityId)]) qc.invalidateQueries({ queryKey: k });
          break;
        case "group_message":
          qc.invalidateQueries({ queryKey: keys.groupMessages(e.message.groupId) });
          break;
        case "argument_updated":
          qc.invalidateQueries({ queryKey: keys.arguments(e.argument.groupId) });
          qc.invalidateQueries({ queryKey: keys.star(activityId) });
          break;
        case "turn_created":
          qc.invalidateQueries({ queryKey: keys.turns(e.turn.roomId) });
          qc.invalidateQueries({ queryKey: keys.rooms(activityId) });
          break;
        case "room_updated":
          qc.invalidateQueries({ queryKey: keys.rooms(activityId) });
          qc.invalidateQueries({ queryKey: keys.turns(e.room.id) });
          break;
        case "deadline_changed":
          qc.invalidateQueries({ queryKey: keys.activity(activityId) });
          break;
        case "member_ready":
          qc.invalidateQueries({ queryKey: keys.members(activityId) });
          break;
      }
    });
  }, [activityId, qc]);
}

export const useClassroomMembers = (id: string) => useQuery({ queryKey: keys.classroomMembers(id), queryFn: () => api.listClassroomMembers(id) });

/** 修改自己的顯示名稱；教室成員表、側邊欄都會跟著更新 */
export function useUpdateMe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: { name?: string; avatarUrl?: string | null }) => api.updateMe(patch),
    onSuccess: (u) => {
      qc.setQueryData(keys.me, u);
      qc.invalidateQueries({ queryKey: ["classroomMembers"] });
    },
  });
}

/** 老師把學生設為助教（或改回學生） */
export function useSetMemberRole(classroomId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ memberId, role }: { memberId: string; role: Exclude<ClassroomRole, "teacher"> }) => api.setMemberRole(classroomId, memberId, role),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.classroomMembers(classroomId) }),
  });
}

/** 新增（不帶 eventId）或編輯行事曆的自訂事件 */
export function useSaveCalendarEvent(classroomId: string, eventId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CalendarEventInput) => (eventId ? api.updateCalendarEvent(eventId, input) : api.createCalendarEvent(classroomId, input)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["calendar"] }),
  });
}

export function useDeleteCalendarEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteCalendarEvent(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["calendar"] }),
  });
}

/** 目前使用者在這間教室能不能管理內容（老師或助教：公告、行事曆、辯論資料） */
export function useIsStaff(classroomId: string) {
  const { data: c } = useClassroom(classroomId);
  return c?.myRole === "teacher" || c?.myRole === "assistant";
}
