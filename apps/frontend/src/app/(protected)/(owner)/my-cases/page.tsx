'use client';

import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Link as MuiLink,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import toast from 'react-hot-toast';

import PageHeader from '@/components/common/header/PageHeader';
import PageBody from '@/components/common/layout/PageBody';
import StatusChip from '@/components/common/StatusChip';
import EvidenceGallery from '@/components/traffic/EvidenceGallery';
import {
  REVIEW_REASONS,
  detailLabel,
  dhakaDate,
  dhakaDateTime,
  money,
} from '@/components/traffic/format';
import PaymentDialog from '@/components/traffic/PaymentDialog';
import { useSession } from '@/lib/auth-client';
import { Icons } from '@/lib/icons';
import trafficService from '@/lib/services/traffic.service';
import type { CaseDetail, TrafficCase } from '@/lib/types/traffic.types';
import { apiErrorMessage } from '@/lib/utils/common.util';

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Box sx={{ py: 1, borderBottom: 1, borderColor: 'divider', display: 'flex', gap: 2 }}>
      <Typography
        variant="body2"
        color="text.secondary"
        sx={{ width: { xs: 120, sm: 180 }, flex: '0 0 auto' }}
      >
        {label}
      </Typography>
      <Typography variant="body2" component="div" sx={{ fontWeight: 500, minWidth: 0 }}>
        {children}
      </Typography>
    </Box>
  );
}

function StatusBanner({ c }: { c: CaseDetail }) {
  if (c.status === 'paid') {
    const paid = c.payments.find((p) => p.status === 'succeeded');
    return (
      <Alert
        severity="success"
        action={
          paid && (
            <Button
              size="small"
              startIcon={<Icons.download />}
              onClick={() => trafficService.myInvoice(paid.id)}
            >
              Invoice
            </Button>
          )
        }
      >
        Paid on {dhakaDateTime(c.paidAt)} · invoice {c.invoiceNumber}
      </Alert>
    );
  }
  if (c.status === 'cancelled')
    return <Alert severity="info">This ticket was cancelled after review. Nothing is due.</Alert>;
  if (c.status === 'under_review') {
    return (
      <Alert severity="info">
        Your review request is being looked at. You will get an email with the decision.
      </Alert>
    );
  }
  return (
    <Alert severity={c.overdue ? 'error' : 'warning'}>
      {c.overdue ? 'Overdue: ' : ''}Pay {money(c.amount, c.currency)} or apply for a review by{' '}
      <b>{dhakaDate(c.dueDate)}</b>.
    </Alert>
  );
}

function ReviewDialog({
  c,
  open,
  onClose,
}: {
  c: TrafficCase;
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [reason, setReason] = useState('wrong_vehicle');
  const [details, setDetails] = useState('');
  const send = useMutation({
    mutationFn: () => trafficService.requestReview(c.id, reason, details.trim()),
    onSuccess: () => {
      toast.success('Review request sent');
      qc.invalidateQueries({ queryKey: ['traffic.myCase'] });
      qc.invalidateQueries({ queryKey: ['traffic.myCases'] });
      onClose();
    },
    onError: (e) => toast.error(apiErrorMessage(e, 'Could not send the request')),
  });
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Apply for review: {c.caseNumber}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            A traffic officer looks at the evidence again. While the review is open you do not need
            to pay. If it is rejected, the fine is due again (at least 7 days after the decision).
          </Typography>
          <TextField
            select
            label="Reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          >
            {Object.entries(REVIEW_REASONS).map(([k, t]) => (
              <MenuItem key={k} value={k}>
                {t}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="Explain what happened"
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            multiline
            minRows={4}
            helperText={`${details.trim().length}/2000 (at least 10 characters)`}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          disabled={details.trim().length < 10 || send.isPending}
          onClick={() => send.mutate()}
        >
          Send request
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function CaseView({ id }: { id: string }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['traffic.myCase', id],
    queryFn: () => trafficService.myCase(id),
    // Always the current evidence text (an officer may have explained the images again), and poll while it or the
    // video clip is being made.
    staleTime: 0,
    refetchInterval: (query) =>
      query.state.data?.violation?.explanationStatus === 'pending' ||
      query.state.data?.videoStatus === 'pending'
        ? 5000
        : false,
  });
  const [paying, setPaying] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const c = q.data;
  if (!c) {
    return (
      <Box sx={{ py: 8, display: 'grid', placeItems: 'center' }}>
        {q.isError ? (
          <Alert severity="error">{apiErrorMessage(q.error, 'Could not load the case')}</Alert>
        ) : (
          <CircularProgress />
        )}
      </Box>
    );
  }
  const v = c.violation;
  const canAct = c.status === 'unpaid';
  const decided = c.reviews.some((r) => r.status === 'rejected');
  const details = Object.entries(v?.details ?? {}).filter(
    ([, val]) => val !== null && typeof val !== 'object',
  );
  const mapUrl =
    c.camera?.lat != null && c.camera?.lng != null
      ? `https://www.openstreetmap.org/?mlat=${c.camera.lat}&mlon=${c.camera.lng}#map=17/${c.camera.lat}/${c.camera.lng}`
      : null;

  return (
    <Stack spacing={3}>
      <StatusBanner c={c} />

      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', lg: '3fr 2fr' } }}>
        <Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
            The violation moment
          </Typography>
          <EvidenceGallery images={c.images} height={380} />
        </Box>
        <Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
            Video
          </Typography>
          {c.video ? (
            <>
              <Box
                component="video"
                src={c.video.url}
                controls
                playsInline
                preload="metadata"
                sx={{ width: '100%', borderRadius: 2, bgcolor: '#000', display: 'block' }}
              />
              <Typography variant="caption" color="text.secondary">
                15 seconds of the camera video around the violation
                {c.video.marked
                  ? ', your vehicle boxed in red.'
                  : '. The vehicle could not be followed in the video: it is boxed in the photos.'}
              </Typography>
            </>
          ) : c.videoStatus === 'pending' ? (
            <Box
              sx={{
                aspectRatio: '16 / 9',
                borderRadius: 2,
                bgcolor: 'action.hover',
                display: 'grid',
                placeItems: 'center',
              }}
            >
              <Stack sx={{ alignItems: 'center', gap: 1, color: 'text.secondary' }}>
                <CircularProgress size={28} />
                <Typography variant="body2">
                  The video clip is being prepared (about a minute)...
                </Typography>
              </Stack>
            </Box>
          ) : (
            <Box
              sx={{
                aspectRatio: '16 / 9',
                borderRadius: 2,
                bgcolor: 'action.hover',
                display: 'grid',
                placeItems: 'center',
                textAlign: 'center',
                px: 2,
              }}
            >
              <Stack sx={{ alignItems: 'center', gap: 1, color: 'text.secondary' }}>
                <Icons.video size={32} />
                <Typography variant="body2">
                  {c.videoStatus === 'failed'
                    ? 'The video clip of this violation could not be made.'
                    : 'There is no video clip of this violation (live camera).'}
                </Typography>
                <Typography variant="caption">The photos on the left are the evidence.</Typography>
              </Stack>
            </Box>
          )}
          {v?.explanationStatus === 'pending' && !v.explanation && (
            <Paper variant="outlined" sx={{ p: 2, mt: 2, borderRadius: 2 }}>
              <Stack
                direction="row"
                spacing={1}
                sx={{ alignItems: 'center', color: 'text.secondary' }}
              >
                <CircularProgress size={16} />
                <Typography variant="body2">
                  The camera images are being explained (about a minute)...
                </Typography>
              </Stack>
            </Paper>
          )}
          {v?.explanation && (
            <Paper variant="outlined" sx={{ p: 2, mt: 2, borderRadius: 2 }}>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5 }}>
                <Icons.ai />
                <Typography variant="subtitle2">
                  {v.explanationProvider === 'rules'
                    ? 'What the system recorded'
                    : v.explanationUsedClip
                      ? 'What the photos and video show (AI explanation)'
                      : 'What the photos show (AI explanation)'}
                </Typography>
              </Stack>
              <Typography variant="body2">{v.explanation}</Typography>
            </Paper>
          )}
        </Box>
      </Box>

      <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
          Case details
        </Typography>
        <Detail label="Case number">{c.caseNumber}</Detail>
        <Detail label="Status">
          <StatusChip status={c.overdue ? 'overdue' : c.status} />
        </Detail>
        <Detail label="Vehicle">
          <span style={{ fontFamily: 'monospace' }}>{c.registration}</span>
          {c.vehicle?.makeModel && ` · ${c.vehicle.makeModel}`}
          {v?.vehicleClass && ` · ${v.vehicleClass}`}
        </Detail>
        <Detail label="Violation">
          {c.code} {c.title}
        </Detail>
        <Detail label="Date and time">{dhakaDateTime(v?.occurredAt)}</Detail>
        <Detail label="Location">
          {c.camera ? `${c.camera.name}${c.camera.address ? `, ${c.camera.address}` : ''}` : '-'}
          {mapUrl && (
            <>
              {' · '}
              <MuiLink href={mapUrl} target="_blank" rel="noreferrer">
                map
              </MuiLink>
            </>
          )}
        </Detail>
        {v?.code === 'V2' && v.kph != null && (
          <Detail label="Measured speed">
            {v.avgKph ?? v.kph} km/h where the limit is {v.limitKph} km/h
          </Detail>
        )}
        {details.map(([k, val]) => (
          <Detail key={k} label={detailLabel(k)}>
            {String(val)}
          </Detail>
        ))}
        <Detail label="Fine">{money(c.amount, c.currency)}</Detail>
        {c.legalReference && <Detail label="Legal basis">{c.legalReference}</Detail>}
        <Detail label="Issued">{dhakaDateTime(c.issuedAt)}</Detail>
        <Detail label="Pay or ask for review by">{dhakaDate(c.dueDate)}</Detail>
      </Paper>

      {!!c.reviews.length && (
        <Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
            Your review requests
          </Typography>
          <Stack spacing={1}>
            {c.reviews.map((r) => (
              <Alert
                key={r.id}
                severity={
                  r.status === 'pending' ? 'info' : r.status === 'accepted' ? 'success' : 'error'
                }
              >
                <b>{REVIEW_REASONS[r.reason] ?? r.reason}</b> ({dhakaDateTime(r.createdAt)}):{' '}
                {r.details}
                {r.status !== 'pending' && (
                  <div>
                    Decision: {r.status}
                    {r.decisionNote && ` - ${r.decisionNote}`}
                  </div>
                )}
              </Alert>
            ))}
          </Stack>
        </Box>
      )}

      <Divider />
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={2}
        sx={{ justifyContent: 'flex-end' }}
      >
        <Button
          variant="outlined"
          size="large"
          startIcon={<Icons.reviews />}
          disabled={!canAct || decided}
          onClick={() => setReviewing(true)}
        >
          Apply for Review
        </Button>
        <Button
          variant="contained"
          size="large"
          startIcon={<Icons.payments />}
          disabled={!canAct}
          onClick={() => setPaying(true)}
        >
          Pay the fine ({money(c.amount, c.currency)})
        </Button>
      </Stack>
      {decided && canAct && (
        <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'right' }}>
          A review of this ticket was already decided, so it cannot be reviewed again.
        </Typography>
      )}

      <ReviewDialog c={c} open={reviewing} onClose={() => setReviewing(false)} />
      {paying && (
        <PaymentDialog
          trafficCase={c}
          open={paying}
          onClose={() => setPaying(false)}
          onPaid={() => {
            qc.invalidateQueries({ queryKey: ['traffic.myCase', id] });
            qc.invalidateQueries({ queryKey: ['traffic.myCases'] });
          }}
        />
      )}
    </Stack>
  );
}

/** Back from SSLCommerz (`/my-cases?payment=success|failed|cancelled&case=<id>`). */
const RETURNED: Record<string, { severity: 'success' | 'warning' | 'error'; text: string }> = {
  success: {
    severity: 'success',
    text: 'Payment received through SSLCommerz: the fine is paid and the invoice was emailed to you.',
  },
  failed: {
    severity: 'error',
    text: 'The payment did not go through at SSLCommerz. The fine is still unpaid: you can try again.',
  },
  cancelled: {
    severity: 'warning',
    text: 'You cancelled the payment at SSLCommerz. The fine is still unpaid.',
  },
};

function MyCasesContent() {
  const { data: session } = useSession();
  const router = useRouter();
  const params = useSearchParams();
  const returned = RETURNED[params.get('payment') ?? ''];
  const returnedCase = params.get('case');
  const cases = useQuery({
    queryKey: ['traffic.myCases'],
    queryFn: () => trafficService.myCases(),
  });
  const vehicles = useQuery({
    queryKey: ['traffic.myVehicles'],
    queryFn: () => trafficService.myVehicles(),
  });
  const [chosen, setSelected] = useState<string | null>(null);
  // Until one is picked: the first case that needs action, else the newest.
  const selected =
    chosen ??
    returnedCase ??
    (cases.data?.find((c) => c.status === 'unpaid') ?? cases.data?.[0])?.id ??
    null;

  return (
    <>
      <PageHeader
        title="My cases"
        subtitle="Traffic violations recorded for your vehicles: the evidence, the fine, review requests and payment."
        icon={Icons.vehicle}
        width="6xl"
      />
      <PageBody width="6xl">
        {returned && (
          <Alert
            severity={returned.severity}
            sx={{ mb: 2 }}
            onClose={() => {
              setSelected(selected);
              router.replace('/my-cases');
            }}
          >
            {returned.text}
          </Alert>
        )}
        {!!vehicles.data?.length && (
          <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: 'wrap', alignItems: 'center' }}>
            <Typography variant="body2" color="text.secondary">
              Your vehicles:
            </Typography>
            {vehicles.data.map((v) => (
              <Chip
                key={v.id}
                icon={<Icons.vehicle />}
                label={v.registration}
                variant="outlined"
                size="small"
              />
            ))}
          </Stack>
        )}
        {cases.isLoading ? (
          <Box sx={{ py: 8, display: 'grid', placeItems: 'center' }}>
            <CircularProgress />
          </Box>
        ) : !cases.data?.length ? (
          <Paper variant="outlined" sx={{ p: 5, borderRadius: 2, textAlign: 'center' }}>
            <Box sx={{ fontSize: 40, color: 'success.main' }}>
              <Icons.verified />
            </Box>
            <Typography variant="h6">No cases</Typography>
            <Typography color="text.secondary">
              Nothing is recorded against vehicles registered to{' '}
              {session?.user?.email ?? 'your email'}. If you receive a ticket email, it shows up
              here.
            </Typography>
          </Paper>
        ) : (
          <>
            {cases.data.length > 1 && (
              <Stack direction="row" spacing={1} sx={{ mb: 3, overflowX: 'auto', pb: 1 }}>
                {cases.data.map((c) => (
                  <Paper
                    key={c.id}
                    variant="outlined"
                    onClick={() => setSelected(c.id)}
                    sx={{
                      p: 1.5,
                      borderRadius: 2,
                      cursor: 'pointer',
                      minWidth: 220,
                      borderColor: selected === c.id ? 'primary.main' : 'divider',
                      borderWidth: selected === c.id ? 2 : 1,
                    }}
                  >
                    <Stack
                      direction="row"
                      sx={{ justifyContent: 'space-between', alignItems: 'center' }}
                    >
                      <Typography variant="subtitle2">{c.caseNumber}</Typography>
                      <StatusChip status={c.overdue ? 'overdue' : c.status} />
                    </Stack>
                    <Typography variant="body2" color="text.secondary">
                      {c.code} {c.title}
                    </Typography>
                    <Typography variant="body2">
                      {c.registration} · {money(c.amount, c.currency)}
                    </Typography>
                  </Paper>
                ))}
              </Stack>
            )}
            {selected && <CaseView key={selected} id={selected} />}
          </>
        )}
      </PageBody>
    </>
  );
}

export default function MyCasesPage() {
  return (
    <Suspense>
      <MyCasesContent />
    </Suspense>
  );
}
