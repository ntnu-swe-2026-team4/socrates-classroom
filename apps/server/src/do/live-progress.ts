import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { type EntryId, type Harness, ROOT_CONVERSATION_ID } from "@earendil-works/pi-durable";
import type { LifecycleJobOutcome, LifecycleJobs } from "agents/lifecycle";
import type { Db } from "../db/d1";
import { appendLiveEntries, type LiveProgress, saveLiveProgress } from "../services/activity-live";

export const LIVE_PROGRESS_JOB = "activity-live-progress";
const LIVE_PROGRESS_KEY = "activity-live-progress";
const LIVE_PROGRESS_SCAN_KEY = "activity-live-progress-scan";
const LIVE_PROGRESS_DELAY_MS = 2_000;
const LIVE_PROGRESS_RETRY_MS = 15_000;
const LIVE_PROGRESS_PAGE_SIZE = 128;

export class LiveProgressProjection {
  #admissions = 0;

  constructor(
    private readonly state: DurableObjectState,
    private readonly db: Db,
    private readonly jobs: () => LifecycleJobs,
    private readonly pi: () => Promise<Harness>,
  ) {}

  async trackAdmission<T>(submit: () => Promise<T>): Promise<T> {
    this.#admissions++;
    try {
      await this.schedule();
      return await submit();
    } finally {
      this.#admissions--;
    }
  }

  async schedule(): Promise<void> {
    const jobs = this.jobs();
    const existing = jobs.get(LIVE_PROGRESS_JOB);
    if (existing && this.#admissions === 0) return;
    const time = Math.min(existing?.time ?? Infinity, Date.now() + LIVE_PROGRESS_DELAY_MS);
    await jobs.push({ fn: LIVE_PROGRESS_JOB, id: LIVE_PROGRESS_JOB, time, singleflight: true });
  }

  async dispatch(): Promise<LifecycleJobOutcome> {
    try {
      if (await this.project()) return { rescheduleAt: Date.now() + LIVE_PROGRESS_DELAY_MS };
    } catch (error) {
      console.warn("[live-progress] projection failed", error instanceof Error ? error.name : typeof error);
      return { rescheduleAt: Date.now() + LIVE_PROGRESS_RETRY_MS };
    }
  }

  private async project(): Promise<boolean> {
    const [activityId, participantId] = this.state.id.name?.split(":") ?? [];
    if (!activityId || !participantId) return false;
    const pi = await this.pi();
    const isRootBusy = async () => {
      const inspection = await pi.inspect(BACKGROUND_CONTEXT);
      return (
        inspection.submissions.some(({ conversationId }) => conversationId === ROOT_CONVERSATION_ID) ||
        inspection.tasks.some(
          ({ record, state }) => record.conversationId === ROOT_CONVERSATION_ID && state.kind !== "blocked",
        )
      );
    };
    const rootBusy = await isRootBusy();
    const root = await pi.conversation(ROOT_CONVERSATION_ID, BACKGROUND_CONTEXT);
    const published = this.state.storage.kv.get<LiveProgress>(LIVE_PROGRESS_KEY);
    const scanning = this.state.storage.kv.get<LiveProgress>(LIVE_PROGRESS_SCAN_KEY);
    const previous = scanning ?? published ?? { lastEntryId: 0, rounds: 0, lastActiveAt: null, flags: [] };
    const page = await root?.entries(
      { order: "ascending", minEntryId: (previous.lastEntryId + 1) as EntryId },
      LIVE_PROGRESS_PAGE_SIZE,
      undefined,
      BACKGROUND_CONTEXT,
    );
    const next = appendLiveEntries(previous, page?.items ?? []);
    if (page?.next !== undefined) {
      this.state.storage.kv.put(LIVE_PROGRESS_SCAN_KEY, next);
      return true;
    }
    if (
      !published ||
      next.rounds !== published.rounds ||
      next.flags.some((flag) => !published.flags.some(({ id }) => id === flag.id))
    ) {
      await saveLiveProgress(this.db, activityId, participantId, next);
    }
    if (!published || next.lastEntryId !== published.lastEntryId) {
      this.state.storage.transactionSync(() => {
        this.state.storage.kv.put(LIVE_PROGRESS_KEY, next);
        if (scanning) this.state.storage.kv.delete(LIVE_PROGRESS_SCAN_KEY);
      });
    }
    return this.#admissions > 0 || rootBusy || (await isRootBusy());
  }
}
