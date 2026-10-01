import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./index";
import type { BankKind, ClassroomInput, ClassroomTopic, PositionDraft, TopicInput } from "./index";

/** 每個查詢的 key 集中在這裡，讓後端事件（SSE）進來時知道要讓哪些資料失效 */
export const keys = {
  me: ["me"] as const,
  archives: ["archives"] as const,
  classrooms: ["classrooms"] as const,
  classroom: (id: string) => ["classroom", id] as const,
  classroomMembers: (id: string) => ["classroomMembers", id] as const,
  activities: (cid: string) => ["activities", cid] as const,
  topics: (cid: string) => ["topics", cid] as const,
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

/** 議題變動後要更新的資料：議題列表、單一議題，以及團體議題連動的辯論活動與教室統計 */
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

/** 新增（不帶 topicId）或編輯議題；編輯時不能改類型 */
export function useSaveTopic(classroomId: string, topicId?: string) {
  const invalidate = useInvalidateTopic(classroomId);
  return useMutation({
    mutationFn: ({ type, ...rest }: TopicInput) => (topicId ? api.updateTopic(topicId, rest) : api.createTopic(classroomId, { type, ...rest })),
    onSuccess: (t) => invalidate(t),
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
    mutationFn: (p: PositionDraft) => api.confirmPosition(id, p),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.positions(id) }),
  });
}

export const useMembers = (id: string) => useQuery({ queryKey: keys.members(id), queryFn: () => api.listMembers(id) });
export const useGroups = (id: string, enabled = true) => useQuery({ queryKey: keys.groups(id), queryFn: () => api.listGroups(id), enabled });
export const useGroupMessages = (gid: string | undefined) => useQuery({ queryKey: keys.groupMessages(gid ?? ""), queryFn: () => api.listGroupMessages(gid!), enabled: !!gid });
export const useArguments = (gid: string | undefined) => useQuery({ queryKey: keys.arguments(gid ?? ""), queryFn: () => api.listArguments(gid!), enabled: !!gid });
export const useRooms = (id: string, enabled = true) => useQuery({ queryKey: keys.rooms(id), queryFn: () => api.listRooms(id), enabled });
export const useTurns = (rid: string | undefined) => useQuery({ queryKey: keys.turns(rid ?? ""), queryFn: () => api.listTurns(rid!), enabled: !!rid });
export const useScores = (id: string, enabled = true) => useQuery({ queryKey: keys.scores(id), queryFn: () => api.listScores(id), enabled });
export const useStar = (id: string, stage: string) => useQuery({ queryKey: [...keys.star(id), stage], queryFn: () => api.getStarData(id) });

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
