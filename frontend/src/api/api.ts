import type {
  Activity, ActivityEvent, Announcement, AnnouncementInput, ApplicationStatus, Archive, BankKind,
  CalendarEvent, CalendarEventInput, Classroom, ClassroomInput, ClassroomRole, ClassroomMember, ClassroomPreview, ClassroomTopic,
  DialogueMessage, DiscussionPost, Group, GroupArgument, GroupMessage,
  ImportMembersResult, JoinApplication, JoinInput, JoinPolicy, JoinResult, Judgment, Member,
  ArgumentSummary, NoteInput, Position, PositionDraft, PostInput, Progress, Room, ScoreRow, StarData,
  ThinkingNote, TopicInput, TopicReport, TopicResource, Turn, User, Role, Vote,
} from "./types";

/**
 * 前端只依賴這個介面。有兩個實作：
 *  - mockApi：前端內建的示範資料（沒有後端也能跑）
 *  - httpApi：呼叫後端（Bun + Hono）（路徑見 docs/api-contract.md）
 * 用 VITE_API_MODE 切換，畫面與頁面程式不用改。
 */
export interface Api {
  /* 認證 */
  login(input: { role: Role; name: string }): Promise<User>;
  me(): Promise<User | null>;
  /** 修改自己的顯示名稱與頭像（avatarUrl 是縮成 256×256 的圖片 data URL；null = 移除，回到預設的黑色頭像） */
  updateMe(patch: { name?: string; avatarUrl?: string | null }): Promise<User>;
  logout(): Promise<void>;

  /* 議題與題庫 */
  listArchives(): Promise<Archive[]>;
  updateArchive(id: string, patch: { bank?: BankKind | null; inSummary?: boolean }): Promise<Archive>;
  /** 開始一段新的自由對話（首頁提問框）；回傳新的議題 */
  createArchive(title: string): Promise<Archive>;
  /** 議題的自由對話（單人 → 對話）；sendTopicDialogue 的回覆同樣用串流 */
  listTopicDialogue(archiveId: string): Promise<DialogueMessage[]>;
  sendTopicDialogue(archiveId: string, text: string, onDelta?: (chunk: string) => void): Promise<DialogueMessage>;

  /* 教室與辯論活動 */
  listClassrooms(): Promise<Classroom[]>;
  getClassroom(id: string): Promise<Classroom>;
  createClassroom(input: ClassroomInput): Promise<Classroom>; // 僅老師
  updateClassroom(id: string, patch: Partial<ClassroomInput>): Promise<Classroom>; // 僅老師
  acceptInvite(classroomId: string): Promise<Classroom>; // 學生接受邀請
  declineInvite(classroomId: string): Promise<void>;
  listClassroomMembers(classroomId: string): Promise<ClassroomMember[]>;
  addClassroomMember(classroomId: string, name: string): Promise<ClassroomMember>; // 僅老師
  /** 批次匯入（每行一個帳號或姓名）；僅老師 */
  importClassroomMembers(classroomId: string, names: string[]): Promise<ImportMembersResult>;
  removeClassroomMember(classroomId: string, memberId: string): Promise<void>; // 僅老師
  /** 老師把學生設為助教，或把助教改回學生 */
  setMemberRole(classroomId: string, memberId: string, role: Exclude<ClassroomRole, "teacher">): Promise<ClassroomMember>; // 僅老師
  listActivities(classroomId: string): Promise<Activity[]>;
  getActivity(id: string): Promise<Activity>;
  /** 老師推進階段；後端的活動狀態機（FSM）決定能不能推進 */
  advanceActivity(id: string): Promise<Activity>;
  /** 老師直接結束活動（從任何階段跳到結果） */
  finishActivity(id: string): Promise<Activity>;
  /** 老師設定目前階段的截止時間；null = 取消限時 */
  setStageDeadline(id: string, deadline: string | null): Promise<Activity>;

  /* 加入教室：邀請碼、公開探索、審核 */
  getJoinPolicy(classroomId: string): Promise<JoinPolicy>; // 僅老師
  updateJoinPolicy(classroomId: string, patch: Partial<Omit<JoinPolicy, "code">>): Promise<JoinPolicy>; // 僅老師
  regenerateJoinCode(classroomId: string): Promise<JoinPolicy>; // 僅老師
  discoverClassrooms(query?: string): Promise<ClassroomPreview[]>; // 學生
  lookupJoinCode(code: string): Promise<ClassroomPreview>; // 學生；代碼無效回 404
  joinClassroom(classroomId: string, input: JoinInput): Promise<JoinResult>; // 學生
  listMyApplications(): Promise<JoinApplication[]>; // 學生
  cancelApplication(applicationId: string): Promise<void>; // 學生，只能取消 pending
  listApplications(classroomId: string, status?: ApplicationStatus): Promise<JoinApplication[]>; // 僅老師
  reviewApplication(applicationId: string, decision: "approve" | "reject", note?: string): Promise<JoinApplication>; // 僅老師

  /* 公告（學生只拿得到已發布的） */
  listAnnouncements(classroomId: string): Promise<Announcement[]>;
  createAnnouncement(classroomId: string, input: AnnouncementInput): Promise<Announcement>; // 老師或助教
  updateAnnouncement(id: string, patch: Partial<AnnouncementInput>): Promise<Announcement>; // 老師或助教
  deleteAnnouncement(id: string): Promise<void>; // 老師或助教

  /* 教室的辯論（API 名稱沿用 topic；畫面上稱為「辯論」） */
  listTopics(classroomId: string): Promise<ClassroomTopic[]>;
  getTopic(id: string): Promise<ClassroomTopic>;
  createTopic(classroomId: string, input: TopicInput): Promise<ClassroomTopic>; // 僅老師；同時建立這場辯論的活動（四階段辯論）
  updateTopic(id: string, patch: Partial<TopicInput>): Promise<ClassroomTopic>; // 僅老師
  deleteTopic(id: string): Promise<void>; // 僅老師；連同這場辯論的活動一起刪除
  addTopicLink(topicId: string, link: { name: string; url: string }): Promise<TopicResource>; // 老師或助教
  uploadTopicFile(topicId: string, file: File): Promise<TopicResource>; // 老師或助教
  deleteTopicResource(topicId: string, resourceId: string): Promise<void>; // 老師或助教
  /** 老師：全班；學生：只有自己 */
  listReports(topicId: string): Promise<TopicReport[]>;
  /** 學生上傳結論報告；重複上傳會取代舊的 */
  submitReport(topicId: string, file: File, comment?: string): Promise<TopicReport>;
  deleteReport(reportId: string): Promise<void>; // 作者本人

  /* 討論區（topicId = null 為教室討論區） */
  listPosts(classroomId: string, topicId: string | null): Promise<DiscussionPost[]>;
  createPost(classroomId: string, input: PostInput): Promise<DiscussionPost>;
  deletePost(postId: string): Promise<void>; // 作者本人或老師

  /* 行事曆：classroomId 省略 = 自己所有教室 */
  listCalendar(range: { from: string; to: string; classroomId: string }): Promise<CalendarEvent[]>;
  /** 老師或助教新增 / 修改 / 刪除自己的行事曆事件（辯論截止、公告等系統事件不能直接改） */
  createCalendarEvent(classroomId: string, input: CalendarEventInput): Promise<CalendarEvent>;
  updateCalendarEvent(id: string, patch: Partial<CalendarEventInput>): Promise<CalendarEvent>;
  deleteCalendarEvent(id: string): Promise<void>;

  /* 階段 1：個人調查 */
  listDialogue(activityId: string): Promise<DialogueMessage[]>;
  /** 送出一句話；回覆用串流一段一段回來（後端 SSE），最後回傳完整訊息 */
  sendDialogue(activityId: string, text: string, onDelta?: (chunk: string) => void): Promise<DialogueMessage>;
  getProgress(activityId: string): Promise<Progress>;
  draftPosition(activityId: string): Promise<PositionDraft>;
  /** 學生確認（或修改）論點；座標由後端依對話估算 */
  confirmPosition(activityId: string, summary: ArgumentSummary): Promise<Position>;
  listPositions(activityId: string): Promise<Position[]>; // 老師：全班；學生：只有自己
  /** 學生在目前階段回報「我準備好了」 */
  setReady(activityId: string, ready: boolean): Promise<void>;
  /** 思路筆記（重點標註與自己的想法），只有本人看得到 */
  listNotes(activityId: string): Promise<ThinkingNote[]>;
  createNote(activityId: string, input: NoteInput): Promise<ThinkingNote>;
  updateNote(noteId: string, text: string): Promise<ThinkingNote>;
  deleteNote(noteId: string): Promise<void>;

  /* 階段 2：團隊提純 */
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

  /* 階段 3：辯論比賽 */
  listRooms(activityId: string): Promise<Room[]>;
  startRoom(roomId: string): Promise<Room>;
  listTurns(roomId: string): Promise<{ turns: Turn[]; judgments: Judgment[] }>;
  postTurn(roomId: string, text: string): Promise<Turn>;
  overrideJudgment(judgmentId: string, teacherScore: number | null): Promise<Judgment>;

  /* 結果 */
  listScores(activityId: string): Promise<ScoreRow[]>;
  adjustScore(activityId: string, memberId: string, adjust: number): Promise<ScoreRow>;

  /** 立場星圖的資料：階段 1 只有已確認的人、沒有分組；階段 2 之後有分組；結束後多一步「團隊提純後」 */
  getStarData(activityId: string): Promise<StarData>;

  /**
   * 只有示範用的假後端才有（真後端不需要實作）：
   * 讓模擬同學完成調查、模擬整場辯論、學生示範推進階段。
   */
  dev?: {
    simulateIndividual(activityId: string): Promise<number>;
    simulateRoom(roomId: string): Promise<Room>;
    simulateAllRooms(activityId: string): Promise<void>;
  };

  /** 訂閱活動的即時事件（階段切換、新訊息、輪到誰…）；回傳取消訂閱的函式 */
  subscribe(activityId: string, onEvent: (e: ActivityEvent) => void): () => void;
}
