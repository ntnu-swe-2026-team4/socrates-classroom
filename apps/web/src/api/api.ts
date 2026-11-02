import type {
  Activity,
  ActivityEvent,
  Announcement,
  AnnouncementInput,
  ApplicationStatus,
  Archive,
  BankKind,
  CalendarEvent,
  CalendarEventInput,
  Classroom,
  ClassroomInput,
  ClassroomRole,
  ClassroomMember,
  ClassroomPreview,
  ClassroomTopic,
  DialogueMessage,
  DiscussionPost,
  DiscussionSession,
  DiscussionSessionDetail,
  DiscussionStatus,
  DiscussionTask,
  DiscussionTaskInput,
  Emotion,
  Group,
  GroupArgument,
  GroupMessage,
  ImportMembersResult,
  JoinApplication,
  JoinInput,
  JoinPolicy,
  JoinResult,
  Judgment,
  Member,
  ArgumentSummary,
  NoteInput,
  Position,
  PositionDraft,
  PostInput,
  Progress,
  Room,
  ScoreRow,
  ShareTarget,
  StarData,
  ThinkingNote,
  TopicInput,
  TopicReport,
  TopicResource,
  Turn,
  User,
  Role,
  Vote,
} from "./types";

export interface Api {
  login(input: { role: Role; name: string }): Promise<User>;
  me(): Promise<User | null>;
  updateMe(patch: { name?: string; avatarUrl?: string | null }): Promise<User>;
  logout(): Promise<void>;

  listArchives(): Promise<Archive[]>;
  updateArchive(
    id: string,
    patch: { bank?: BankKind | null; inSummary?: boolean; sharedWithIds?: string[] },
  ): Promise<Archive>;
  listShareTargets(): Promise<ShareTarget[]>;
  createArchive(title: string): Promise<Archive>;
  listTopicDialogue(archiveId: string): Promise<DialogueMessage[]>;
  sendTopicDialogue(
    archiveId: string,
    text: string,
    onDelta?: (chunk: string) => void,
    onEmotion?: (emotion: Emotion) => void,
    signal?: AbortSignal,
  ): Promise<DialogueMessage>;

  listClassrooms(): Promise<Classroom[]>;
  getClassroom(id: string): Promise<Classroom>;
  createClassroom(input: ClassroomInput): Promise<Classroom>;
  updateClassroom(id: string, patch: Partial<ClassroomInput>): Promise<Classroom>;
  acceptInvite(classroomId: string): Promise<Classroom>;
  declineInvite(classroomId: string): Promise<void>;
  listClassroomMembers(classroomId: string): Promise<ClassroomMember[]>;
  addClassroomMember(classroomId: string, name: string): Promise<ClassroomMember>;
  importClassroomMembers(classroomId: string, names: string[]): Promise<ImportMembersResult>;
  removeClassroomMember(classroomId: string, memberId: string): Promise<void>;
  setMemberRole(
    classroomId: string,
    memberId: string,
    role: Exclude<ClassroomRole, "teacher">,
  ): Promise<ClassroomMember>;
  listActivities(classroomId: string): Promise<Activity[]>;
  getActivity(id: string): Promise<Activity>;
  advanceActivity(id: string): Promise<Activity>;
  finishActivity(id: string): Promise<Activity>;
  setStageDeadline(id: string, deadline: string | null): Promise<Activity>;

  getJoinPolicy(classroomId: string): Promise<JoinPolicy>;
  updateJoinPolicy(classroomId: string, patch: Partial<Omit<JoinPolicy, "code">>): Promise<JoinPolicy>;
  regenerateJoinCode(classroomId: string): Promise<JoinPolicy>;
  discoverClassrooms(query?: string): Promise<ClassroomPreview[]>;
  lookupJoinCode(code: string): Promise<ClassroomPreview>;
  joinClassroom(classroomId: string, input: JoinInput): Promise<JoinResult>;
  listMyApplications(): Promise<JoinApplication[]>;
  cancelApplication(applicationId: string): Promise<void>;
  listApplications(classroomId: string, status?: ApplicationStatus): Promise<JoinApplication[]>;
  reviewApplication(applicationId: string, decision: "approve" | "reject", note?: string): Promise<JoinApplication>;

  listAnnouncements(classroomId: string): Promise<Announcement[]>;
  createAnnouncement(classroomId: string, input: AnnouncementInput): Promise<Announcement>;
  updateAnnouncement(id: string, patch: Partial<AnnouncementInput>): Promise<Announcement>;
  deleteAnnouncement(id: string): Promise<void>;

  listTopics(classroomId: string): Promise<ClassroomTopic[]>;
  getTopic(id: string): Promise<ClassroomTopic>;
  createTopic(classroomId: string, input: TopicInput): Promise<ClassroomTopic>;
  updateTopic(id: string, patch: Partial<TopicInput>): Promise<ClassroomTopic>;
  deleteTopic(id: string): Promise<void>;
  addTopicLink(topicId: string, link: { name: string; url: string }): Promise<TopicResource>;
  uploadTopicFile(topicId: string, file: File): Promise<TopicResource>;
  deleteTopicResource(topicId: string, resourceId: string): Promise<void>;
  listReports(topicId: string): Promise<TopicReport[]>;
  submitReport(topicId: string, file: File, comment?: string): Promise<TopicReport>;
  deleteReport(reportId: string): Promise<void>;

  listDiscussions(classroomId: string): Promise<DiscussionTask[]>;
  getDiscussion(id: string): Promise<DiscussionTask>;
  createDiscussion(classroomId: string, input: DiscussionTaskInput): Promise<DiscussionTask>;
  updateDiscussion(id: string, patch: Partial<DiscussionTaskInput>): Promise<DiscussionTask>;
  setDiscussionStatus(id: string, status: DiscussionStatus): Promise<DiscussionTask>;
  deleteDiscussion(id: string): Promise<void>;
  listDiscussionSessions(discussionId: string): Promise<DiscussionSession[]>;
  getDiscussionSession(discussionId: string, studentId?: string): Promise<DiscussionSessionDetail>;
  sendDiscussionMessage(
    discussionId: string,
    text: string,
    onDelta?: (chunk: string) => void,
    onEmotion?: (emotion: Emotion) => void,
    signal?: AbortSignal,
  ): Promise<DialogueMessage>;
  submitDiscussionConclusion(discussionId: string, conclusion: string | null): Promise<DiscussionSessionDetail>;

  listPosts(classroomId: string, topicId: string | null): Promise<DiscussionPost[]>;
  createPost(classroomId: string, input: PostInput): Promise<DiscussionPost>;
  deletePost(postId: string): Promise<void>;

  listCalendar(range: { from: string; to: string; classroomId: string }): Promise<CalendarEvent[]>;
  createCalendarEvent(classroomId: string, input: CalendarEventInput): Promise<CalendarEvent>;
  updateCalendarEvent(id: string, patch: Partial<CalendarEventInput>): Promise<CalendarEvent>;
  deleteCalendarEvent(id: string): Promise<void>;

  listDialogue(activityId: string): Promise<DialogueMessage[]>;
  sendDialogue(
    activityId: string,
    text: string,
    onDelta?: (chunk: string) => void,
    signal?: AbortSignal,
  ): Promise<DialogueMessage>;
  getProgress(activityId: string): Promise<Progress>;
  draftPosition(activityId: string): Promise<PositionDraft>;
  confirmPosition(activityId: string, summary: ArgumentSummary): Promise<Position>;
  listPositions(activityId: string): Promise<Position[]>;
  setReady(activityId: string, ready: boolean): Promise<void>;
  listNotes(activityId: string): Promise<ThinkingNote[]>;
  createNote(activityId: string, input: NoteInput): Promise<ThinkingNote>;
  updateNote(noteId: string, text: string): Promise<ThinkingNote>;
  deleteNote(noteId: string): Promise<void>;

  listMembers(activityId: string): Promise<Member[]>;
  listGroups(activityId: string): Promise<Group[]>;
  regroup(activityId: string, groupSize: number): Promise<Group[]>;
  listGroupMessages(groupId: string): Promise<GroupMessage[]>;
  postGroupMessage(groupId: string, text: string): Promise<GroupMessage>;
  summarizeGroup(groupId: string): Promise<GroupArgument[]>;
  counterexample(groupId: string): Promise<GroupMessage>;
  listArguments(groupId: string): Promise<GroupArgument[]>;
  vote(argumentId: string, vote: Vote): Promise<GroupArgument>;
  splitGroup(groupId: string): Promise<Group[]>;

  listRooms(activityId: string): Promise<Room[]>;
  startRoom(roomId: string): Promise<Room>;
  listTurns(roomId: string): Promise<{ turns: Turn[]; judgments: Judgment[] }>;
  postTurn(roomId: string, text: string): Promise<Turn>;
  overrideJudgment(judgmentId: string, teacherScore: number | null): Promise<Judgment>;

  listScores(activityId: string): Promise<ScoreRow[]>;
  adjustScore(activityId: string, memberId: string, adjust: number): Promise<ScoreRow>;

  getStarData(activityId: string): Promise<StarData>;

  dev?: {
    simulateIndividual(activityId: string): Promise<number>;
    simulateRoom(roomId: string): Promise<Room>;
    simulateAllRooms(activityId: string): Promise<void>;
  };

  subscribe(activityId: string, onEvent: (e: ActivityEvent) => void): () => void;
}
