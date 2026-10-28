'use client';

import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  IconButton,
  LinearProgress,
  MenuItem,
  Paper,
  Stack,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';

import StatusChip from '@/components/common/StatusChip';
import useHasPermission from '@/hooks/useHasPermission';
import { PermissionsEnum } from '@/lib/enums/permission.enum';
import { Icons, type IconType } from '@/lib/icons';
import trafficService from '@/lib/services/traffic.service';
import type {
  Camera,
  CameraSource,
  SlotName,
  SlotStatus,
  SourceKind,
} from '@/lib/types/traffic.types';
import { apiErrorMessage } from '@/lib/utils/common.util';
import { VIOLATION_CODES, elapsed } from './format';
import ZonesDialog from './ZonesDialog';

/** Every violation except over-speed (V2 is the speed box's job). All of them always run. */
const OTHER_RULES = ['V1', 'V3', 'V4', 'V5', 'V6', 'V7', 'V8'];

const isRoad = (z: { type?: string }) => (z.type ?? 'road') === 'road';
/** The speed box uses measured road zones only (a zone sized by Auto zones is too rough for speed, and one drawn
 * for the other violations may have no size at all). */
const isMeasuredRoad = (z: {
  type?: string;
  scale_source?: string;
  width_m?: number;
  length_m?: number;
}) => isRoad(z) && z.scale_source !== 'auto' && Number(z.width_m) > 0 && Number(z.length_m) > 0;
const hasRoads = (c: Camera | undefined, slot: SlotName) =>
  !!c?.zones?.zones?.some(slot === 'speed' ? isMeasuredRoad : isRoad);

/** Why a rule would not run on this camera (the violation engine switches it off), or null if it can run. */
function ruleNeeds(code: string, c?: Camera): string | null {
  const zones = c?.zones?.zones ?? [];
  const roads = zones.filter(isRoad);
  if (code === 'V3')
    return zones.some((z) => z.type === 'no_parking') ? null : 'needs a no-parking kerb area';
  if (code === 'V4')
    return roads.some((r) => (r.allowed_direction ?? 'both') !== 'both')
      ? null
      : 'needs a one-way road zone';
  if (code === 'V5') return c?.zones?.lane_lines?.length ? null : 'needs solid lane lines';
  if (code === 'V8')
    return roads.some((r) => r.banned_classes?.length)
      ? null
      : 'needs banned classes on a road zone';
  return null;
}

/** Camera config key of each rule's settings (violations/engine.py RULES). */
const RULE_KEYS: Record<string, string> = {
  bus_blocking: 'V1',
  speed: 'V2',
  illegal_parking: 'V3',
  wrong_side: 'V4',
  lane_line: 'V5',
  helmet: 'V6',
  road_blocking: 'V7',
  restricted_vehicle: 'V8',
};

/** The camera's rule settings that differ from the engine defaults, e.g. "V7 dwell_sec 6, min_passed 3" (not the
 * speed rule's: the other-violations box does not run it). */
function customRules(c?: Camera): string | null {
  const parts = Object.entries(c?.zones?.rules ?? {})
    .filter(([k, s]) => k !== 'speed' && s && Object.keys(s).length)
    .map(
      ([k, s]) =>
        `${RULE_KEYS[k] ?? k} ${Object.entries(s)
          .map(([n, v]) => `${n} ${String(v)}`)
          .join(', ')}`,
    );
  return parts.length ? parts.join(' · ') : null;
}

/** Both boxes need a camera (its zones and limits) and read the number plates of their violators only. */
const BOX: Record<SlotName, { title: string; subtitle: string; icon: IconType }> = {
  speed: {
    title: 'Speed, over-speed & plates',
    subtitle:
      'Speed of every vehicle in the measured road zones; over-limit vehicles become V2 violations, and only their number plates are read, for the ticket.',
    icon: Icons.speed,
  },
  violations: {
    title: 'Other violations',
    subtitle:
      'Bus stopping, parking, wrong side, lane lines, lane blocking, banned classes (V1, V3-V8). Every vehicle that passes is listed with its plate under Passed Vehicles.',
    icon: Icons.violation,
  },
};

function LiveView({ slot, status }: { slot: SlotStatus; status: 'live' | 'idle' }) {
  const ref = useRef<HTMLDivElement>(null);
  // The stream URL carries a signed token that changes on every status poll: keep the one we connected with
  // for the whole run, otherwise the image would reconnect every few seconds.
  const runId = slot.run?.runId;
  const [nonce, setNonce] = useState(0);
  const src = useMemo(
    () => (status === 'live' ? slot.urls.stream : `${slot.urls.snapshot}&n=${nonce}`),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [runId, status, nonce],
  );
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const failed = failedSrc === src;
  const hasFrame = status === 'live' || !!slot.frameSize;

  return (
    <Box
      ref={ref}
      sx={{
        position: 'relative',
        aspectRatio: slot.frameSize ? `${slot.frameSize[0]} / ${slot.frameSize[1]}` : '16 / 9',
        bgcolor: '#0b0f14',
        borderRadius: 1.5,
        overflow: 'hidden',
        display: 'grid',
        placeItems: 'center',
      }}
    >
      {hasFrame && !failed ? (
        <Box
          component="img"
          src={src}
          alt={`${slot.slot} live view`}
          onError={() => setFailedSrc(src)}
          sx={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
        />
      ) : (
        <Stack sx={{ alignItems: 'center', color: 'grey.500', gap: 1 }}>
          <Icons.video size={36} />
          <Typography variant="body2">
            {failed ? 'Live view not available' : 'Not running'}
          </Typography>
        </Stack>
      )}
      {status === 'live' && (
        <Chip
          size="small"
          label="LIVE"
          color="error"
          sx={{
            position: 'absolute',
            top: 8,
            left: '50%',
            transform: 'translateX(-50%)',
            fontWeight: 700,
            letterSpacing: 1,
          }}
        />
      )}
      <Stack direction="row" spacing={0.5} sx={{ position: 'absolute', top: 6, right: 6 }}>
        <Tooltip title="Reconnect view">
          <IconButton
            size="small"
            sx={{ color: '#fff', bgcolor: 'rgba(0,0,0,.35)' }}
            onClick={() => setNonce((n) => n + 1)}
          >
            <Icons.refresh />
          </IconButton>
        </Tooltip>
        <Tooltip title="Full screen">
          <IconButton
            size="small"
            sx={{ color: '#fff', bgcolor: 'rgba(0,0,0,.35)' }}
            onClick={() => ref.current?.requestFullscreen?.()}
          >
            <Icons.view />
          </IconButton>
        </Tooltip>
      </Stack>
    </Box>
  );
}

export default function SurveillanceBox({
  slot,
  cameras,
}: {
  slot: SlotStatus;
  cameras: Camera[];
}) {
  const qc = useQueryClient();
  const meta = BOX[slot.slot];
  const run = slot.run;
  const running = slot.busy;
  // Zones, the rule list, the log (and the page's run history) are for admins; officers start and stop the boxes.
  const { hasPermission: isAdmin } = useHasPermission([PermissionsEnum.ADMIN]);

  const [cameraId, setCameraId] = useState('');
  const [kindChoice, setKind] = useState<'ip' | 'file' | 'upload' | null>(null);
  const [ipUrl, setIpUrl] = useState('');
  const [file, setFile] = useState('');
  const [upload, setUpload] = useState<number | null>(null);
  const [showLog, setShowLog] = useState(false);
  // Zone editor: drawn by hand, or (other violations only) learned from the selected video first, then edited.
  const [zonesMode, setZonesMode] = useState<'manual' | 'auto' | null>(null);

  // Start with the first active camera that has road zones; the camera's own source fills the inputs until the
  // officer picks something else.
  const defaultCamera = cameras.find((c) => c.active && hasRoads(c, slot.slot));
  const camera = cameras.find((c) => c.id === (cameraId || defaultCamera?.id));
  const camSrc = camera?.defaultSource;
  const camIsLive = camSrc?.kind === 'ip' || camSrc?.kind === 'webcam';
  const kind = kindChoice ?? (camIsLive ? 'ip' : 'file');
  const ipValue = ipUrl || (camIsLive ? camSrc!.value : '');
  const fileValue = file || (camSrc && !camIsLive ? `${camSrc.kind}|${camSrc.value}` : '');
  const chooseCamera = (id: string) => {
    setCameraId(id);
    setKind(null);
    setIpUrl('');
    setFile('');
  };

  const videos = useQuery({
    queryKey: ['traffic.videos'],
    queryFn: () => trafficService.videos(),
    staleTime: 30_000,
  });

  const source = (): CameraSource | undefined => {
    if (kind === 'ip') {
      const v = ipValue.trim();
      return v ? { kind: (/^\d+$/.test(v) ? 'webcam' : 'ip') as SourceKind, value: v } : undefined;
    }
    if (kind === 'upload' || !fileValue) return undefined;
    const [k, ...rest] = fileValue.split('|');
    return { kind: k as SourceKind, value: rest.join('|') };
  };

  const start = useMutation({
    mutationFn: () =>
      trafficService.startSlot(slot.slot, { cameraId: camera?.id, source: source(), options: {} }),
    onSuccess: () => {
      toast.success(`${meta.title}: started`);
      qc.invalidateQueries({ queryKey: ['traffic.slots'] });
    },
    onError: (e) => toast.error(apiErrorMessage(e, 'Could not start')),
  });
  const stop = useMutation({
    mutationFn: () => trafficService.stopSlot(slot.slot),
    onSuccess: () => {
      toast.success(`${meta.title}: stopping (finishing the last plates)...`);
      qc.invalidateQueries({ queryKey: ['traffic.slots'] });
    },
    onError: (e) => toast.error(apiErrorMessage(e, 'Could not stop')),
  });

  const onUpload = async (f: File) => {
    try {
      setUpload(0);
      const { url } = await trafficService.uploadUrl();
      const res = await trafficService.uploadVideo(url, f, setUpload);
      toast.success(`Uploaded ${f.name} (${res.sizeMb} MB)`);
      await qc.invalidateQueries({ queryKey: ['traffic.videos'] });
      setKind('file');
      setFile(`upload|${res.value}`);
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Upload failed'));
    } finally {
      setUpload(null);
    }
  };

  const p = run?.progress ?? {};
  const pct = p.total ? Math.min(100, (100 * (p.frames ?? 0)) / p.total) : null;
  // Why Start is disabled, in words (null = ready).
  const blocker = running
    ? null
    : !cameras.some((c) => c.active)
      ? 'Add a camera first (Admin > Cameras & zones).'
      : !camera
        ? 'Choose a camera: these rules use its road zones and limits.'
        : !hasRoads(camera, slot.slot)
          ? !isAdmin
            ? `${camera!.name} has no ${slot.slot === 'speed' ? 'measured ' : ''}road zones yet: ask an admin to define them.`
            : slot.slot === 'speed'
              ? `${camera!.name} has no measured road zones: press Define zones and type each road zone's measured width and length.`
              : `${camera!.name} has no road zones yet: press Auto zones or Define zones.`
          : upload != null
            ? 'Wait for the upload to finish.'
            : !source()
              ? kind === 'ip'
                ? 'Enter the camera stream address.'
                : kind === 'upload'
                  ? 'Upload a video, or pick one under Video file.'
                  : 'Choose a video.'
              : null;
  const canStart = !blocker;

  return (
    <Paper
      variant="outlined"
      sx={{
        borderRadius: 2,
        p: 2,
        display: 'flex',
        flexDirection: 'column',
        gap: 1.5,
        minWidth: 0,
      }}
    >
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'flex-start' }}>
        <Box sx={{ fontSize: 22, color: 'primary.main', mt: 0.25 }}>
          <meta.icon />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            {meta.title}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {meta.subtitle}
          </Typography>
        </Box>
        <StatusChip status={run?.state ?? 'idle'} />
      </Stack>

      <LiveView slot={slot} status={running ? 'live' : 'idle'} />

      {run && (
        <Box>
          <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap', rowGap: 0.5, mb: 0.5 }}>
            <Typography
              variant="body2"
              sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}
            >
              <Icons.camera /> {run.camera?.name || 'No camera'} ·{' '}
              {run.source.live ? 'live' : run.source.label}
            </Typography>
            {running && (
              <Typography variant="body2" color="text.secondary">
                {elapsed(run.startedAt)}
              </Typography>
            )}
            {p.fps != null && (
              <Typography variant="body2" color="text.secondary">
                {p.fps.toFixed(1)} FPS
              </Typography>
            )}
            {p.vehicles != null && <Typography variant="body2">{p.vehicles} vehicles</Typography>}
            {!!run.stats.violations && (
              <Typography variant="body2" color="error.main" sx={{ fontWeight: 600 }}>
                {run.stats.violations} violations
              </Typography>
            )}
            {!!run.stats.plates && (
              <Typography variant="body2">{run.stats.plates} plates read</Typography>
            )}
            {!!run.stats.sightings && (
              <Typography variant="body2">{run.stats.sightings} vehicles listed</Typography>
            )}
          </Stack>
          {running &&
            (pct != null ? (
              <LinearProgress variant="determinate" value={pct} />
            ) : (
              <LinearProgress />
            ))}
          {pct != null && running && (
            <Typography variant="caption" color="text.secondary">
              frame {p.frames} / {p.total} ({pct.toFixed(1)}%)
            </Typography>
          )}
          {run.state === 'error' && (
            <Alert severity="error" sx={{ mt: 1 }}>
              {run.error}
            </Alert>
          )}
        </Box>
      )}

      {!running && (
        <Stack spacing={1.5}>
          <TextField
            select
            size="small"
            label="Camera (zones, limits)"
            value={camera?.id ?? ''}
            onChange={(e) => chooseCamera(e.target.value)}
            helperText={
              camera && !camera.zones?.zones?.length ? 'This camera has no road zones yet' : undefined
            }
          >
            {cameras
              .filter((c) => c.active)
              .map((c) => (
                <MenuItem key={c.id} value={c.id}>
                  {c.name} ({c.code})
                </MenuItem>
              ))}
          </TextField>

          <Tabs
            value={kind}
            onChange={(_, v) => setKind(v)}
            variant="fullWidth"
            sx={{ minHeight: 36 }}
          >
            <Tab
              value="ip"
              label="IP camera"
              icon={<Icons.ipCamera />}
              iconPosition="start"
              sx={{ minHeight: 36 }}
            />
            <Tab
              value="file"
              label="Video file"
              icon={<Icons.videoFile />}
              iconPosition="start"
              sx={{ minHeight: 36 }}
            />
            <Tab
              value="upload"
              label="Upload"
              icon={<Icons.upload />}
              iconPosition="start"
              sx={{ minHeight: 36 }}
            />
          </Tabs>
          {kind === 'ip' && (
            <TextField
              size="small"
              label="Stream address"
              placeholder="rtsp://user:pass@192.168.0.20:554/stream1  or  http://phone-ip:8080/video  or  0 (webcam)"
              value={ipValue}
              onChange={(e) => setIpUrl(e.target.value)}
              helperText="Live: the newest frame is analysed, older ones are skipped to stay real time."
            />
          )}
          {kind === 'file' && (
            <TextField
              select
              size="small"
              label="Video"
              value={
                (videos.data?.videos ?? []).some(
                  (v) => `${v.kind}|${v.kind === 'upload' ? v.name : v.path}` === fileValue,
                )
                  ? fileValue
                  : ''
              }
              onChange={(e) => setFile(e.target.value)}
              helperText={
                videos.isError
                  ? apiErrorMessage(videos.error, 'Vision service not reachable')
                  : 'Every frame is analysed.'
              }
            >
              {(videos.data?.videos ?? []).map((v) => (
                <MenuItem key={v.path} value={`${v.kind}|${v.kind === 'upload' ? v.name : v.path}`}>
                  {v.name}{' '}
                  <Typography
                    component="span"
                    variant="caption"
                    color="text.secondary"
                    sx={{ ml: 1 }}
                  >
                    {v.sizeMb} MB{v.kind === 'upload' ? ' · uploaded' : ''}
                  </Typography>
                </MenuItem>
              ))}
            </TextField>
          )}
          {kind === 'upload' && (
            <Box>
              <Button
                component="label"
                variant="outlined"
                startIcon={<Icons.upload />}
                disabled={upload != null}
                fullWidth
              >
                Choose a video to upload
                <input
                  hidden
                  type="file"
                  accept="video/*,.mp4,.avi,.mkv,.mov,.ts"
                  onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])}
                />
              </Button>
              {upload != null && (
                <Box sx={{ mt: 1 }}>
                  <LinearProgress variant="determinate" value={upload * 100} />
                  <Typography variant="caption">Uploading {(upload * 100).toFixed(0)}%</Typography>
                </Box>
              )}
            </Box>
          )}

          {slot.slot === 'violations' && isAdmin && (
            <Box>
              <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 0.5 }}>
                Every rule runs{camera ? ` on ${camera.name}` : ''}. A rule whose zones are missing
                switches itself off: add them with Auto zones or Define zones.
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                {OTHER_RULES.map((r) => {
                  const missing = ruleNeeds(r, camera);
                  return (
                    <Tooltip
                      key={r}
                      title={missing ? `Off: ${missing}` : `${VIOLATION_CODES[r]}: on`}
                    >
                      <Chip
                        size="small"
                        variant={missing ? 'outlined' : 'filled'}
                        color={missing ? 'default' : 'primary'}
                        label={`${r} ${VIOLATION_CODES[r]}${missing ? ' (off)' : ''}`}
                        sx={missing ? { color: 'text.secondary' } : undefined}
                      />
                    </Tooltip>
                  );
                })}
              </Box>
              {customRules(camera) && (
                <Typography variant="caption" color="warning.main" component="div">
                  Changed thresholds on this camera: {customRules(camera)}
                </Typography>
              )}
            </Box>
          )}
        </Stack>
      )}

      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        {running ? (
          <Button
            color="error"
            variant="contained"
            startIcon={
              stop.isPending ? <CircularProgress size={16} color="inherit" /> : <Icons.stop />
            }
            onClick={() => stop.mutate()}
            disabled={stop.isPending}
          >
            Stop
          </Button>
        ) : (
          <Button
            variant="contained"
            startIcon={
              start.isPending ? <CircularProgress size={16} color="inherit" /> : <Icons.start />
            }
            onClick={() => start.mutate()}
            disabled={!canStart || start.isPending}
          >
            Start
          </Button>
        )}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          {blocker ? (
            <Typography variant="caption" color="warning.main" component="div">
              {blocker}
            </Typography>
          ) : (
            <Typography
              variant="caption"
              color="text.secondary"
              noWrap
              component="div"
              sx={running ? { fontFamily: 'monospace' } : undefined}
            >
              {running
                ? slot.status
                : run && run.state !== 'running'
                  ? `Last run ${run.state}: ${run.stats.violations ?? 0} violations${run.stats.plates ? `, ${run.stats.plates} plates read` : ''}${run.stats.sightings ? `, ${run.stats.sightings} vehicles listed` : ''}`
                  : ''}
            </Typography>
          )}
        </Box>
        {slot.slot === 'violations' && isAdmin && (
          <Tooltip title="Learn the zones from the selected video's traffic, then check and fix them">
            <span>
              <Button
                size="small"
                variant="outlined"
                startIcon={<Icons.autoZones />}
                disabled={!camera || running || !source()}
                onClick={() => setZonesMode('auto')}
              >
                Auto zones
              </Button>
            </span>
          </Tooltip>
        )}
        {isAdmin && (
          <>
            <Button
              size="small"
              variant="outlined"
              startIcon={<Icons.location />}
              disabled={!camera || running}
              onClick={() => setZonesMode('manual')}
            >
              Define zones
            </Button>
            <Button size="small" onClick={() => setShowLog((s) => !s)} endIcon={<Icons.expand />}>
              Log
            </Button>
          </>
        )}
      </Stack>
      <Collapse in={isAdmin && showLog}>
        <Box
          component="pre"
          sx={{
            m: 0,
            p: 1.5,
            maxHeight: 220,
            overflow: 'auto',
            bgcolor: '#0b0f14',
            color: '#c9d1d9',
            borderRadius: 1.5,
            fontSize: 12,
            whiteSpace: 'pre-wrap',
          }}
        >
          {slot.log.length ? slot.log.join('\n') : 'No output yet.'}
        </Box>
      </Collapse>
      {isAdmin && zonesMode && camera && (
        <ZonesDialog
          camera={camera}
          source={source()}
          purpose={slot.slot === 'speed' ? 'speed' : 'violations'}
          autoStart={zonesMode === 'auto'}
          onClose={() => setZonesMode(null)}
        />
      )}
    </Paper>
  );
}
