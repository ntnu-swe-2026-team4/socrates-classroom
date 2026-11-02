import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./index";
import type {
  Activity,
  AnnouncementInput,
  ArgumentSummary,
  BankKind,
  CalendarEventInput,
  ClassroomInput,
  ClassroomRole,
  ClassroomTopic,
  DiscussionStatus,
  DiscussionTaskInput,
  JoinInput,
  JoinPolicy,
  NoteInput,
  PostInput,
  TopicInput,
} from "./index";

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
  shareTargets: ["shareTargets"] as const,
  discussions: (cid: string) => ["discussions", cid] as const,
  discussion: (id: string) => ["discussion", id] as const,
  discussionSessions: (id: string) => ["discussionSessions", id] as const,
  discussionSession: (id: string, studentId: string) => ["discussionSession", id, studentId] as const,
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
export const useClassroom = (id: string) =>
  useQuery({ queryKey: keys.classroom(id), queryFn: () => api.getClassroom(id) });
export const useActivities = (cid: string) =>
  useQuery({ queryKey: keys.activities(cid), queryFn: () => api.listActivities(cid) });
export const useAnnouncements = (cid: string) =>
  useQuery({ queryKey: keys.announcements(cid), queryFn: () => api.listAnnouncements(cid), refetchInterval: 60_000 });
export const useJoinPolicy = (cid: string) =>
  useQuery({ queryKey: keys.joinPolicy(cid), queryFn: () => api.getJoinPolicy(cid) });
export const usePendingApplications = (cid: string) =>
  useQuery({ queryKey: keys.applications(cid), queryFn: () => api.listApplications(cid, "pending") });
export const useMyApplications = () =>
  useQuery({ queryKey: keys.myApplications, queryFn: () => api.listMyApplications() });
export const useDiscoverClassrooms = (q: string) =>
  useQuery({
    queryKey: keys.discover(q),
    queryFn: () => api.discoverClassrooms(q || undefined),
    placeholderData: (prev) => prev,
  });
export const usePosts = (cid: string, topicId: string | null) =>
  useQuery({ queryKey: keys.posts(cid, topicId), queryFn: () => api.listPosts(cid, topicId) });
export const useCalendar = (cid: string, from: Date, to: Date) =>
  useQuery({
    queryKey: keys.calendar(cid, from.toISOString()),
    queryFn: () => api.listCalendar({ classroomId: cid, from: from.toISOString(), to: to.toISOString() }),
    placeholderData: (prev) => prev,
  });
export const useReports = (tid: string, enabled = true) =>
  useQuery({ queryKey: keys.reports(tid), queryFn: () => api.listReports(tid), enabled });
export const useNotes = (aid: string, enabled = true) =>
  useQuery({ queryKey: keys.notes(aid), queryFn: () => api.listNotes(aid), enabled });
export const useTopics = (cid: string) => useQuery({ queryKey: keys.topics(cid), queryFn: () => api.listTopics(cid) });
export const useTopic = (id: string) => useQuery({ queryKey: keys.topic(id), queryFn: () => api.getTopic(id) });
export const useActivity = (id: string) =>
  useQuery({ queryKey: keys.activity(id), queryFn: () => api.getActivity(id), enabled: !!id });
export const useDialogue = (id: string) =>
  useQuery({ queryKey: keys.dialogue(id), queryFn: () => api.listDialogue(id) });
export const useProgress = (id: string) =>
  useQuery({ queryKey: keys.progress(id), queryFn: () => api.getProgress(id) });
export const usePositions = (id: string) =>
  useQuery({ queryKey: keys.positions(id), queryFn: () => api.listPositions(id) });

export const useShareTargets = (enabled = true) =>
  useQuery({ queryKey: keys.shareTargets, queryFn: () => api.listShareTargets(), enabled, staleTime: 5 * 60_000 });

export function useUpdateArchive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; bank?: BankKind | null; inSummary?: boolean; sharedWithIds?: string[] }) =>
      api.updateArchive(v.id, { bank: v.bank, inSummary: v.inSummary, sharedWithIds: v.sharedWithIds }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.archives }),
  });
}

export const useDiscussions = (cid: string) =>
  useQuery({ queryKey: keys.discussions(cid), queryFn: () => api.listDiscussions(cid) });
export const useDiscussion = (id: string) =>
  useQuery({ queryKey: keys.discussion(id), queryFn: () => api.getDiscussion(id) });
export const useDiscussionSessions = (id: string, enabled = true) =>
  useQuery({
    queryKey: keys.discussionSessions(id),
    queryFn: () => api.listDiscussionSessions(id),
    enabled,
    refetchInterval: 30_000,
  });
export const useDiscussionSession = (id: string, studentId = "me", enabled = true) =>
  useQuery({
    queryKey: keys.discussionSession(id, studentId),
    queryFn: () => api.getDiscussionSession(id, studentId === "me" ? undefined : studentId),
    enabled,
  });

export function useInvalidateDiscussion(classroomId: string) {
  const qc = useQueryClient();
  return (id?: string) => {
    qc.invalidateQueries({ queryKey: keys.discussions(classroomId) });
    qc.invalidateQueries({ queryKey: ["calendar"] });
    if (id) qc.invalidateQueries({ queryKey: keys.discussion(id) });
  };
}

export function useSaveDiscussion(classroomId: string, discussionId?: string) {
  const invalidate = useInvalidateDiscussion(classroomId);
  return useMutation({
    mutationFn: (input: DiscussionTaskInput) =>
      discussionId ? api.updateDiscussion(discussionId, input) : api.createDiscussion(classroomId, input),
    onSuccess: (d) => invalidate(d.id),
  });
}

export function useSetDiscussionStatus(classroomId: string, discussionId: string) {
  const invalidate = useInvalidateDiscussion(classroomId);
  return useMutation({
    mutationFn: (status: DiscussionStatus) => api.setDiscussionStatus(discussionId, status),
    onSuccess: (d) => invalidate(d.id),
  });
}

export function useDeleteDiscussion(classroomId: string) {
  const qc = useQueryClient();
  const invalidate = useInvalidateDiscussion(classroomId);
  return useMutation({
    mutationFn: (id: string) => api.deleteDiscussion(id),
    onSuccess: (_data, id) => {
      invalidate();
      qc.removeQueries({ queryKey: keys.discussion(id) });
      qc.removeQueries({ queryKey: keys.discussionSessions(id) });
    },
  });
}

export function useSubmitConclusion(discussionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (conclusion: string | null) => api.submitDiscussionConclusion(discussionId, conclusion),
    onSuccess: (s) => {
      qc.setQueryData(keys.discussionSession(discussionId, "me"), s);
      qc.invalidateQueries({ queryKey: keys.discussion(discussionId) });
      qc.invalidateQueries({ queryKey: ["discussions"] });
      qc.invalidateQueries({ queryKey: keys.discussionSessions(discussionId) });
    },
  });
}

export function useSaveClassroom(classroomId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ClassroomInput) =>
      classroomId ? api.updateClassroom(classroomId, input) : api.createClassroom(input),
    onSuccess: (c) => {
      qc.setQueryData(keys.classroom(c.id), c);
      qc.invalidateQueries({ queryKey: keys.classrooms });
    },
  });
}

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

export function useSaveTopic(classroomId: string, topicId?: string) {
  const invalidate = useInvalidateTopic(classroomId);
  return useMutation({
    mutationFn: (input: TopicInput) =>
      topicId ? api.updateTopic(topicId, input) : api.createTopic(classroomId, input),
    onSuccess: (t) => invalidate(t),
  });
}

export function useSaveAnnouncement(classroomId: string, announcementId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AnnouncementInput) =>
      announcementId ? api.updateAnnouncement(announcementId, input) : api.createAnnouncement(classroomId, input),
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

export function useReviewApplication(classroomId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; decision: "approve" | "reject"; note?: string }) =>
      api.reviewApplication(v.id, v.decision, v.note),
    onSuccess: () => {
      for (const k of [
        keys.applications(classroomId),
        keys.classroomMembers(classroomId),
        keys.classroom(classroomId),
        keys.classrooms,
      ])
        qc.invalidateQueries({ queryKey: k });
    },
  });
}

export function useImportMembers(classroomId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (names: string[]) => api.importClassroomMembers(classroomId, names),
    onSuccess: () => {
      for (const k of [keys.classroomMembers(classroomId), keys.classroom(classroomId), keys.classrooms])
        qc.invalidateQueries({ queryKey: k });
    },
  });
}

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

export function useCreatePost(classroomId: string, topicId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<PostInput, "topicId">) => api.createPost(classroomId, { ...input, topicId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.posts(classroomId, topicId) });
      if (topicId) {
        qc.invalidateQueries({ queryKey: keys.topic(topicId) });
        qc.invalidateQueries({ queryKey: keys.topics(classroomId) });
      }
    },
  });
}

export function useDeletePost(classroomId: string, topicId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deletePost(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.posts(classroomId, topicId) });
      if (topicId) {
        qc.invalidateQueries({ queryKey: keys.topic(topicId) });
        qc.invalidateQueries({ queryKey: keys.topics(classroomId) });
      }
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

export function useNoteActions(activityId: string) {
  const qc = useQueryClient();
  const onSuccess = () => qc.invalidateQueries({ queryKey: keys.notes(activityId) });
  return {
    create: useMutation({ mutationFn: (input: NoteInput) => api.createNote(activityId, input), onSuccess }),
    update: useMutation({ mutationFn: (v: { id: string; text: string }) => api.updateNote(v.id, v.text), onSuccess }),
    remove: useMutation({ mutationFn: (id: string) => api.deleteNote(id), onSuccess }),
  };
}

export function useActivityControls(id: string) {
  const qc = useQueryClient();
  const onSuccess = (a: Activity) => {
    qc.setQueryData(keys.activity(id), a);
    qc.invalidateQueries({ queryKey: keys.activities(a.classroomId) });
  };
  return {
    finish: useMutation({ mutationFn: () => api.finishActivity(id), onSuccess }),
    deadline: useMutation({ mutationFn: (deadline: string | null) => api.setStageDeadline(id, deadline), onSuccess }),
  };
}

export function useSetReady(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ready: boolean) => api.setReady(id, ready),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.members(id) }),
  });
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

export const useMembers = (id: string, enabled = true) =>
  useQuery({ queryKey: keys.members(id), queryFn: () => api.listMembers(id), enabled: enabled && !!id });
export const useGroups = (id: string, enabled = true) =>
  useQuery({ queryKey: keys.groups(id), queryFn: () => api.listGroups(id), enabled });
export const useGroupMessages = (gid: string | undefined) =>
  useQuery({ queryKey: keys.groupMessages(gid ?? ""), queryFn: () => api.listGroupMessages(gid!), enabled: !!gid });
export const useArguments = (gid: string | undefined) =>
  useQuery({ queryKey: keys.arguments(gid ?? ""), queryFn: () => api.listArguments(gid!), enabled: !!gid });
export const useRooms = (id: string, enabled = true) =>
  useQuery({ queryKey: keys.rooms(id), queryFn: () => api.listRooms(id), enabled });
export const useTurns = (rid: string | undefined) =>
  useQuery({ queryKey: keys.turns(rid ?? ""), queryFn: () => api.listTurns(rid!), enabled: !!rid });
export const useScores = (id: string, enabled = true) =>
  useQuery({ queryKey: keys.scores(id), queryFn: () => api.listScores(id), enabled });
export const useStar = (id: string, stage: string, enabled = true) =>
  useQuery({ queryKey: [...keys.star(id), stage], queryFn: () => api.getStarData(id), enabled });

export function useActivityEvents(activityId: string) {
  const qc = useQueryClient();
  useEffect(() => {
    return api.subscribe(activityId, (e) => {
      switch (e.type) {
        case "stage_changed":
          for (const k of [
            keys.activity(activityId),
            keys.groups(activityId),
            keys.rooms(activityId),
            keys.star(activityId),
            keys.scores(activityId),
            keys.members(activityId),
          ])
            qc.invalidateQueries({ queryKey: k });
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

export const useClassroomMembers = (id: string) =>
  useQuery({ queryKey: keys.classroomMembers(id), queryFn: () => api.listClassroomMembers(id) });

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

export function useSetMemberRole(classroomId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ memberId, role }: { memberId: string; role: Exclude<ClassroomRole, "teacher"> }) =>
      api.setMemberRole(classroomId, memberId, role),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.classroomMembers(classroomId) }),
  });
}

export function useSaveCalendarEvent(classroomId: string, eventId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CalendarEventInput) =>
      eventId ? api.updateCalendarEvent(eventId, input) : api.createCalendarEvent(classroomId, input),
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

export function useIsStaff(classroomId: string) {
  const { data: c } = useClassroom(classroomId);
  return c?.myRole === "teacher" || c?.myRole === "assistant";
}
