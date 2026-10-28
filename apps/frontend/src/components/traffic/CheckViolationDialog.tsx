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
  IconButton,
  Link as MuiLink,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import NextLink from 'next/link';
import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';

import StatusChip from '@/components/common/StatusChip';
import { Icons } from '@/lib/icons';
import { RouteUrls } from '@/lib/routes/route.config';
import trafficService from '@/lib/services/traffic.service';
import type { ViolationDetail } from '@/lib/types/traffic.types';
import { apiErrorMessage } from '@/lib/utils/common.util';
import EvidenceGallery from './EvidenceGallery';
import { detailLabel, dhakaDateTime, money } from './format';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="caption" color="text.secondary" component="div">
        {label}
      </Typography>
      <Box sx={{ fontWeight: 500, wordBreak: 'break-word' }}>{children}</Box>
    </Box>
  );
}

function Explanation({
  v,
  onRegenerate,
  busy,
}: {
  v: ViolationDetail;
  onRegenerate: () => void;
  busy: boolean;
}) {
  const e = v.vlm;
  const byModel = e?.provider === 'local' || e?.provider === 'anthropic';
  const modelName = e?.model?.split('/').pop();
  return (
    <Box
      sx={{
        p: 2,
        borderRadius: 2,
        border: 1,
        borderColor: 'divider',
        bgcolor: (t) =>
          t.palette.mode === 'dark' ? 'rgba(120,140,255,.06)' : 'rgba(60,90,255,.035)',
      }}
    >
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}>
        <Icons.ai />
        <Typography variant="subtitle2" sx={{ flex: 1 }}>
          {byModel ? `AI explanation${modelName ? ` (${modelName})` : ''}` : 'Automatic summary'}
        </Typography>
        {e?.status === 'done' && e.supportsViolation && (
          <Chip
            size="small"
            label={`Images ${e.supportsViolation === 'yes' ? 'support' : e.supportsViolation === 'no' ? 'contradict' : 'cannot confirm'} it`}
            color={
              e.supportsViolation === 'yes'
                ? 'success'
                : e.supportsViolation === 'no'
                  ? 'error'
                  : 'default'
            }
            variant="outlined"
          />
        )}
        <Tooltip title="Explain again">
          <span>
            <IconButton
              size="small"
              onClick={onRegenerate}
              disabled={busy || e?.status === 'pending'}
            >
              <Icons.refresh />
            </IconButton>
          </span>
        </Tooltip>
      </Stack>
      {!e || e.status === 'pending' ? (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', color: 'text.secondary' }}>
          <CircularProgress size={16} />
          <Typography variant="body2">
            Looking at the evidence{e?.provider === 'local' ? ' (about 20 seconds)' : ''}...
          </Typography>
        </Stack>
      ) : e.status === 'failed' ? (
        <Alert severity="warning">Could not explain this violation: {e.error}</Alert>
      ) : (
        <>
          <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
            {e.explanation}
          </Typography>
          {e.vehicleDescription && byModel && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              Vehicle: {e.vehicleDescription}
            </Typography>
          )}
          {!!e.concerns?.length && (
            <Box component="ul" sx={{ m: 0, mt: 1, pl: 2.5 }}>
              {e.concerns.map((c) => (
                <Typography component="li" variant="body2" key={c} color="warning.main">
                  {c}
                </Typography>
              ))}
            </Box>
          )}
          <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 1 }}>
            {e.provider === 'local'
              ? 'Written by a vision-language model running on this computer from the scene and close-up images. It can be wrong: check the images yourself.'
              : e.provider === 'anthropic'
                ? 'Written by a vision-language model from the evidence images. It can be wrong: check the images yourself.'
                : 'Built from the recorded measurements only (no vision-language model in use).'}
          </Typography>
        </>
      )}
    </Box>
  );
}

/** The violation clip (15 s, the vehicle boxed), or why there is none yet. */
function ViolationClip({ v }: { v: ViolationDetail }) {
  if (v.video)
    return (
      <Box>
        <Box
          component="video"
          src={v.video.url}
          controls
          playsInline
          preload="metadata"
          sx={{ width: '100%', maxHeight: 380, borderRadius: 2, bgcolor: '#000', display: 'block' }}
        />
        <Typography variant="caption" color="text.secondary">
          Video: 15 s around the violation
          {v.video.marked
            ? ', the vehicle boxed in red.'
            : ' (the vehicle could not be followed in it).'}
        </Typography>
      </Box>
    );
  if (v.videoStatus === 'pending')
    return (
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', color: 'text.secondary' }}>
        <CircularProgress size={16} />
        <Typography variant="body2">
          The video clip is being prepared (about a minute)...
        </Typography>
      </Stack>
    );
  if (v.videoStatus === 'failed')
    return (
      <Typography variant="caption" color="text.secondary">
        No video clip: {v.videoError || 'it could not be made'}.
      </Typography>
    );
  return null;
}

/** The officer's "Check" pop-up: evidence images, the details, the VLM explanation, and Send ticket / Dismiss. */
export default function CheckViolationDialog({
  id,
  onClose,
}: {
  id: string | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['traffic.violation', id],
    queryFn: () => trafficService.violation(id!),
    enabled: !!id,
    // Poll while the explanation, the plate read or the video clip is still coming.
    refetchInterval: (q) =>
      q.state.data?.vlm?.status === 'pending' ||
      !q.state.data?.plate ||
      q.state.data?.videoStatus === 'pending'
        ? 2500
        : false,
  });
  const v = query.data;
  const [edited, setRegistration] = useState<string | null>(null);
  // Until the officer types, the field shows the officer's earlier correction or a confirmed read.
  const registration =
    edited ??
    (v ? v.registration || (v.plate?.status === 'confirmed' ? v.plate.registration : '') : '');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [note, setNote] = useState('');
  const [dismissing, setDismissing] = useState(false);
  const [reason, setReason] = useState('');

  const explain = useMutation({
    mutationFn: (force: boolean) => trafficService.explain(id!, force),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['traffic.violation', id] }),
  });
  // Ask for an explanation the first time the dialog opens on a violation that has none.
  useEffect(() => {
    if (v && !v.vlm && !explain.isPending) explain.mutate(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v?.id]);

  const lookup = useQuery({
    queryKey: ['traffic.lookup', registration],
    queryFn: () => trafficService.lookupVehicle(registration),
    enabled: !!v && v.status === 'new' && registration.replace(/[^0-9]/g, '').length >= 6,
  });
  const owner = lookup.data?.exact;

  const refreshLists = () => {
    qc.invalidateQueries({ queryKey: ['traffic.violations'] });
    qc.invalidateQueries({ queryKey: ['traffic.violationSummary'] });
    qc.invalidateQueries({ queryKey: ['traffic.violation', id] });
  };
  const ticket = useMutation({
    mutationFn: () =>
      trafficService.sendTicket(id!, {
        registration: registration.trim(),
        ownerEmail: owner ? undefined : ownerEmail.trim() || undefined,
        ownerName: owner ? undefined : ownerName.trim() || undefined,
        note: note.trim() || undefined,
      }),
    onSuccess: (c) => {
      toast.success(
        c.emailError
          ? `Ticket ${c.caseNumber} created, but the email failed: ${c.emailError}`
          : `Ticket ${c.caseNumber} sent to ${c.ownerEmail}`,
      );
      refreshLists();
      onClose();
    },
    onError: (e) => toast.error(apiErrorMessage(e, 'Could not send the ticket')),
  });
  const dismiss = useMutation({
    mutationFn: () => trafficService.dismiss(id!, reason.trim()),
    onSuccess: () => {
      toast.success('Violation dismissed');
      refreshLists();
      onClose();
    },
    onError: (e) => toast.error(apiErrorMessage(e, 'Could not dismiss')),
  });
  const reopen = useMutation({
    mutationFn: () => trafficService.reopen(id!),
    onSuccess: refreshLists,
    onError: (e) => toast.error(apiErrorMessage(e, 'Could not reopen')),
  });
  const resend = useMutation({
    mutationFn: () => trafficService.resendTicket(v!.case!.id),
    onSuccess: () => {
      toast.success('Ticket email sent again');
      refreshLists();
    },
    onError: (e) => toast.error(apiErrorMessage(e, 'Email not sent')),
  });

  const details = Object.entries(v?.details ?? {}).filter(
    ([, val]) => val !== null && typeof val !== 'object',
  );
  const editable = v?.status === 'new';

  return (
    <Dialog open={!!id} onClose={onClose} maxWidth="md" fullWidth scroll="paper">
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pr: 6 }}>
        <Icons.violation />
        <Box sx={{ flex: 1 }}>{v ? `${v.code} - ${v.title}` : 'Violation'}</Box>
        {v && <StatusChip status={v.status} />}
        <IconButton
          onClick={onClose}
          sx={{ position: 'absolute', right: 12, top: 12 }}
          aria-label="Close"
        >
          <Icons.close />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        {!v ? (
          <Box sx={{ py: 8, display: 'grid', placeItems: 'center' }}>
            {query.isError ? (
              <Alert severity="error">{apiErrorMessage(query.error, 'Could not load')}</Alert>
            ) : (
              <CircularProgress />
            )}
          </Box>
        ) : (
          <Stack spacing={2.5}>
            <EvidenceGallery images={v.images} height={340} />
            <ViolationClip v={v} />

            <Box
              sx={{
                display: 'grid',
                gap: 2,
                gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' },
              }}
            >
              <Field label="Vehicle ID">
                {v.vid ? (
                  <MuiLink component={NextLink} href={`${RouteUrls.officer.track}?vid=${v.vid}`} sx={{ fontFamily: 'monospace' }}>
                    {v.vid}
                  </MuiLink>
                ) : (
                  <Typography component="span" variant="body2" color="text.secondary">
                    assigned when it leaves the view
                  </Typography>
                )}
                <Typography component="span" variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                  track #{v.trackId} ({v.eventId.slice(0, 8)})
                </Typography>
              </Field>
              <Field label="Plate read">
                {v.plate ? (
                  <Stack
                    direction="row"
                    spacing={0.5}
                    sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                  >
                    <span>{v.plate.registration || '(nothing read)'}</span>
                    <StatusChip status={v.plate.status} />
                  </Stack>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    Reading...
                  </Typography>
                )}
              </Field>
              <Field label="Vehicle class">
                {v.vehicleClass}
                {v.classConfidence != null && (
                  <Typography component="span" variant="caption" color="text.secondary">
                    {' '}
                    ({Math.round(v.classConfidence * 100)}%)
                  </Typography>
                )}
              </Field>
              <Field label="Time">{dhakaDateTime(v.occurredAt)}</Field>
              <Field label="Violation type">
                {v.code} {v.title}
              </Field>
              {v.code === 'V2' && v.kph != null && (
                <Field label="Speed">
                  {v.avgKph ?? v.kph} km/h avg{v.limitKph != null && ` (limit ${v.limitKph})`}
                  <Typography variant="caption" color="text.secondary" component="div">
                    peak reading {v.kph} km/h
                  </Typography>
                </Field>
              )}
              <Field label="Camera / zone">
                {v.cameraName || '-'}
                <Typography variant="caption" color="text.secondary" component="div">
                  {v.zone}
                  {v.areas.length ? ` · ${v.areas.join(', ')}` : ''}
                </Typography>
              </Field>
              <Field label="Fine">{v.fine ? money(v.fine.amount) : 'not set'}</Field>
              {details.map(([k, val]) => (
                <Field key={k} label={detailLabel(k)}>
                  {String(val)}
                </Field>
              ))}
            </Box>

            <Explanation v={v} busy={explain.isPending} onRegenerate={() => explain.mutate(true)} />

            <Divider />

            {v.status === 'ticketed' && v.case && (
              <Alert
                severity="success"
                action={
                  <Button
                    size="small"
                    onClick={() => resend.mutate()}
                    disabled={resend.isPending}
                    startIcon={<Icons.emailSent />}
                  >
                    Email again
                  </Button>
                }
              >
                Ticket <b>{v.case.caseNumber}</b> sent to {v.case.ownerEmail} for{' '}
                {v.case.registration} ({money(v.case.amount, v.case.currency)},{' '}
                <StatusChip status={v.case.status} />)
                {v.case.emailError && ` - email failed: ${v.case.emailError}`}
              </Alert>
            )}
            {v.status === 'dismissed' && (
              <Alert
                severity="info"
                action={
                  <Button size="small" onClick={() => reopen.mutate()} disabled={reopen.isPending}>
                    Reopen
                  </Button>
                }
              >
                Dismissed: {v.dismissReason}
              </Alert>
            )}

            {editable && (
              <Stack spacing={2}>
                <Typography variant="subtitle2">Ticket</Typography>
                <Box
                  sx={{
                    display: 'grid',
                    gap: 2,
                    gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
                  }}
                >
                  <TextField
                    label="Registration plate number"
                    value={registration}
                    onChange={(e) => setRegistration(e.target.value)}
                    placeholder="Dhaka Metro-Ga 11-5431"
                    helperText={
                      v.plate?.status === 'confirmed'
                        ? 'Confirmed read. Correct it if the plate image shows otherwise.'
                        : 'The reader is not sure: type the plate as you read it in the images.'
                    }
                    size="small"
                  />
                  {owner ? (
                    <Alert severity="success" icon={<Icons.vehicle />}>
                      Registered to <b>{owner.ownerName}</b> ({owner.ownerEmail || 'no email'})
                      {owner.vehicleClass &&
                        owner.vehicleClass.toLowerCase() !== v.vehicleClass.toLowerCase() && (
                          <Typography variant="caption" component="div" color="warning.main">
                            Registry class {owner.vehicleClass} differs from the detected{' '}
                            {v.vehicleClass}
                          </Typography>
                        )}
                    </Alert>
                  ) : (
                    <Stack spacing={1}>
                      {!!lookup.data?.similar.length && (
                        <Alert severity="info">
                          Same number, other plates in the registry:{' '}
                          {lookup.data.similar.map((s) => (
                            <Chip
                              key={s.id}
                              size="small"
                              label={s.registration}
                              sx={{ m: 0.25 }}
                              onClick={() => setRegistration(s.registration)}
                            />
                          ))}
                        </Alert>
                      )}
                      <Stack direction="row" spacing={1}>
                        <TextField
                          label="Owner email"
                          value={ownerEmail}
                          onChange={(e) => setOwnerEmail(e.target.value)}
                          size="small"
                          fullWidth
                          helperText="Not in the registry: who gets the ticket"
                        />
                        <TextField
                          label="Owner name"
                          value={ownerName}
                          onChange={(e) => setOwnerName(e.target.value)}
                          size="small"
                          fullWidth
                        />
                      </Stack>
                    </Stack>
                  )}
                </Box>
                <TextField
                  label="Note for the case file (not shown to the owner)"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  size="small"
                  multiline
                  minRows={1}
                />
                {dismissing && (
                  <TextField
                    label="Why dismiss it?"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    size="small"
                    autoFocus
                    placeholder="e.g. box on the wrong vehicle, ambulance, measurement looks wrong"
                  />
                )}
              </Stack>
            )}
          </Stack>
        )}
      </DialogContent>
      {v && editable && (
        <DialogActions sx={{ px: 3, py: 2 }}>
          {dismissing ? (
            <>
              <Button onClick={() => setDismissing(false)}>Back</Button>
              <Button
                color="inherit"
                variant="outlined"
                disabled={reason.trim().length < 3 || dismiss.isPending}
                onClick={() => dismiss.mutate()}
                startIcon={<Icons.ban />}
              >
                Dismiss violation
              </Button>
            </>
          ) : (
            <>
              <Button color="inherit" onClick={() => setDismissing(true)} startIcon={<Icons.ban />}>
                Dismiss
              </Button>
              <Box sx={{ flex: 1 }} />
              <Button
                variant="contained"
                size="large"
                startIcon={
                  ticket.isPending ? (
                    <CircularProgress size={16} color="inherit" />
                  ) : (
                    <Icons.emailSent />
                  )
                }
                disabled={
                  !registration.trim() || ticket.isPending || (!owner && !ownerEmail.trim())
                }
                onClick={() => ticket.mutate()}
              >
                Send ticket
              </Button>
            </>
          )}
        </DialogActions>
      )}
    </Dialog>
  );
}
