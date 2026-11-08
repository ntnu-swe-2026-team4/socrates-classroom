const TERM_KEY = "socrates_terms";
const ACTIVITY_KEY = "socrates_activity";

export interface TermQuery {
  term: string;
  at: string;
}

export function readTermHistory(): TermQuery[] {
  try {
    const raw = localStorage.getItem(TERM_KEY);
    return raw ? (JSON.parse(raw) as TermQuery[]) : [];
  } catch {
    return [];
  }
}

export function recordTerm(term: string): TermQuery[] {
  const history = [
    { term, at: new Date().toISOString() },
    ...readTermHistory().filter((query) => query.term !== term),
  ].slice(0, 30);
  try {
    localStorage.setItem(TERM_KEY, JSON.stringify(history));
  } catch {}
  return history;
}

export function readActivityId(): string | null {
  try {
    return localStorage.getItem(ACTIVITY_KEY);
  } catch {
    return null;
  }
}

export function persistActivityId(id: string): void {
  try {
    localStorage.setItem(ACTIVITY_KEY, id);
  } catch {}
}
