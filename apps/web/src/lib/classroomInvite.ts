import type { ClassroomInviteScope } from "@socrates/shared";

export const inviteScopeLabels = {
  classroom: "room_invite_classroom",
  activity_guest: "room_invite_guest",
  classroom_activity: "room_invite_classroom_activity",
} as const satisfies Record<ClassroomInviteScope, string>;

const pendingInviteKey = "socrates:classroom-invite-return";
const invitePath = /^\/join\/i\/[a-f0-9]{32}$/;

export function rememberClassroomInvite(next: string) {
  try {
    if (invitePath.test(next)) {
      sessionStorage.setItem(pendingInviteKey, JSON.stringify({ next, expiresAt: Date.now() + 15 * 60_000 }));
    } else {
      sessionStorage.removeItem(pendingInviteKey);
    }
  } catch {
    return;
  }
}

export function takeClassroomInvite(): string | undefined {
  try {
    const raw = sessionStorage.getItem(pendingInviteKey);
    if (!raw) return undefined;
    sessionStorage.removeItem(pendingInviteKey);
    const saved = JSON.parse(raw) as { next?: unknown; expiresAt?: unknown };
    if (
      typeof saved.next === "string" &&
      invitePath.test(saved.next) &&
      typeof saved.expiresAt === "number" &&
      saved.expiresAt > Date.now()
    ) {
      return saved.next;
    }
  } catch {
    return undefined;
  }
  return undefined;
}
