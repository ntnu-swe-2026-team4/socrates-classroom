import type { EntryRecord } from "@earendil-works/pi-durable";
import { type ActivityLive, type LiveFlag, LiveFlagSchema } from "@socrates/shared";
import { z } from "zod";
import { all, type Db, run } from "../db/d1";

const LIVE_ACTIVE_WINDOW_MS = 120_000;
const StoredFlagsSchema = z.array(LiveFlagSchema);

export interface LiveProgress {
  lastEntryId: number;
  rounds: number;
  lastActiveAt: number | null;
  flags: LiveFlag[];
}

export function appendLiveEntries(progress: LiveProgress, entries: readonly EntryRecord[]): LiveProgress {
  let { lastEntryId, rounds, lastActiveAt } = progress;
  const flags = new Map(progress.flags.map((flag) => [flag.type, flag]));
  for (const entry of entries) {
    lastEntryId = entry.id;
    if (entry.kind === "pi.user") {
      rounds++;
      const user = entry.model?.find((message) => message.role === "user");
      if (user && Number.isFinite(user.timestamp)) lastActiveAt = user.timestamp;
    }
    if (entry.kind === "app.violation") {
      const data = entry.data;
      const type = data && typeof data === "object" && "type" in data ? data.type : undefined;
      const parsed = LiveFlagSchema.safeParse({ id: String(entry.id), type: type ?? "other" });
      if (parsed.success) flags.set(parsed.data.type, parsed.data);
    }
  }
  return { lastEntryId, rounds, lastActiveAt, flags: [...flags.values()] };
}

export async function saveLiveProgress(db: Db, activityId: string, participantId: string, progress: LiveProgress) {
  await run(
    db,
    `INSERT INTO activity_live_progress (activity_id, participant_id, last_entry_id, rounds, last_active_at, flags)
     SELECT activity_id, id, $entry, $rounds, $active, $flags
     FROM activity_participants WHERE activity_id = $aid AND id = $pid AND kind != 'teacher'
     ON CONFLICT(activity_id, participant_id) DO UPDATE SET
       last_entry_id = excluded.last_entry_id, rounds = excluded.rounds,
       last_active_at = excluded.last_active_at, flags = excluded.flags
     WHERE activity_live_progress.last_entry_id < excluded.last_entry_id`,
    {
      aid: activityId,
      pid: participantId,
      entry: progress.lastEntryId,
      rounds: progress.rounds,
      active: progress.lastActiveAt,
      flags: JSON.stringify(progress.flags),
    },
  );
}

interface SnapshotRow {
  participant_id: string | null;
  display_name: string;
  finished_at: string | null;
  live_projection_legacy: number;
  rounds: number | null;
  last_active_at: number | null;
  flags: string | null;
}

export async function activityLiveSnapshot(db: Db, activityId: string): Promise<ActivityLive | null> {
  const rows = await all<SnapshotRow>(
    db,
    `SELECT p.id AS participant_id, p.display_name, a.finished_at, a.live_projection_legacy,
            s.rounds, s.last_active_at, s.flags
     FROM activities a
     LEFT JOIN activity_participants p ON p.activity_id = a.id AND p.kind != 'teacher'
     LEFT JOIN activity_live_progress s ON s.activity_id = p.activity_id AND s.participant_id = p.id
     WHERE a.id = $aid ORDER BY p.id`,
    { aid: activityId },
  );
  if (!rows.length) return null;
  const now = Date.now();
  const snapshot: ActivityLive = {
    activityId,
    finishedAt: rows[0].finished_at,
    asOf: new Date(now).toISOString(),
    students: [],
  };
  for (const row of rows) {
    if (row.participant_id === null) continue;
    const rounds = row.rounds ?? (row.live_projection_legacy === 1 ? null : 0);
    const status =
      rounds === null
        ? "unknown"
        : rounds === 0
          ? "not_started"
          : row.last_active_at !== null && now - row.last_active_at < LIVE_ACTIVE_WINDOW_MS
            ? "active"
            : "idle";
    snapshot.students.push({
      id: row.participant_id,
      name: row.display_name,
      status,
      rounds,
      lastActiveAt: row.last_active_at === null ? null : new Date(row.last_active_at).toISOString(),
      flags: row.flags === null ? (rounds === null ? null : []) : StoredFlagsSchema.parse(JSON.parse(row.flags)),
    });
  }
  return snapshot;
}
