// Who each player is asked to say something good about, and whether a review
// is ready to send. Pure functions. Carried over from the Dragons app.

export interface Person { id: string; name: string }

/**
 * A cyclic shift of the sorted squad, with the offset taken from the match date.
 * Nobody gets herself, everybody gives once, and everybody receives once, so
 * nobody is left out. The same date always gives the same pairing.
 */
export function assignTeammates(squad: Person[], matchDate: string): Map<string, Person> {
  const out = new Map<string, Person>();
  const list = (squad ?? []).filter((p) => p && p.id);
  const n = list.length;
  if (n < 2) return out;
  const sorted = [...list].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const shift = 1 + (dateSeed(matchDate) % (n - 1));
  sorted.forEach((p, i) => out.set(p.id, sorted[(i + shift) % n]));
  return out;
}

export function dateSeed(matchDate: string): number {
  const s = String(matchDate ?? '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

export interface ReviewInput {
  rating: number; wentWell: string; workOn: string;
  teammateId?: string | null; teammateNote?: string;
}

/** Names the first thing missing, so the screen can point at it. */
export function validateReview(r: ReviewInput): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!Number.isInteger(Number(r.rating)) || r.rating < 1 || r.rating > 5) errors.push('rating');
  if (!String(r.wentWell ?? '').trim()) errors.push('wentWell');
  if (!String(r.workOn ?? '').trim()) errors.push('workOn');
  if (r.teammateId && !String(r.teammateNote ?? '').trim()) errors.push('teammateNote');
  return { ok: errors.length === 0, errors };
}

export const OPPONENTS = [
  'Antwerp', 'Beerschot', 'Braxgata', 'Dragons', 'Gantoise', 'Leopold',
  'Leuven', 'Racing', 'Uccle Sport', 'Waterloo Ducks', 'Wellington',
];
