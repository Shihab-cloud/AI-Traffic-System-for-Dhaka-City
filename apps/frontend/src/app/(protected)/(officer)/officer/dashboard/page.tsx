'use client';

import {
  Box,
  Button,
  Chip,
  InputAdornment,
  MenuItem,
  Paper,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  Tabs,
  TextField,
  Typography,
  alpha,
} from '@mui/material';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';

import PageHeader from '@/components/common/header/PageHeader';
import PageBody from '@/components/common/layout/PageBody';
import StatusChip from '@/components/common/StatusChip';
import CheckViolationDialog from '@/components/traffic/CheckViolationDialog';
import { VIOLATION_CODES, dhakaDateTime, shownPlate } from '@/components/traffic/format';
import StatCard from '@/components/traffic/StatCard';
import { Icons } from '@/lib/icons';
import trafficService from '@/lib/services/traffic.service';
import type { Violation } from '@/lib/types/traffic.types';

const STATUSES = [
  { value: 'new', label: 'To check' },
  { value: 'ticketed', label: 'Ticketed' },
  { value: 'dismissed', label: 'Dismissed' },
  { value: 'all', label: 'All' },
];
/** Rows that arrived within this many ms are highlighted, like an unread notification. */
const FRESH_MS = 90_000;

function PlateCell({ v }: { v: Violation }) {
  const p = shownPlate(v);
  return (
    <Stack spacing={0.25} sx={{ alignItems: 'flex-start' }}>
      <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 600 }}>
        {p.text || '-'}
      </Typography>
      {p.status !== 'set' && <StatusChip status={p.status} />}
    </Stack>
  );
}

export default function OfficerDashboardPage() {
  const [status, setStatus] = useState('new');
  const [code, setCode] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [limit, setLimit] = useState(20);
  const [openId, setOpenId] = useState<string | null>(null);

  const summary = useQuery({
    queryKey: ['traffic.violationSummary'],
    queryFn: () => trafficService.violationSummary(),
    refetchInterval: 5000,
  });
  const list = useQuery({
    queryKey: ['traffic.violations', status, code, search, page, limit],
    queryFn: () =>
      trafficService.violations({
        status,
        code: code || undefined,
        search: search || undefined,
        page: page + 1,
        limit,
      }),
    placeholderData: keepPreviousData,
    refetchInterval: 5000,
  });

  // A toast when new violations arrive while the page is open.
  const lastNew = useRef<number | null>(null);
  useEffect(() => {
    const n = summary.data?.new;
    if (n == null) return;
    if (lastNew.current != null && n > lastNew.current) {
      toast(`${n - lastNew.current} new violation${n - lastNew.current > 1 ? 's' : ''} to check`, {
        icon: '🚨',
      });
    }
    lastNew.current = n;
  }, [summary.data?.new]);

  const s = summary.data;
  const rows = list.data?.docs ?? [];
  const fetchedAt = list.dataUpdatedAt;

  return (
    <>
      <PageHeader
        title="Violations"
        subtitle="Detected by the cameras. Check each one, then send a ticket to the vehicle owner or dismiss it."
        icon={Icons.dashboard}
        rightSlot={
          <Chip
            size="small"
            color="success"
            variant="outlined"
            label={list.isFetching ? 'Updating...' : 'Live: refreshes every 5 s'}
          />
        }
      />
      <PageBody>
        <Box
          sx={{
            display: 'grid',
            gap: 2,
            gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' },
            mb: 3,
          }}
        >
          <StatCard label="To check" value={s?.new ?? '-'} icon={Icons.violation} tone="warning" />
          <StatCard
            label="Detected, last 24 h"
            value={s?.last24h ?? '-'}
            icon={Icons.time}
            tone="info"
          />
          <StatCard
            label="Tickets sent"
            value={s?.ticketed ?? '-'}
            icon={Icons.emailSent}
            tone="success"
          />
          <StatCard label="Dismissed" value={s?.dismissed ?? '-'} icon={Icons.ban} tone="primary" />
        </Box>

        <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            spacing={2}
            sx={{
              px: 2,
              pt: 1,
              pb: 1.5,
              alignItems: { md: 'center' },
              borderBottom: 1,
              borderColor: 'divider',
            }}
          >
            <Tabs
              value={status}
              onChange={(_, v: string) => {
                setStatus(v);
                setPage(0);
              }}
              sx={{ flex: 1, minHeight: 40 }}
            >
              {STATUSES.map((t) => (
                <Tab
                  key={t.value}
                  value={t.value}
                  sx={{ minHeight: 40 }}
                  label={
                    t.value === 'new' && s?.new ? (
                      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                        <span>{t.label}</span>
                        <Chip size="small" color="warning" label={s.new} />
                      </Stack>
                    ) : (
                      t.label
                    )
                  }
                />
              ))}
            </Tabs>
            <TextField
              select
              size="small"
              label="Type"
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                setPage(0);
              }}
              sx={{ minWidth: 220 }}
            >
              <MenuItem value="">All types</MenuItem>
              {Object.entries(VIOLATION_CODES).map(([c, t]) => (
                <MenuItem key={c} value={c}>
                  {c} {t}
                  {s?.newByCode?.[c] ? ` (${s.newByCode[c]} new)` : ''}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              size="small"
              placeholder="Plate or class"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <Icons.search />
                    </InputAdornment>
                  ),
                },
              }}
            />
          </Stack>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Vehicle ID</TableCell>
                  <TableCell>Registration plate</TableCell>
                  <TableCell>Violation type</TableCell>
                  <TableCell>Time &amp; date</TableCell>
                  <TableCell>Camera</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell align="right" />
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((v) => {
                  const fresh =
                    fetchedAt - new Date(v.createdAt).getTime() < FRESH_MS && v.status === 'new';
                  return (
                    <TableRow
                      key={v.id}
                      hover
                      sx={{
                        bgcolor: (t) => (fresh ? alpha(t.palette.warning.main, 0.08) : undefined),
                      }}
                    >
                      <TableCell>
                        <Typography variant="body2" sx={{ fontWeight: 600, fontFamily: v.vid ? 'monospace' : undefined }}>
                          {v.vid || `#${v.trackId}`}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {v.vehicleClass}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <PlateCell v={v} />
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">
                          <b>{v.code}</b> {v.title}
                        </Typography>
                        {v.code === 'V2' && v.kph != null && v.limitKph != null && (
                          <Typography variant="caption" color="error.main">
                            {v.avgKph ?? v.kph} km/h in a {v.limitKph} km/h zone
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>
                        {dhakaDateTime(v.occurredAt)}
                      </TableCell>
                      <TableCell>{v.cameraName || '-'}</TableCell>
                      <TableCell>
                        <Stack direction="row" spacing={0.5}>
                          <StatusChip status={v.status} />
                          {fresh && <Chip size="small" color="warning" label="Just in" />}
                        </Stack>
                      </TableCell>
                      <TableCell align="right">
                        <Button
                          size="small"
                          variant={v.status === 'new' ? 'contained' : 'outlined'}
                          startIcon={<Icons.check />}
                          onClick={() => setOpenId(v.id)}
                        >
                          Check
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {!rows.length && (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      sx={{ py: 6, textAlign: 'center', color: 'text.secondary' }}
                    >
                      {list.isLoading
                        ? 'Loading...'
                        : status === 'new'
                          ? 'Nothing to check. New violations appear here as the cameras find them.'
                          : 'No violations.'}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
          <TablePagination
            component="div"
            count={list.data?.totalDocs ?? 0}
            page={page}
            onPageChange={(_, p) => setPage(p)}
            rowsPerPage={limit}
            onRowsPerPageChange={(e) => {
              setLimit(Number(e.target.value));
              setPage(0);
            }}
            rowsPerPageOptions={[10, 20, 50, 100]}
          />
        </Paper>
      </PageBody>
      <CheckViolationDialog key={openId ?? 'none'} id={openId} onClose={() => setOpenId(null)} />
    </>
  );
}
