import { describe, expect, it } from 'vitest';

import type { RoleResponse } from '@/lib/dtos/response/role.res';

import { computeRungs } from './roleTree.util';

const role = (id: string, rank: number) => ({ id, rank }) as unknown as RoleResponse;

describe('computeRungs', () => {
  it('returns one rung per distinct rank, lowest number first', () => {
    const rungs = computeRungs([role('c', 20), role('a', 0), role('b', 10)]);
    expect(rungs.map((r) => r.rank)).toEqual([0, 10, 20]);
    expect(rungs.map((r) => r.roles.map((x) => x.id))).toEqual([['a'], ['b'], ['c']]);
  });

  it('puts roles that share a rank on the same rung', () => {
    const rungs = computeRungs([role('a', 10), role('b', 10), role('c', 20)]);
    expect(rungs).toHaveLength(2);
    expect(rungs[0].roles.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('counts the unused rank numbers between consecutive rungs', () => {
    const rungs = computeRungs([role('a', 0), role('b', 10), role('c', 11)]);
    expect(rungs.map((r) => r.freeRanks)).toEqual([9, 0, 0]);
  });

  it('reports zero free ranks on the last rung — there is no next rung to measure to', () => {
    const rungs = computeRungs([role('a', 0), role('b', 5)]);
    expect(rungs[rungs.length - 1].freeRanks).toBe(0);
  });

  it('never reports a negative gap for adjacent ranks', () => {
    const rungs = computeRungs([role('a', 3), role('b', 4)]);
    expect(rungs.map((r) => r.freeRanks)).toEqual([0, 0]);
  });

  it('handles a single role and an empty list', () => {
    expect(computeRungs([role('a', 7)])).toEqual([
      { rank: 7, roles: [expect.objectContaining({ id: 'a' })], freeRanks: 0 },
    ]);
    expect(computeRungs([])).toEqual([]);
  });

  it('does not mutate the input array order', () => {
    const roles = [role('c', 20), role('a', 0)];
    computeRungs(roles);
    expect(roles.map((r) => r.id)).toEqual(['c', 'a']);
  });
});
