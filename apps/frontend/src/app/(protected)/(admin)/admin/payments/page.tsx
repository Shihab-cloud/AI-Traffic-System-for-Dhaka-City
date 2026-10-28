'use client';

import {
  IconButton,
  Paper,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TablePagination,
  TableRow,
  Tabs,
  Tooltip,
  Typography,
} from '@mui/material';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import PageHeader from '@/components/common/header/PageHeader';
import PageBody from '@/components/common/layout/PageBody';
import StatusChip from '@/components/common/StatusChip';
import { dhakaDateTime, money } from '@/components/traffic/format';
import { Icons } from '@/lib/icons';
import trafficService from '@/lib/services/traffic.service';

export default function PaymentsPage() {
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(0);
  const list = useQuery({
    queryKey: ['traffic.payments', status, page],
    queryFn: () => trafficService.payments({ status, page: page + 1, limit: 25 }),
    placeholderData: keepPreviousData,
  });
  return (
    <>
      <PageHeader title="Payments" subtitle="Every payment attempt, successful or not, with its invoice." icon={Icons.payments} />
      <PageBody>
        <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
          <Tabs value={status} onChange={(_, v) => { setStatus(v); setPage(0); }} sx={{ px: 2, borderBottom: 1, borderColor: 'divider' }}>
            <Tab value="all" label="All" />
            <Tab value="succeeded" label="Succeeded" />
            <Tab value="failed" label="Failed" />
          </Tabs>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>When</TableCell>
                <TableCell>Case</TableCell>
                <TableCell>Payer</TableCell>
                <TableCell>Method</TableCell>
                <TableCell>Amount</TableCell>
                <TableCell>Transaction</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Invoice</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(list.data?.docs ?? []).map((p) => (
                <TableRow key={p.id} hover>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{dhakaDateTime(p.paidAt ?? p.createdAt)}</TableCell>
                  <TableCell>{p.caseNumber}</TableCell>
                  <TableCell>
                    {p.payerName}
                    <Typography variant="caption" color="text.secondary" component="div">
                      {p.payerEmail}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    {p.method.toUpperCase()} {p.account}
                  </TableCell>
                  <TableCell>{money(p.amount, p.currency)}</TableCell>
                  <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{p.transactionId}</TableCell>
                  <TableCell>
                    <Tooltip title={p.failureReason ?? ''}>
                      <span>
                        <StatusChip status={p.status} />
                      </span>
                    </Tooltip>
                  </TableCell>
                  <TableCell align="right">
                    {p.status === 'succeeded' && (
                      <Tooltip title={`Download ${p.invoiceNumber}`}>
                        <IconButton size="small" onClick={() => trafficService.staffInvoice(p.id)}>
                          <Icons.download />
                        </IconButton>
                      </Tooltip>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {!list.data?.docs.length && (
                <TableRow>
                  <TableCell colSpan={8} sx={{ textAlign: 'center', py: 5, color: 'text.secondary' }}>
                    {list.isLoading ? 'Loading...' : 'No payments.'}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          <TablePagination component="div" count={list.data?.totalDocs ?? 0} page={page} onPageChange={(_, p) => setPage(p)} rowsPerPage={25} rowsPerPageOptions={[25]} />
        </Paper>
      </PageBody>
    </>
  );
}
