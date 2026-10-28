'use client';

import { Box, Chip, Typography } from '@mui/material';
import { useMemo } from 'react';

import { RoleResponse } from '@/lib/dtos/response/role.res';

import RoleItem from './RoleItem';
import { computeRungs } from './roleTree.util';

interface RoleTreeProps {
  roles: RoleResponse[];
  onEdit: (role: RoleResponse) => void;
}

const NODE_SIZE = 32;
// Preferred card floor. Used inside `minmax(min(CARD_MIN_WIDTH, 100%), 1fr)` —
// a bare pixel floor is a hard lower bound in CSS Grid, and the rail, the
// rail/content gap, the page's own padding and MainLayout's content margins all
// eat into the viewport before this grid ever sees it, so a bare 320px floor
// still overflows a 375px-wide screen. `min(…, 100%)` lets the track shrink
// below the preferred width once the container is narrower than that.
const CARD_MIN_WIDTH = 320;

/**
 * Rank is a flat ordering, not a parent/child hierarchy — so this renders a
 * **ladder** (one rung per distinct rank, highest first) rather than an org
 * chart. The previous version drew connectors and sibling brackets, which
 * asserted a relationship the data does not have, and sized each card at a fixed
 * 380px in a centred row, so three roles at one rank forced the whole tree to
 * scroll sideways.
 *
 * The rail segment goes dashed where a rank gap exists, and the rung says how
 * many ranks are free below it: that is the one thing this screen can teach that
 * the flat role list cannot.
 */
export default function RoleTree({ roles, onEdit }: RoleTreeProps) {
  const rungs = useMemo(() => computeRungs(roles), [roles]);

  return (
    <div className="flex flex-col">
      {rungs.map((rung, idx) => {
        const isTop = idx === 0;
        const isLast = idx === rungs.length - 1;

        return (
          <div key={rung.rank} className="flex gap-3 sm:gap-4">
            {/* Rail: node for this rank, then the segment down to the next rung */}
            <Box
              aria-hidden
              sx={{
                flex: '0 0 auto',
                width: NODE_SIZE,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
              }}
            >
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: NODE_SIZE,
                  height: NODE_SIZE,
                  flex: '0 0 auto',
                  borderRadius: '50%',
                  border: 2,
                  borderColor: isTop ? 'primary.main' : 'divider',
                  color: isTop ? 'primary.main' : 'text.secondary',
                  bgcolor: 'background.paper',
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {rung.rank}
              </Box>

              {!isLast && (
                <Box
                  sx={{
                    flex: 1,
                    minHeight: 24,
                    borderLeft: 2,
                    // Dashed where ranks are free below, solid where the next rung
                    // is the very next number.
                    borderLeftStyle: rung.freeRanks > 0 ? 'dashed' : 'solid',
                    borderColor: 'divider',
                  }}
                />
              )}
            </Box>

            <div className={`min-w-0 flex-1 ${isLast ? '' : 'pb-6'}`}>
              <div className="mb-2 flex min-h-8 flex-wrap items-center gap-2">
                <Typography
                  variant="caption"
                  color={isTop ? 'primary' : 'text.secondary'}
                  sx={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}
                >
                  Rank {rung.rank}
                </Typography>

                {isTop && (
                  <Chip
                    size="small"
                    label="Highest"
                    color="primary"
                    variant="outlined"
                    sx={{ fontWeight: 600, fontSize: '0.7rem', height: 22 }}
                  />
                )}

                {rung.roles.length > 1 && (
                  <Chip
                    size="small"
                    label={`${rung.roles.length} roles share this rank`}
                    variant="outlined"
                    sx={{ fontWeight: 500, fontSize: '0.7rem', height: 22 }}
                  />
                )}
              </div>

              {/* auto-fill grid, so a shared rung wraps instead of scrolling sideways */}
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: `repeat(auto-fill, minmax(min(${CARD_MIN_WIDTH}px, 100%), 1fr))`,
                  gap: 2,
                }}
              >
                {rung.roles.map((role) => (
                  <RoleItem key={role.id} role={role} onEdit={onEdit} />
                ))}
              </Box>

              {rung.freeRanks > 0 && (
                <Typography
                  variant="caption"
                  color="text.disabled"
                  sx={{ display: 'block', mt: 1.5, fontStyle: 'italic' }}
                >
                  {rung.freeRanks} rank{rung.freeRanks === 1 ? '' : 's'} free below — room for a new
                  role here
                </Typography>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
