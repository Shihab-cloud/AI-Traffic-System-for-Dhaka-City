import type { RoleResponse } from '@/lib/dtos/response/role.res';

/** One rung of the rank ladder: every role sharing a rank, plus the gap below it. */
export interface Rung {
  rank: number;
  roles: RoleResponse[];
  /**
   * Unused rank numbers between this rung and the next one, i.e. how many new
   * roles could slot in directly below without renumbering anything. Always 0 on
   * the last rung — there is no next rung to measure to.
   */
  freeRanks: number;
}

/**
 * Groups roles into ladder rungs by rank, highest first (lowest number first),
 * and measures the gap under each rung.
 *
 * The gap is the point of the screen: the role form tells the user to leave gaps
 * ("10, 20, 30") so future roles can slot in, and this is the only place that
 * advice is ever reflected back. Extracted from the component so the arithmetic
 * is testable without a renderer.
 */
export function computeRungs(roles: readonly RoleResponse[]): Rung[] {
  const groups = new Map<number, RoleResponse[]>();
  for (const role of [...roles].sort((a, b) => a.rank - b.rank)) {
    if (!groups.has(role.rank)) groups.set(role.rank, []);
    groups.get(role.rank)!.push(role);
  }

  const ordered = [...groups.entries()].sort(([a], [b]) => a - b);

  return ordered.map<Rung>(([rank, items], idx) => {
    const nextRank = ordered[idx + 1]?.[0];
    return {
      rank,
      roles: items,
      freeRanks: nextRank === undefined ? 0 : Math.max(0, nextRank - rank - 1),
    };
  });
}
