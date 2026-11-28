export const normalizeJoinCode = (raw: string) => raw.trim().toLowerCase().replace(/\s+/g, "");

export type JoinTarget =
  | { to: "/join/$code"; params: { code: string } }
  | { to: "/join/i/$token"; params: { token: string } }
  | { to: "/join/a/$token"; params: { token: string } };

const SCOPED_JOIN_PATH = /^\/?join\/(i|a)\/([^/?#]+)\/?$/i;
const DIRECT_JOIN_PATH = /^\/?join\/([^/?#]+)\/?$/i;

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export function parseJoinTarget(raw: string): JoinTarget | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  let path = trimmed;
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      path = new URL(trimmed).pathname;
    } catch {
      return null;
    }
  } else if (/^[^/\s]+\/join\//i.test(trimmed)) {
    try {
      path = new URL(`https://${trimmed}`).pathname;
    } catch {
      path = trimmed.split(/[?#]/, 1)[0] ?? trimmed;
    }
  } else {
    path = trimmed.split(/[?#]/, 1)[0] ?? trimmed;
  }

  const scoped = SCOPED_JOIN_PATH.exec(path);
  if (scoped) {
    const kind = scoped[1]?.toLowerCase();
    const token = normalizeJoinCode(decodeSegment(scoped[2] ?? ""));
    if (token) {
      return kind === "i" ? { to: "/join/i/$token", params: { token } } : { to: "/join/a/$token", params: { token } };
    }
  }

  const direct = DIRECT_JOIN_PATH.exec(path);
  if (direct) {
    const code = normalizeJoinCode(decodeSegment(direct[1] ?? ""));
    return code ? { to: "/join/$code", params: { code } } : null;
  }

  const code = normalizeJoinCode(trimmed);
  return code ? { to: "/join/$code", params: { code } } : null;
}
