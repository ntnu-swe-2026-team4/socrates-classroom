import { DurableObject } from "cloudflare:workers";
import type { ActivitySseEvent, StudentLive } from "@socrates/shared";
import type { Env } from "../env";
import { all, one } from "../db/d1";

const RING_CAP = 200;

interface RingEntry {
  id: number;
  frame: string;
}

type Listener = (frame: string) => void;

export class ActivityEvents extends DurableObject<Env> {
  private listeners = new Map<number, Listener>();
  private cleanups = new Map<number, () => void>();
  private seq = 0;
  private ring: RingEntry[] = [];
  private loaded = false;
  private nextListenerId = 1;

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    const [seq, ring] = await Promise.all([
      this.ctx.storage.get<number>("seq"),
      this.ctx.storage.get<RingEntry[]>("ring"),
    ]);
    this.seq = seq ?? 0;
    this.ring = ring ?? [];
    this.loaded = true;
  }

  private frame(event: ActivitySseEvent, id: number): string {
    return `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\nid: ${id}\n\n`;
  }

  async stream(sinceId: number): Promise<Response> {
    await this.ensureLoaded();
    const encoder = new TextEncoder();
    let closed = false;
    const id = this.nextListenerId++;
    const body = new ReadableStream<Uint8Array>({
      start: (controller) => {
        const write = (text: string) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(text));
          } catch {
            closed = true;
          }
        };
        this.listeners.set(id, write);
        const ping = setInterval(() => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(": ping\n\n"));
          } catch {}
        }, 15_000);
        this.cleanups.set(id, () => clearInterval(ping));
        void (async () => {
          try {
            const snapshot = await this.snapshot(this.ctx.id.name ?? "");
            write(this.frame({ event: "live", data: snapshot, id: this.seq }, this.seq));
            for (const entry of this.ring) {
              if (entry.id > sinceId) write(entry.frame);
            }
          } catch {}
        })();
      },
      cancel: () => {
        closed = true;
        this.listeners.delete(id);
        this.cleanups.get(id)?.();
        this.cleanups.delete(id);
      },
    });
    return new Response(body, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  }

  async publish(event: ActivitySseEvent): Promise<void> {
    await this.ensureLoaded();
    this.seq += 1;
    const frame = this.frame(event, this.seq);
    this.ring.push({ id: this.seq, frame });
    if (this.ring.length > RING_CAP) this.ring = this.ring.slice(-RING_CAP);
    void this.ctx.storage.put("ring", this.ring);
    void this.ctx.storage.put("seq", this.seq);
    for (const [lid, write] of [...this.listeners.entries()]) {
      try {
        write(frame);
      } catch {
        this.listeners.delete(lid);
        this.cleanups.get(lid)?.();
        this.cleanups.delete(lid);
      }
    }
  }

  async publishUpdate(student: StudentLive): Promise<void> {
    await this.publish({ event: "update", data: student });
  }

  async publishViolation(data: { studentId: string; turn: number; type: string; excerpt: string }): Promise<void> {
    await this.publish({ event: "violation", data });
  }

  async currentSeq(): Promise<number> {
    await this.ensureLoaded();
    return this.seq;
  }

  async snapshot(activityId: string): Promise<StudentLive[]> {
    const db = this.env.DB;
    const activity = await one<{ classroom_id: string }>(db, "SELECT classroom_id FROM activities WHERE id = $id", {
      id: activityId,
    });
    if (!activity) return [];
    const members = await all<{ user_id: string; name: string }>(
      db,
      `SELECT user_id, name FROM members WHERE classroom_id = $cid ORDER BY joined_at, user_id`,
      { cid: activity.classroom_id },
    );
    const rows = await all<{
      user_id: string;
      rounds: number;
      last_user: string | null;
      last_at: string | null;
    }>(
      db,
      `SELECT m.user_id,
              (SELECT COUNT(*) FROM messages msg WHERE msg.activity_id = $aid AND msg.student_id = m.user_id AND msg.role = 'user') AS rounds,
              (SELECT lu.text FROM messages lu WHERE lu.activity_id = $aid AND lu.student_id = m.user_id AND lu.role = 'user' ORDER BY lu.at DESC, lu.rowid DESC LIMIT 1) AS last_user,
              (SELECT la.at FROM messages la WHERE la.activity_id = $aid AND la.student_id = m.user_id ORDER BY la.at DESC, la.rowid DESC LIMIT 1) AS last_at
       FROM members m WHERE m.classroom_id = $cid ORDER BY m.joined_at, m.user_id`,
      { aid: activityId, cid: activity.classroom_id },
    );
    const byStudent = new Map(rows.map((row) => [row.user_id, row]));
    const flagged = await all<{ student_id: string; type: string }>(
      db,
      "SELECT student_id, type FROM violations WHERE activity_id = $aid ORDER BY created_at DESC",
      { aid: activityId },
    );
    const flaggedBy = new Map<string, string>();
    for (const row of flagged) {
      if (!flaggedBy.has(row.student_id)) flaggedBy.set(row.student_id, row.type);
    }
    const now = Date.now();
    const result: StudentLive[] = [];
    for (const member of members) {
      const row = byStudent.get(member.user_id);
      const lastAt = row?.last_at ? Date.parse(row.last_at) : 0;
      const idleMs = now - lastAt;
      result.push({
        id: member.user_id,
        name: member.name,
        status: !row ? "idle" : idleMs < 90_000 ? "active" : "idle",
        rounds: row?.rounds ?? 0,
        flagged: flaggedBy.has(member.user_id),
        flagReason: flaggedBy.get(member.user_id),
        lastUtterance: row?.last_user?.slice(0, 80) ?? "",
      });
    }
    return result.sort((a, b) => Number(b.flagged) - Number(a.flagged) || b.rounds - a.rounds);
  }
}
