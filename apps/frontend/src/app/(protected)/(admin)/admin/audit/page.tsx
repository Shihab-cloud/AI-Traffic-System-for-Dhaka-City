'use client';

import {
  Box,
  Chip,
  InputAdornment,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import PageHeader from '@/components/common/header/PageHeader';
import PageBody from '@/components/common/layout/PageBody';
import { dhakaDateTime } from '@/components/traffic/format';
import { Icons } from '@/lib/icons';
import trafficService from '@/lib/services/traffic.service';

export default function AuditPage() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const list = useQuery({
    queryKey: ['traffic.audit', search, page],
    queryFn: () => trafficService.audit({ search: search || undefined, page: page + 1, limit: 30 }),
    placeholderData: keepPreviousData,
  });
  return (
    <>
      <PageHeader
        title="Audit log"
        subtitle="Who did what: tickets, dismissals, plate corrections, reviews, payments, camera and fine changes, searches."
        icon={Icons.audit}
      />
      <PageBody>
        <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
          <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider' }}>
            <TextField
              size="small"
              placeholder="Action, person, record"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
              slotProps={{ input: { startAdornment: <InputAdornment position="start"><Icons.search /></InputAdornment> } }}
              sx={{ minWidth: 320 }}
            />
          </Box>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>When</TableCell>
                <TableCell>Who</TableCell>
                <TableCell>Action</TableCell>
                <TableCell>What</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(list.data?.docs ?? []).map((a) => (
                <TableRow key={a.id}>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{dhakaDateTime(a.createdAt)}</TableCell>
                  <TableCell>
                    {a.actorEmail || 'system'}
                    <Typography variant="caption" color="text.secondary" component="div">
                      {a.actorRole}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Chip size="small" variant="outlined" label={a.action} />
                  </TableCell>
                  <TableCell>{a.summary}</TableCell>
                </TableRow>
              ))}
              {!list.data?.docs.length && (
                <TableRow>
                  <TableCell colSpan={4} sx={{ textAlign: 'center', py: 5, color: 'text.secondary' }}>
                    {list.isLoading ? 'Loading...' : 'Nothing logged yet.'}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          <TablePagination component="div" count={list.data?.totalDocs ?? 0} page={page} onPageChange={(_, p) => setPage(p)} rowsPerPage={30} rowsPerPageOptions={[30]} />
        </Paper>
      </PageBody>
    </>
  );
}
