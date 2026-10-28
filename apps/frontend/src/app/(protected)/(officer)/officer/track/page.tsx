'use client';

import {
  Alert,
  Box,
  Button,
  Chip,
  InputAdornment,
  Link as MuiLink,
  Paper,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import { useMutation } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';

import PageHeader from '@/components/common/header/PageHeader';
import PageBody from '@/components/common/layout/PageBody';
import StatusChip from '@/components/common/StatusChip';
import { dhakaDateTime, money } from '@/components/traffic/format';
import VehicleFinder from '@/components/traffic/VehicleFinder';
import { Icons } from '@/lib/icons';
import trafficService from '@/lib/services/traffic.service';
import type { PlateTrack } from '@/lib/types/traffic.types';
import { apiErrorMessage } from '@/lib/utils/common.util';

function mapLink(lat?: number, lng?: number) {
  return lat != null && lng != null ? `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}` : null;
}

function PlateResults({ r }: { r: PlateTrack }) {
  if (!r.timeline.length && !r.cases.length) {
    return <Alert severity="info">No camera has seen &quot;{r.query}&quot; yet.</Alert>;
  }
  return (
    <Stack spacing={3}>
      {!!r.route.length && (
        <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
          <Typography variant="subtitle2" sx={{ mb: 1.5 }}>
            Route: cameras in the order the vehicle reached them
          </Typography>
          <Stack direction="row" spacing={1} sx={{ overflowX: 'auto', alignItems: 'center', pb: 1 }}>
            {r.route.map((step, i) => {
              const link = mapLink(step.lat, step.lng);
              return (
                <Stack key={`${step.cameraName}-${i}`} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <Paper variant="outlined" sx={{ p: 1.25, borderRadius: 1.5, minWidth: 190 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      <Icons.location /> {step.cameraName || 'Unknown camera'}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" component="div">
                      {dhakaDateTime(step.from)}
                      {step.to !== step.from && ` - ${dhakaDateTime(step.to).slice(-8)}`}
                    </Typography>
                    <Typography variant="caption" component="div">
                      {step.events} record{step.events > 1 ? 's' : ''}
                      {link && (
                        <>
                          {' · '}
                          <MuiLink href={link} target="_blank" rel="noreferrer">
                            map
                          </MuiLink>
                        </>
                      )}
                    </Typography>
                  </Paper>
                  {i < r.route.length - 1 && <Icons.chevronRight />}
                </Stack>
              );
            })}
          </Stack>
        </Paper>
      )}

      <Box>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          Timeline ({r.timeline.length})
        </Typography>
        <Stack spacing={1}>
          {r.timeline.map((t) => (
            <Paper key={`${t.kind}-${t.id}`} variant="outlined" sx={{ p: 1.25, borderRadius: 1.5, display: 'flex', gap: 1.5 }}>
              <Box
                sx={{
                  width: 120,
                  height: 72,
                  flex: '0 0 auto',
                  bgcolor: '#0b0f14',
                  borderRadius: 1,
                  overflow: 'hidden',
                  display: 'grid',
                  placeItems: 'center',
                }}
              >
                {t.image ? (
                  <Box component="img" src={t.image} alt="" sx={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                ) : (
                  <Icons.vehicle color="#888" />
                )}
              </Box>
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                  <Chip
                    size="small"
                    label={t.kind === 'violation' ? 'Violation' : 'Plate camera'}
                    color={t.kind === 'violation' ? 'error' : 'info'}
                    variant="outlined"
                  />
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {t.title}
                  </Typography>
                </Stack>
                <Typography variant="body2" color="text.secondary">
                  {dhakaDateTime(t.at)} · {t.cameraName || 'Unknown camera'} · {t.vehicleClass}
                </Typography>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                    {t.registration || '(no read)'}
                  </Typography>
                  {t.plateStatus && <StatusChip status={t.plateStatus === 'set by officer' ? 'confirmed' : t.plateStatus} />}
                </Stack>
              </Box>
            </Paper>
          ))}
        </Stack>
      </Box>

      {!!r.cases.length && (
        <Box>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            Tickets for this vehicle
          </Typography>
          <Stack spacing={1}>
            {r.cases.map((c) => (
              <Paper key={c.id} variant="outlined" sx={{ p: 1.25, borderRadius: 1.5 }}>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {c.caseNumber}
                  </Typography>
                  <Typography variant="body2">
                    {c.code} {c.title} · {money(c.amount, c.currency)} · issued {dhakaDateTime(c.issuedAt)}
                  </Typography>
                  <StatusChip status={c.status} />
                </Stack>
              </Paper>
            ))}
          </Stack>
        </Box>
      )}
    </Stack>
  );
}

function TrackContent() {
  const params = useSearchParams();
  const vid = params.get('vid') ?? undefined;
  const [tab, setTab] = useState<'vehicle' | 'plate'>('vehicle');
  const [q, setQ] = useState('');
  const search = useMutation({ mutationFn: (query: string) => trafficService.trackPlate(query) });

  return (
    <>
      <PageHeader
        title="Track a vehicle"
        subtitle="Find a vehicle anywhere in the camera network by its Vehicle ID, plate or look: where it was seen last and the route it took."
        icon={Icons.track}
      />
      <PageBody>
        <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }}>
          <Tab value="vehicle" label="Find a vehicle" icon={<Icons.vehicle />} iconPosition="start" />
          <Tab value="plate" label="Plate records" icon={<Icons.plate />} iconPosition="start" />
        </Tabs>
        {tab === 'vehicle' ? (
          <VehicleFinder key={vid ?? ''} initialVid={vid} />
        ) : (
          <Stack spacing={3}>
            <Stack
              component="form"
              direction="row"
              spacing={1}
              onSubmit={(e) => {
                e.preventDefault();
                if (q.trim()) search.mutate(q.trim());
              }}
            >
              <TextField
                size="small"
                fullWidth
                placeholder="Registration, e.g. Dhaka Metro-Ga 11-5431, or just the number 11-5431"
                value={q}
                onChange={(e) => setQ(e.target.value)}
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
              <Button type="submit" variant="contained" disabled={!q.trim() || search.isPending}>
                Track
              </Button>
            </Stack>
            {search.isError && <Alert severity="error">{apiErrorMessage(search.error, 'Search failed')}</Alert>}
            {search.data && <PlateResults r={search.data} />}
            {!search.data && !search.isPending && (
              <Typography variant="body2" color="text.secondary">
                Every plate read and typed at every camera, record by record, including violations recorded before
                vehicles had a Vehicle ID. A number without area and letter also finds reads where only the digits were
                legible.
              </Typography>
            )}
          </Stack>
        )}
      </PageBody>
    </>
  );
}

export default function TrackPage() {
  return (
    <Suspense fallback={null}>
      <TrackContent />
    </Suspense>
  );
}
