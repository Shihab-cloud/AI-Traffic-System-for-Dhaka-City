'use client';

import {
  Box,
  Button,
  Paper,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import toast from 'react-hot-toast';

import PageHeader from '@/components/common/header/PageHeader';
import PageBody from '@/components/common/layout/PageBody';
import StatusChip from '@/components/common/StatusChip';
import CaseDialog from '@/components/traffic/CaseDialog';
import { REVIEW_REASONS, dhakaDateTime, money } from '@/components/traffic/format';
import { Icons } from '@/lib/icons';
import trafficService from '@/lib/services/traffic.service';
import type { Review, TrafficCase } from '@/lib/types/traffic.types';
import { apiErrorMessage } from '@/lib/utils/common.util';

function caseOf(r: Review): Partial<TrafficCase> & { _id?: string } {
  return typeof r.caseId === 'object' ? r.caseId : { _id: r.caseId };
}

export default function ReviewsPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState('pending');
  const [openCase, setOpenCase] = useState<{ caseId: string; review: Review } | null>(null);
  const [note, setNote] = useState('');
  const list = useQuery({
    queryKey: ['traffic.reviews', status],
    queryFn: () => trafficService.reviews({ status, limit: 50 }),
    refetchInterval: 15000,
  });
  const decide = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'accepted' | 'rejected' }) =>
      trafficService.decideReview(id, decision, note.trim()),
    onSuccess: (r) => {
      toast.success(r.status === 'accepted' ? 'Accepted: the ticket is cancelled' : 'Rejected: the fine is due again');
      setOpenCase(null);
      setNote('');
      qc.invalidateQueries({ queryKey: ['traffic.reviews'] });
      qc.invalidateQueries({ queryKey: ['traffic.cases'] });
    },
    onError: (e) => toast.error(apiErrorMessage(e, 'Could not decide')),
  });

  return (
    <>
      <PageHeader
        title="Review requests"
        subtitle="Owners who dispute a ticket. Look at the evidence, then accept (ticket cancelled) or reject (fine due)."
        icon={Icons.reviews}
      />
      <PageBody width="6xl">
        <Tabs value={status} onChange={(_, v) => setStatus(v)} sx={{ mb: 2 }}>
          <Tab value="pending" label="Waiting" />
          <Tab value="accepted" label="Accepted" />
          <Tab value="rejected" label="Rejected" />
          <Tab value="all" label="All" />
        </Tabs>
        <Stack spacing={1.5}>
          {(list.data?.docs ?? []).map((r) => {
            const c = caseOf(r);
            return (
              <Paper key={r.id} variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
                <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                      <Typography variant="subtitle2">{r.caseNumber}</Typography>
                      <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                        {c.registration}
                      </Typography>
                      <StatusChip status={r.status} />
                    </Stack>
                    <Typography variant="body2" color="text.secondary">
                      {c.code} {c.title} · {money(c.amount, c.currency)} · from {r.userEmail} on {dhakaDateTime(r.createdAt)}
                    </Typography>
                    <Typography variant="body2" sx={{ mt: 1 }}>
                      <b>{REVIEW_REASONS[r.reason] ?? r.reason}:</b> {r.details}
                    </Typography>
                    {r.status !== 'pending' && (
                      <Typography variant="caption" color="text.secondary">
                        {r.status} by {r.decidedByName} on {dhakaDateTime(r.decidedAt)} {r.decisionNote && `- ${r.decisionNote}`}
                      </Typography>
                    )}
                  </Box>
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
                    <Button
                      variant={r.status === 'pending' ? 'contained' : 'outlined'}
                      startIcon={<Icons.view />}
                      onClick={() => c._id && setOpenCase({ caseId: c._id, review: r })}
                    >
                      {r.status === 'pending' ? 'Review' : 'View'}
                    </Button>
                  </Stack>
                </Stack>
              </Paper>
            );
          })}
          {!list.data?.docs.length && (
            <Typography color="text.secondary" sx={{ textAlign: 'center', py: 6 }}>
              {list.isLoading ? 'Loading...' : 'No review requests here.'}
            </Typography>
          )}
        </Stack>
      </PageBody>
      <CaseDialog
        id={openCase?.caseId ?? null}
        onClose={() => setOpenCase(null)}
        actions={
          openCase?.review.status === 'pending' && (
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <TextField size="small" placeholder="Note to the owner (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
              <Button
                color="error"
                variant="outlined"
                disabled={decide.isPending}
                onClick={() => decide.mutate({ id: openCase.review.id, decision: 'rejected' })}
              >
                Reject
              </Button>
              <Button
                color="success"
                variant="contained"
                disabled={decide.isPending}
                onClick={() => decide.mutate({ id: openCase.review.id, decision: 'accepted' })}
              >
                Accept
              </Button>
            </Stack>
          )
        }
      />
    </>
  );
}
