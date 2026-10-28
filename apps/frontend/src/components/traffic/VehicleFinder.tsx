'use client';

import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  InputAdornment,
  Link as MuiLink,
  MenuItem,
  Pagination,
  Paper,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import StatusChip from '@/components/common/StatusChip';
import { dhakaDateTime, money } from '@/components/traffic/format';
import { Icons } from '@/lib/icons';
import trafficService from '@/lib/services/traffic.service';
import type {
  TrackedVehicleRow,
  VehicleMatch,
  VehicleSearchMode,
  VehicleSearchParams,
  VehicleTimelineItem,
} from '@/lib/types/traffic.types';
import { apiErrorMessage } from '@/lib/utils/common.util';

// The vision-language model's words (vision/service/vlm.py COLOURS and TYPE_WORDS; cars are split into car / SUV).
const COLOURS = ['white', 'black', 'grey', 'silver', 'red', 'maroon', 'blue', 'green', 'yellow', 'orange', 'brown',
  'golden', 'beige', 'purple', 'pink', 'cream'];
const TYPES = ['car', 'suv', 'microbus', 'pickup', 'bus', 'truck', 'cng', 'easybike', 'leguna', 'motorbike', 'bicycle',
  'rickshaw', 'rickshaw van', 'bhotbhoti', 'power tiller', 'handcart'];
const CLASSES = ['Bicycle', 'Bus', 'Bhotbhoti', 'Car', 'CNG', 'Easybike', 'Leguna', 'Motorbike', 'MPV', 'Pickup',
  'PowerTiller', 'Rickshaw', 'Van', 'Truck', 'Wheelbarrow'];

const PLACEHOLDER: Record<VehicleSearchMode, string> = {
  id: 'Vehicle ID, e.g. DV-000123 (or just 123)',
  plate: 'Registration, e.g. Dhaka Metro-Ga 11-5431, or just the number 11-5431',
  appearance: 'Optional words, e.g. white SUV',
};

/** lucide icons are blocks in this theme: keep these on the text line */
const INLINE_ICON = { display: 'inline-block', verticalAlign: '-2px' } as const;

/** "dv-123", "123" -> "DV-000123" (the backend's parseVid) */
function normalVid(text?: string) {
  const m = (text ?? '').trim().toUpperCase().match(/^(?:DV)?[\s-]*0*(\d{1,12})$/);
  return m ? `DV-${m[1].padStart(6, '0')}` : undefined;
}

function mapLink(lat?: number, lng?: number) {
  return lat != null && lng != null ? `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}` : null;
}

function Thumb({ src, size = 96 }: { src?: string; size?: number }) {
  return (
    <Box
      sx={{
        width: size,
        height: Math.round(size * 0.66),
        flex: '0 0 auto',
        bgcolor: '#0b0f14',
        borderRadius: 1,
        overflow: 'hidden',
        display: 'grid',
        placeItems: 'center',
      }}
    >
      {src ? (
        <Box component="img" src={src} alt="" sx={{ width: '100%', height: '100%', objectFit: 'contain' }} />
      ) : (
        <Icons.vehicle color="#888" />
      )}
    </Box>
  );
}

/** "How this sighting kept or got its Vehicle ID", in words. */
function matchText(m?: VehicleMatch) {
  if (!m) return '';
  switch (m.method) {
    case 'new':
      return 'First sighting: new Vehicle ID';
    case 'plate':
      return 'Same confirmed plate as an earlier sighting';
    case 'same-camera':
      return `Same vehicle as an earlier track at this camera (score ${m.score?.toFixed(2)})`;
    case 'link':
      return (
        `Came from ${m.fromCameraName || 'the previous camera'}${m.travelS != null ? ` ${Math.round(m.travelS)} s earlier` : ''}` +
        (m.hops === 2 ? `, not seen by ${m.viaCameraName || 'the camera'} in between` : '') +
        ` (appearance score ${m.score?.toFixed(2)}, ahead of the next by ${m.margin?.toFixed(2)}, ${m.candidates} candidates)` +
        (m.late ? '; joined when that camera’s record arrived late' : '')
      );
    case 'later':
      return `This record arrived after ${m.toCameraName || 'the next camera'}’s: it took the Vehicle ID given there (appearance score ${m.score?.toFixed(2)})`;
    default:
      return '';
  }
}

/** Vehicles anywhere in the network that look like this one (appearance index): where it may have gone. */
function LookAlikes({ vid, onOpen }: { vid: string; onOpen?: (vid: string) => void }) {
  const [when, setWhen] = useState<'after' | 'any' | null>(null);
  const q = useQuery({
    queryKey: ['vehicle-similar', vid, when],
    queryFn: () => trafficService.similarVehicles(vid, when ?? 'after'),
    enabled: !!when,
  });
  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}>
        <Box>
          <Typography variant="subtitle2">Look-alikes elsewhere</Typography>
          <Typography variant="caption" color="text.secondary">
            When a camera could not keep the ID (another view, a crowd), the vehicle may be in the network under another
            one. Suggestions by appearance only: check the photos.
          </Typography>
        </Box>
        <ToggleButtonGroup size="small" exclusive value={when} onChange={(_, w: 'after' | 'any' | null) => w && setWhen(w)}>
          <ToggleButton value="after">After it was last seen</ToggleButton>
          <ToggleButton value="any">Any time</ToggleButton>
        </ToggleButtonGroup>
      </Stack>
      {q.isFetching && <CircularProgress size={20} sx={{ mt: 1.5 }} />}
      {q.isError && (
        <Alert severity="warning" sx={{ mt: 1.5 }}>
          {apiErrorMessage(q.error, 'Could not search look-alikes')}
        </Alert>
      )}
      {q.data && !q.isFetching && (
        <Stack spacing={1} sx={{ mt: 1.5 }}>
          <Typography variant="caption" color="text.secondary">
            Searched {q.data.indexed} vehicles with an appearance vector in {q.data.ms} ms
            {q.data.docs.length > 0 && `: ${q.data.docs.length} most alike, best first`}
          </Typography>
          {q.data.docs.length === 0 && <Alert severity="info">No vehicle of a compatible class looks like it.</Alert>}
          {q.data.docs.map((v) => (
            <Box key={v.vid} sx={{ position: 'relative' }}>
              <VehicleRow v={v} selected={false} onOpen={() => onOpen?.(v.vid)} />
              <Chip
                size="small"
                label={`alike ${Math.round(v.score * 100)}%`}
                color={v.score >= 0.8 ? 'success' : 'default'}
                sx={{ position: 'absolute', top: 8, right: 8 }}
              />
            </Box>
          ))}
        </Stack>
      )}
    </Paper>
  );
}

function VehicleRow({ v, selected, onOpen }: { v: TrackedVehicleRow; selected: boolean; onOpen: () => void }) {
  return (
    <Paper
      variant="outlined"
      onClick={onOpen}
      sx={{
        p: 1.25,
        borderRadius: 1.5,
        display: 'flex',
        gap: 1.5,
        cursor: 'pointer',
        borderColor: selected ? 'primary.main' : undefined,
        '&:hover': { borderColor: 'primary.main' },
      }}
    >
      <Thumb src={v.image} />
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}>
          <Chip size="small" color="primary" label={v.vid} sx={{ fontFamily: 'monospace', fontWeight: 700 }} />
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {v.vehicleClass || 'Vehicle'}
            {v.appearance && ` · ${v.appearance}`}
          </Typography>
          {v.registration && (
            <>
              <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                {v.registration}
              </Typography>
              <StatusChip status={v.plateStatus === 'set by officer' ? 'confirmed' : v.plateStatus} />
            </>
          )}
        </Stack>
        <Typography variant="body2" sx={{ mt: 0.5 }}>
          <Icons.location size={14} style={INLINE_ICON} /> Last seen: <b>{v.last.cameraName || 'unknown camera'}</b>
          {v.last.cameraCode && ` (${v.last.cameraCode})`} · {dhakaDateTime(v.last.at)}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {v.cameraCount} camera{v.cameraCount === 1 ? '' : 's'} · {v.sightings} sighting{v.sightings === 1 ? '' : 's'} · first
          seen {dhakaDateTime(v.first.at)} at {v.first.cameraName || 'unknown camera'}
          {v.violations > 0 && ` · ${v.violations} violation${v.violations === 1 ? '' : 's'}`}
        </Typography>
      </Box>
    </Paper>
  );
}

/**
 * One vehicle: where the network saw it last, its route across cameras, every record, its tickets. Refreshed every
 * 15 s while open, so a new camera's sighting shows up as the vehicle moves on.
 */
export function VehicleTrackView({ vid, asked, onOpen }: { vid: string; asked?: string; onOpen?: (vid: string) => void }) {
  const q = useQuery({ queryKey: ['vehicle-track', vid], queryFn: () => trafficService.vehicleTrack(vid), refetchInterval: 15_000 });
  if (q.isPending) return <CircularProgress size={24} />;
  if (q.isError) return <Alert severity="error">{apiErrorMessage(q.error, 'Could not load the vehicle')}</Alert>;
  const { vehicle: v, route, timeline, cases } = q.data;
  const lastCam = route[route.length - 1];
  const lastLink = mapLink(lastCam?.lat, lastCam?.lng);
  // the ID an officer typed was joined to this vehicle
  const joined = q.data.mergedFrom ?? (asked && asked !== v.vid && v.mergedVids?.includes(asked) ? asked : undefined);

  return (
    <Stack spacing={2.5}>
      {joined && (
        <Alert severity="info">
          {joined} turned out to be the same vehicle as {v.vid} (a camera’s record arrived late) and was joined to it: a
          vehicle keeps the ID its first camera gave it.
        </Alert>
      )}
      <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, display: 'flex', gap: 2, flexWrap: 'wrap' }}>
        <Thumb src={v.image} size={160} />
        <Box sx={{ minWidth: 240, flex: 1 }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <Typography variant="h6" sx={{ fontFamily: 'monospace' }}>
              {v.vid}
            </Typography>
            <Typography variant="body1" sx={{ fontWeight: 600 }}>
              {v.vehicleClass}
              {v.appearance && ` · ${v.appearance}`}
            </Typography>
          </Stack>
          {!!v.mergedVids?.length && (
            <Typography variant="caption" color="text.secondary">
              Also found as {v.mergedVids.join(', ')} (joined)
            </Typography>
          )}
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', my: 0.5 }}>
            <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
              {v.registration || 'Plate not read'}
            </Typography>
            {v.registration && <StatusChip status={v.plateStatus === 'set by officer' ? 'confirmed' : v.plateStatus} />}
          </Stack>
          <Alert severity="info" icon={<Icons.location />} sx={{ mt: 1 }}>
            <b>Last seen</b> at {v.last.cameraName || 'an unknown camera'}
            {v.last.cameraCode && ` (${v.last.cameraCode})`}, {dhakaDateTime(v.last.at)}
            {lastLink && (
              <>
                {' · '}
                <MuiLink href={lastLink} target="_blank" rel="noreferrer">
                  map
                </MuiLink>
              </>
            )}
            {v.lastViolation && (
              <Box component="span" sx={{ display: 'block' }}>
                Last violation: {v.lastViolation.code} {v.lastViolation.title}, {dhakaDateTime(v.lastViolation.at)} at{' '}
                {v.lastViolation.cameraName}
              </Box>
            )}
          </Alert>
        </Box>
      </Paper>

      {route.length > 0 && (
        <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
          <Typography variant="subtitle2" sx={{ mb: 1.5 }}>
            Route: the cameras in the order the vehicle reached them
          </Typography>
          <Stack direction="row" spacing={1} sx={{ overflowX: 'auto', alignItems: 'center', pb: 1 }}>
            {route.map((step, i) => (
              <Stack key={`${step.cameraName}-${i}`} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <Paper
                  variant="outlined"
                  sx={{ p: 1.25, borderRadius: 1.5, minWidth: 190, borderColor: i === route.length - 1 ? 'primary.main' : undefined }}
                >
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    <Icons.camera size={14} style={INLINE_ICON} /> {step.cameraName || 'Unknown camera'}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" component="div">
                    {dhakaDateTime(step.from)}
                    {step.to !== step.from && ` - ${dhakaDateTime(step.to).slice(-8)}`}
                  </Typography>
                  <Typography variant="caption" component="div">
                    {step.events} record{step.events > 1 ? 's' : ''}
                    {step.violations > 0 && `, ${step.violations} violation${step.violations > 1 ? 's' : ''}`}
                    {i === route.length - 1 && ' · last seen here'}
                  </Typography>
                </Paper>
                {i < route.length - 1 && <Icons.chevronRight />}
              </Stack>
            ))}
          </Stack>
        </Paper>
      )}

      <Box>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          Every record ({timeline.length})
        </Typography>
        <Stack spacing={1}>
          {timeline.map((t: VehicleTimelineItem) => (
            <Paper key={`${t.kind}-${t.id}`} variant="outlined" sx={{ p: 1.25, borderRadius: 1.5, display: 'flex', gap: 1.5 }}>
              <Thumb src={t.image} size={110} />
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                  <Chip
                    size="small"
                    variant="outlined"
                    label={t.kind === 'violation' ? 'Violation' : 'Passed the camera'}
                    color={t.kind === 'violation' ? 'error' : 'info'}
                  />
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {t.kind === 'violation' ? t.title : t.cameraName}
                  </Typography>
                  {t.status && <StatusChip status={t.status} />}
                </Stack>
                <Typography variant="body2" color="text.secondary">
                  {dhakaDateTime(t.at)}
                  {t.until && t.until !== t.at && ` - ${dhakaDateTime(t.until).slice(-8)}`} · {t.cameraName || 'Unknown camera'}
                  {t.trackId != null && ` · track #${t.trackId}`} · {t.vehicleClass}
                  {t.appearance && ` · ${t.appearance}`}
                </Typography>
                {(t.entryGate || t.exitGate) && (
                  <Typography variant="caption" color="text.secondary" component="div">
                    Came in through {t.entryGate || '(no gate)'}, left through {t.exitGate || '(no gate)'}
                  </Typography>
                )}
                {t.match && (
                  <Typography variant="caption" component="div" sx={{ color: t.match.method === 'link' ? 'success.main' : 'text.secondary' }}>
                    {matchText(t.match)}
                  </Typography>
                )}
                {t.registration && (
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mt: 0.25 }}>
                    <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                      {t.registration}
                    </Typography>
                    <StatusChip status={t.plateStatus === 'set by officer' ? 'confirmed' : t.plateStatus} />
                  </Stack>
                )}
              </Box>
            </Paper>
          ))}
        </Stack>
      </Box>

      <LookAlikes key={v.vid} vid={v.vid} onOpen={onOpen} />

      {cases.length > 0 && (
        <Box>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            Tickets for this vehicle
          </Typography>
          <Stack spacing={1}>
            {cases.map((c) => (
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

/**
 * Find a vehicle anywhere in the camera network: by its Vehicle ID (the one every camera keeps), its plate or its
 * look. Results are newest-last-seen first; opening one shows its route.
 */
export default function VehicleFinder({ initialVid }: { initialVid?: string }) {
  const [mode, setMode] = useState<VehicleSearchMode>('id');
  const [text, setText] = useState(initialVid ?? '');
  const [colour, setColour] = useState('');
  const [type, setType] = useState('');
  const [vehicleClass, setVehicleClass] = useState('');
  const [cameraId, setCameraId] = useState('');
  const [params, setParams] = useState<VehicleSearchParams | null>(initialVid ? { q: initialVid, by: 'id' } : null);
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(initialVid ?? null);

  const cameras = useQuery({ queryKey: ['cameras'], queryFn: () => trafficService.cameras() });
  const results = useQuery({
    queryKey: ['vehicle-search', params, page],
    queryFn: () => trafficService.searchVehicles({ ...params, page, limit: 20 }),
    enabled: !!params,
  });

  // one result for a Vehicle ID or plate: open it straight away
  useEffect(() => {
    const docs = results.data?.docs;
    if (docs?.length === 1 && params?.by !== 'appearance') setOpen(docs[0].vid);
  }, [results.data, params?.by]);

  const canSearch = mode === 'appearance' ? !!(text.trim() || colour || type || vehicleClass || cameraId) : !!text.trim();
  const submit = () => {
    setPage(1);
    setOpen(null);
    setParams({
      q: text.trim() || undefined,
      by: mode,
      colour: mode === 'appearance' ? colour || undefined : undefined,
      type: mode === 'appearance' ? type || undefined : undefined,
      vehicleClass: vehicleClass || undefined,
      cameraId: cameraId || undefined,
    });
  };

  return (
    <Stack spacing={2.5}>
      <Stack
        component="form"
        spacing={1.5}
        onSubmit={(e) => {
          e.preventDefault();
          if (canSearch) submit();
        }}
      >
        <ToggleButtonGroup
          size="small"
          exclusive
          value={mode}
          onChange={(_, m: VehicleSearchMode | null) => m && setMode(m)}
          sx={{ flexWrap: 'wrap' }}
        >
          <ToggleButton value="id">Vehicle ID</ToggleButton>
          <ToggleButton value="plate">Number plate</ToggleButton>
          <ToggleButton value="appearance">Appearance</ToggleButton>
        </ToggleButtonGroup>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1}>
          <TextField
            size="small"
            fullWidth
            placeholder={PLACEHOLDER[mode]}
            value={text}
            onChange={(e) => setText(e.target.value)}
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
          {mode === 'appearance' && (
            <>
              <TextField select size="small" label="Colour" value={colour} onChange={(e) => setColour(e.target.value)} sx={{ minWidth: 130 }}>
                <MenuItem value="">Any</MenuItem>
                {COLOURS.map((c) => (
                  <MenuItem key={c} value={c}>
                    {c}
                  </MenuItem>
                ))}
              </TextField>
              <TextField select size="small" label="Type" value={type} onChange={(e) => setType(e.target.value)} sx={{ minWidth: 150 }}>
                <MenuItem value="">Any</MenuItem>
                {TYPES.map((t) => (
                  <MenuItem key={t} value={t}>
                    {t === 'suv' || t === 'cng' ? t.toUpperCase() : t}
                  </MenuItem>
                ))}
              </TextField>
            </>
          )}
          <TextField select size="small" label="Class" value={vehicleClass} onChange={(e) => setVehicleClass(e.target.value)} sx={{ minWidth: 130 }}>
            <MenuItem value="">Any</MenuItem>
            {CLASSES.map((c) => (
              <MenuItem key={c} value={c}>
                {c}
              </MenuItem>
            ))}
          </TextField>
          <TextField select size="small" label="Last seen at" value={cameraId} onChange={(e) => setCameraId(e.target.value)} sx={{ minWidth: 180 }}>
            <MenuItem value="">Any camera</MenuItem>
            {(cameras.data ?? []).map((c) => (
              <MenuItem key={c.id} value={c.id}>
                {c.name} ({c.code})
              </MenuItem>
            ))}
          </TextField>
          <Button type="submit" variant="contained" disabled={!canSearch || results.isFetching}>
            Find
          </Button>
        </Stack>
      </Stack>

      {results.isError && <Alert severity="error">{apiErrorMessage(results.error, 'Search failed')}</Alert>}
      {!params && (
        <Typography variant="body2" color="text.secondary">
          Every vehicle a camera lists gets a Vehicle ID (DV-…) the first time it is seen. The next cameras on its road
          keep that ID (matched by its plate, or by its look and travel time from the linked camera before, or two cameras
          before when one in between missed it), so one search shows where it was seen last in the whole network and the
          route it took. Appearance search uses the two-word descriptions from the vision-language model (filled in after
          each run); an open vehicle can also list its look-alikes anywhere in the network.
        </Typography>
      )}
      {results.data && (
        <Stack spacing={1}>
          <Typography variant="subtitle2">
            {results.data.totalDocs} vehicle{results.data.totalDocs === 1 ? '' : 's'}
            {results.data.totalDocs > 1 && ', last seen first'}
          </Typography>
          {results.data.docs.length === 0 && <Alert severity="info">No vehicle in the network matches.</Alert>}
          {results.data.docs.map((v) => (
            <VehicleRow key={v.vid} v={v} selected={open === v.vid} onOpen={() => setOpen(v.vid)} />
          ))}
          {results.data.totalPages > 1 && (
            <Pagination count={results.data.totalPages} page={page} onChange={(_, p) => setPage(p)} sx={{ alignSelf: 'center' }} />
          )}
        </Stack>
      )}
      {open && (
        <Box>
          <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 600 }}>
            Vehicle {open}
          </Typography>
          <VehicleTrackView
            vid={open}
            asked={params?.by === 'id' ? normalVid(params.q) : undefined}
            onOpen={(vid) => {
              setOpen(vid);
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
          />
        </Box>
      )}
    </Stack>
  );
}
