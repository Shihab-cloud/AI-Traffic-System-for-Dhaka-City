'use client';

import {
  InputAdornment,
  Paper,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TablePagination,
  TableRow,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import PageHeader from '@/components/common/header/PageHeader';
import PageBody from '@/components/common/layout/PageBody';
import StatusChip from '@/components/common/StatusChip';
import CaseDialog from '@/components/traffic/CaseDialog';
import { dhakaDate, dhakaDateTime, money } from '@/components/traffic/format';
import { Icons } from '@/lib/icons';
import trafficService from '@/lib/services/traffic.service';

export default function CasesPage() {
  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ['traffic.cases', status, search, page],
    queryFn: () => trafficService.cases({ status, search: search || undefined, page: page + 1, limit: 20 }),
    placeholderData: keepPreviousData,
  });
  return (
    <>
      <PageHeader title="Tickets" subtitle="Every ticket sent to a vehicle owner, and where it stands." icon={Icons.cases} />
      <PageBody>
        <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ px: 2, py: 1, borderBottom: 1, borderColor: 'divider' }}>
            <Tabs
              value={status}
              onChange={(_, v) => {
                setStatus(v);
                setPage(0);
              }}
              sx={{ flex: 1 }}
            >
              <Tab value="all" label="All" />
              <Tab value="unpaid" label="Unpaid" />
              <Tab value="under_review" label="Under review" />
              <Tab value="paid" label="Paid" />
              <Tab value="cancelled" label="Cancelled" />
            </Tabs>
            <TextField
              size="small"
              placeholder="Case number, plate, owner"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
              slotProps={{ input: { startAdornment: <InputAdornment position="start"><Icons.search /></InputAdornment> } }}
            />
          </Stack>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Case</TableCell>
                <TableCell>Registration</TableCell>
                <TableCell>Owner</TableCell>
                <TableCell>Violation</TableCell>
                <TableCell>Fine</TableCell>
                <TableCell>Issued</TableCell>
                <TableCell>Due</TableCell>
                <TableCell>Status</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(list.data?.docs ?? []).map((c) => {
                return (
                  <TableRow key={c.id} hover sx={{ cursor: 'pointer' }} onClick={() => setOpenId(c.id)}>
                    <TableCell sx={{ fontWeight: 600 }}>{c.caseNumber}</TableCell>
                    <TableCell sx={{ fontFamily: 'monospace' }}>{c.registration}</TableCell>
                    <TableCell>
                      {c.ownerName}
                      <Typography variant="caption" color="text.secondary" component="div">
                        {c.ownerEmail}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      {c.code} {c.title}
                    </TableCell>
                    <TableCell>{money(c.amount, c.currency)}</TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{dhakaDateTime(c.issuedAt)}</TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{dhakaDate(c.dueDate)}</TableCell>
                    <TableCell>
                      <StatusChip status={c.overdue ? 'overdue' : c.status} />
                    </TableCell>
                  </TableRow>
                );
              })}
              {!list.data?.docs.length && (
                <TableRow>
                  <TableCell colSpan={8} sx={{ textAlign: 'center', py: 5, color: 'text.secondary' }}>
                    {list.isLoading ? 'Loading...' : 'No tickets.'}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          <TablePagination
            component="div"
            count={list.data?.totalDocs ?? 0}
            page={page}
            onPageChange={(_, p) => setPage(p)}
            rowsPerPage={20}
            rowsPerPageOptions={[20]}
          />
        </Paper>
      </PageBody>
      <CaseDialog id={openId} onClose={() => setOpenId(null)} />
    </>
  );
}
