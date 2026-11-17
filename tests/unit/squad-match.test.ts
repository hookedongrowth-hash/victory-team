import { describe, expect, it } from 'vitest';
import { assignTeammates, validateReview } from '../../src/squad-match';

const squad = Array.from({ length: 11 }, (_, i) => ({ id: `id-${String(i).padStart(2, '0')}`, name: `P${i}` }));

describe('assignTeammates', () => {
  it('gives nobody herself, and everybody exactly one giver', () => {
    for (const date of ['2026-11-14', '2026-11-21', '2027-03-06']) {
      const map = assignTeammates(squad, date);
      expect(map.size).toBe(squad.length);
      const received = new Map<string, number>();
      for (const [from, to] of map) {
        expect(to.id).not.toBe(from);
        received.set(to.id, (received.get(to.id) ?? 0) + 1);
      }
      expect([...received.values()].every((n) => n === 1)).toBe(true);
    }
  });
  it('is stable for a date and varies between dates', () => {
    const a = assignTeammates(squad, '2026-11-14').get('id-00')!.id;
    expect(assignTeammates(squad, '2026-11-14').get('id-00')!.id).toBe(a);
    const seen = new Set(['2026-11-14', '2026-11-21', '2026-11-28', '2026-12-05'].map((d) => assignTeammates(squad, d).get('id-00')!.id));
    expect(seen.size).toBeGreaterThan(1);
  });
  it('handles a tiny squad', () => {
    expect(assignTeammates([], '2026-11-14').size).toBe(0);
    expect(assignTeammates([squad[0]], '2026-11-14').size).toBe(0);
  });
});

describe('validateReview', () => {
  it('needs a score and both written answers', () => {
    expect(validateReview({ rating: 0, wentWell: 'a', workOn: 'b' }).errors).toEqual(['rating']);
    expect(validateReview({ rating: 3, wentWell: ' ', workOn: '' }).errors).toEqual(['wentWell', 'workOn']);
    expect(validateReview({ rating: 3, wentWell: 'a', workOn: 'b' }).ok).toBe(true);
  });
  it('needs the kind word when a teammate was given', () => {
    expect(validateReview({ rating: 3, wentWell: 'a', workOn: 'b', teammateId: 'x', teammateNote: '' }).errors).toEqual(['teammateNote']);
  });
});
