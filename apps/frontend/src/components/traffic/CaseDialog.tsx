'use client';

import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Stack,
  Typography,
} from '@mui/material';
import { useMutation, useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';

import StatusChip from '@/components/common/StatusChip';
import { Icons } from '@/lib/icons';
import trafficService from '@/lib/services/traffic.service';
import { apiErrorMessage } from '@/lib/utils/common.util';
import EvidenceGallery from './EvidenceGallery';
import { REVIEW_REASONS, dhakaDate, dhakaDateTime, money } from './format';

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <Stack direction="row" spacing={2} sx={{ py: 0.5 }}>
      <Typography variant="body2" color="text.secondary" sx={{ width: 150, flex: '0 0 auto' }}>
        {k}
      </Typography>
      <Typography variant="body2" component="div" sx={{ minWidth: 0 }}>
        {v}
      </Typography>
    </Stack>
  );
}

/** A ticket as staff see it: evidence, owner, payments, reviews. */
export default function CaseDialog({ id, onClose, actions }: { id: string | null; onClose: () => void; actions?: React.ReactNode }) {
  const q = useQuery({ queryKey: ['traffic.case', id], queryFn: () => trafficService.caseDetail(id!), enabled: !!id });
  const c = q.data;
  const resend = useMutation({
    mutationFn: () => trafficService.resendTicket(id!),
    onSuccess: () => toast.success('Ticket email sent again'),
    onError: (e) => toast.error(apiErrorMessage(e, 'Email not sent')),
  });
  return (
    <Dialog open={!!id} onClose={onClose} maxWidth="md" fullWidth scroll="paper">
      <DialogTitle sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
        <Icons.cases />
        <Box sx={{ flex: 1 }}>{c ? `Ticket ${c.caseNumber}` : 'Ticket'}</Box>
        {c && <StatusChip status={c.overdue ? 'overdue' : c.status} />}
      </DialogTitle>
      <DialogContent dividers>
        {!c ? (
          <Box sx={{ py: 6, display: 'grid', placeItems: 'center' }}>
            <CircularProgress />
          </Box>
        ) : (
          <Stack spacing={2}>
            <EvidenceGallery images={c.images} height={300} />
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, columnGap: 3 }}>
              <Box>
                <Row k="Registration" v={c.registration} />
                <Row k="Owner" v={`${c.ownerName || '-'} (${c.ownerEmail || 'no email'})`} />
                <Row k="Violation" v={`${c.code} ${c.title}`} />
                <Row k="When" v={dhakaDateTime(c.violation?.occurredAt)} />
                <Row k="Camera" v={c.camera ? `${c.camera.name} (${c.camera.code})` : '-'} />
              </Box>
              <Box>
                <Row k="Fine" v={money(c.amount, c.currency)} />
                <Row k="Issued" v={`${dhakaDateTime(c.issuedAt)}${c.issuedByName ? ` by ${c.issuedByName}` : ''}`} />
                <Row k="Due" v={dhakaDate(c.dueDate)} />
                <Row
                  k="Email"
                  v={c.emailError ? <span style={{ color: 'var(--mui-palette-error-main)' }}>failed: {c.emailError}</span> : dhakaDateTime(c.emailedAt)}
                />
                {c.officerNote && <Row k="Officer note" v={c.officerNote} />}
              </Box>
            </Box>
            {!!c.reviews.length && (
              <>
                <Divider />
                <Typography variant="subtitle2">Review requests</Typography>
                {c.reviews.map((r) => (
                  <Alert key={r.id} severity={r.status === 'pending' ? 'warning' : r.status === 'accepted' ? 'success' : 'error'}>
                    <b>{REVIEW_REASONS[r.reason] ?? r.reason}</b> ({dhakaDateTime(r.createdAt)}): {r.details}
                    {r.status !== 'pending' && (
                      <div>
                        {r.status} by {r.decidedByName} {r.decisionNote && `- ${r.decisionNote}`}
                      </div>
                    )}
                  </Alert>
                ))}
              </>
            )}
            {!!c.payments.length && (
              <>
                <Divider />
                <Typography variant="subtitle2">Payments</Typography>
                {c.payments.map((p) => (
                  <Stack key={p.id} direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                    <StatusChip status={p.status} />
                    <Typography variant="body2">
                      {money(p.amount, p.currency)} · {p.method.toUpperCase()} {p.account} · {dhakaDateTime(p.paidAt ?? p.createdAt)}
                      {p.failureReason && ` · ${p.failureReason}`}
                    </Typography>
                    {p.status === 'succeeded' && (
                      <Button size="small" startIcon={<Icons.download />} onClick={() => trafficService.staffInvoice(p.id)}>
                        Invoice {p.invoiceNumber}
                      </Button>
                    )}
                  </Stack>
                ))}
              </>
            )}
          </Stack>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3 }}>
        {c && c.status !== 'paid' && c.status !== 'cancelled' && (
          <Button startIcon={<Icons.emailSent />} onClick={() => resend.mutate()} disabled={resend.isPending}>
            Email ticket again
          </Button>
        )}
        <Box sx={{ flex: 1 }} />
        {actions}
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
