'use client';

import { Box, Stack, Tooltip, Typography } from '@mui/material';

/**
 * Small single-series charts in plain HTML (no chart library). One series = one colour (the theme's primary) and
 * no legend: the card title names what is plotted. Columns are capped at 24px with a 4px rounded data end and a
 * square baseline; gridlines are hairlines; every mark has a hover tooltip; text uses text colours, never the mark's.
 */

/** Clean axis maximum and ticks: 0, 1/4, 1/2, 3/4, max (max rounded to 1/2/5 x 10^n). */
function niceTicks(max: number) {
  if (max <= 0) return { top: 4, ticks: [0, 1, 2, 3, 4] };
  const raw = max / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? raw;
  const nice = Math.max(1, step >= 1 ? Math.ceil(step) : step);
  return { top: nice * 4, ticks: [0, 1, 2, 3, 4].map((i) => i * nice) };
}

export function compact(n: number) {
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(n % 1e6 ? 1 : 0)}M`;
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(n % 1e3 ? 1 : 0)}K`;
  return String(Math.round(n * 10) / 10);
}

export function ColumnChart({
  data,
  height = 200,
  format = (v: number) => String(v),
  tooltipLabel,
}: {
  data: { label: string; value: number }[];
  height?: number;
  format?: (v: number) => string;
  tooltipLabel?: (d: { label: string; value: number }) => string;
}) {
  const { top, ticks } = niceTicks(Math.max(0, ...data.map((d) => d.value)));
  const every = Math.max(1, Math.ceil(data.length / 7));
  const peak = data.reduce((best, d, i) => (d.value > data[best].value ? i : best), 0);
  return (
    <Box sx={{ display: 'flex', gap: 1 }}>
      {/* y axis */}
      <Box sx={{ position: 'relative', height, width: 36, flex: '0 0 auto' }}>
        {ticks.map((t) => (
          <Typography
            key={t}
            variant="caption"
            color="text.secondary"
            sx={{ position: 'absolute', right: 0, bottom: `${(t / top) * 100}%`, transform: 'translateY(50%)', lineHeight: 1 }}
          >
            {compact(t)}
          </Typography>
        ))}
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box sx={{ position: 'relative', height }}>
          {ticks.map((t) => (
            <Box
              key={t}
              sx={{ position: 'absolute', left: 0, right: 0, bottom: `${(t / top) * 100}%`, borderTop: 1, borderColor: 'divider' }}
            />
          ))}
          <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'flex-end', gap: '2px' }}>
            {data.map((d, i) => (
              <Tooltip key={d.label} title={tooltipLabel ? tooltipLabel(d) : `${d.label}: ${format(d.value)}`} placement="top" arrow>
                <Box
                  tabIndex={0}
                  sx={{ flex: 1, height: '100%', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', cursor: 'default', outline: 'none' }}
                >
                  <Box
                    sx={{
                      position: 'relative',
                      width: '100%',
                      maxWidth: 24,
                      height: `${(d.value / top) * 100}%`,
                      minHeight: d.value > 0 ? 2 : 0,
                      bgcolor: 'primary.main',
                      borderRadius: '4px 4px 0 0',
                      transition: 'opacity .15s',
                      '*:hover > &, *:focus-visible > &': { opacity: 0.75 },
                    }}
                  >
                    {i === peak && d.value > 0 && (
                      <Typography
                        variant="caption"
                        color="text.primary"
                        sx={{ position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)', fontWeight: 600, whiteSpace: 'nowrap' }}
                      >
                        {format(d.value)}
                      </Typography>
                    )}
                  </Box>
                </Box>
              </Tooltip>
            ))}
          </Box>
        </Box>
        <Box sx={{ display: 'flex', gap: '2px', mt: 0.5 }}>
          {data.map((d, i) => (
            <Typography
              key={d.label}
              variant="caption"
              color="text.secondary"
              sx={{ flex: 1, textAlign: 'center', whiteSpace: 'nowrap', overflow: 'visible', visibility: i % every === 0 ? 'visible' : 'hidden', fontSize: 11 }}
            >
              {d.label}
            </Typography>
          ))}
        </Box>
      </Box>
    </Box>
  );
}

/** Ranked horizontal bars: label, bar, value at the tip. Doubles as the table view (every value is printed). */
export function BarList({
  rows,
  format = (v: number) => String(v),
  empty = 'No data',
}: {
  rows: { key: string; label: string; value: number; hint?: string }[];
  format?: (v: number) => string;
  empty?: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
        {empty}
      </Typography>
    );
  }
  return (
    <Stack spacing={1}>
      {rows.map((r) => (
        <Tooltip key={r.key} title={`${r.label}: ${format(r.value)}${r.hint ? ` (${r.hint})` : ''}`} placement="top-start">
          <Box tabIndex={0} sx={{ outline: 'none' }}>
            <Stack direction="row" sx={{ justifyContent: 'space-between', mb: 0.25 }}>
              <Typography variant="body2" noWrap sx={{ minWidth: 0, pr: 1 }}>
                {r.label}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                {format(r.value)}
              </Typography>
            </Stack>
            <Box sx={{ height: 8, borderRadius: '0 4px 4px 0', bgcolor: 'action.hover' }}>
              <Box
                sx={{
                  height: '100%',
                  width: `${(r.value / max) * 100}%`,
                  minWidth: r.value > 0 ? 2 : 0,
                  bgcolor: 'primary.main',
                  borderRadius: '0 4px 4px 0',
                }}
              />
            </Box>
          </Box>
        </Tooltip>
      ))}
    </Stack>
  );
}
