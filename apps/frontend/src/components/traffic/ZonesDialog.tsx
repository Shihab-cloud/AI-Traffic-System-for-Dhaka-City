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
  LinearProgress,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';

import { Icons } from '@/lib/icons';
import trafficService from '@/lib/services/traffic.service';
import type {
  AutoZoneReport,
  AutoZoneStatus,
  Camera,
  CameraFrame,
  CameraSource,
  CameraZones,
} from '@/lib/types/traffic.types';
import { apiErrorMessage } from '@/lib/utils/common.util';
import SpeedZoneEditor from './SpeedZoneEditor';
import ZoneEditor, { fitZones } from './ZoneEditor';

const EMPTY: CameraZones = {
  frame_size: [1920, 1080],
  zones: [],
  lane_lines: [],
  peak_hours: [
    ['07:00', '10:30'],
    ['16:00', '20:30'],
  ],
};
const FINISHED: AutoZoneStatus['state'][] = ['done', 'error', 'cancelled', 'idle'];
/** How far "Another frame" moves into a video. */
const FRAME_STEP_SEC = 10;
const DIRECTION: Record<string, string> = {
  toward_camera: 'toward the camera',
  away_from_camera: 'away from the camera',
  both: 'both ways',
};

/** What automatic learning found, and what it cannot know. */
function AutoReport({ report }: { report: AutoZoneReport }) {
  const cal = report.calibration;
  const found = report.found ?? {};
  return (
    <Alert severity="success" icon={<Icons.autoZones />}>
      <Typography variant="body2" sx={{ fontWeight: 600 }}>
        Learned automatically from {Math.round(report.observed_s)} s of video (
        {report.moving_vehicles} moving vehicles)
      </Typography>
      {cal && (
        <Typography variant="body2">
          Camera about {cal.camera_height_m} m above the road, field of view {cal.hfov_deg}°, tilted{' '}
          {cal.tilt_deg}° down (lens: {cal.lens}). Sizes are estimated from vehicle sizes (about ±
          {cal.speed_uncertainty_pct}%): type a measured width or length where you know it.
        </Typography>
      )}
      {cal?.warning && (
        <Typography variant="body2" color="warning.main">
          {cal.warning}
        </Typography>
      )}
      {report.carriageways?.map((c, i) => (
        <Typography key={i} variant="body2">
          Carriageway {i + 1}: traffic {DIRECTION[c.direction] ?? c.direction}, {c.width_m} m wide,{' '}
          {c.lanes || '?'} lanes
          {c.kerbs.length ? `, kerb on the ${c.kerbs.join(' and ')}` : ''} ({c.vehicles} vehicles)
        </Typography>
      ))}
      <Typography variant="body2">
        Found {found.intersections ?? 0} junction(s), {found.bus_stops ?? 0} bus stop(s),{' '}
        {found.signal_queues ?? 0} signal queue(s), {found.uturns ?? 0} U-turn opening(s).
      </Typography>
      {report.notes.map((n) => (
        <Typography key={n} variant="body2" color="text.secondary">
          • {n}
        </Typography>
      ))}
      <Typography variant="body2" sx={{ mt: 0.5 }}>
        A video cannot show legal facts: add <b>banned classes</b> (V8), <b>solid lane lines</b>{' '}
        (V5), legal parking and approved bus bays yourself. Check every shape, drag corners to fix
        them, then <b>Save zones</b>.
      </Typography>
    </Alert>
  );
}

/**
 * Zone definition for one camera, from the surveillance page: the web counterpart of the scripts' `--calibrate`
 * window. Opens on a frame of the box's selected source (else the camera's own), saves the zones to the camera.
 * For the other-violations box, zones can be drawn by hand or learned automatically from the traffic (CSE499B
 * autozone), then edited and saved. Speed zones are always drawn and measured by hand, in an editor that works like
 * `speed_tracker.py --calibrate` (SpeedZoneEditor: road zones only, the areas and lane lines pass through).
 */
export default function ZonesDialog({
  camera,
  source,
  purpose,
  autoStart = false,
  onClose,
}: {
  camera: Camera;
  source?: CameraSource;
  /** The box the zones are for: only the other-violations box learns zones automatically. */
  purpose: 'speed' | 'violations';
  /** Start learning the zones from traffic as soon as the dialog opens. */
  autoStart?: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const src = source ?? camera.defaultSource;
  const live = src?.kind === 'ip' || src?.kind === 'webcam';
  const auto = purpose === 'violations';
  const [zones, setZones] = useState<CameraZones>(camera.zones ?? EMPTY);
  const [report, setReport] = useState<AutoZoneReport | null>(
    (auto && camera.zones?.auto?.report) || null,
  );
  const [editorKey, setEditorKey] = useState(0);
  const [frame, setFrame] = useState<CameraFrame | null>(null);
  const [atSec, setAtSec] = useState('30');
  const [progress, setProgress] = useState<AutoZoneStatus | null>(null);
  const cancelled = useRef(false);

  const load = useMutation({
    mutationFn: (t?: number) => trafficService.frame(src!, live ? 0 : (t ?? (Number(atSec) || 0))),
    onSuccess: (f) => {
      setFrame(f);
      if (!live) setAtSec(String(f.atSec)); // the time actually shown (past the video's end it wraps around)
    },
    onError: (e) => toast.error(apiErrorMessage(e, 'Could not read a frame')),
  });
  // "Another frame": a time typed in the field, else FRAME_STEP_SEC further on (the start again after the end).
  // Before, it reloaded the field's unchanged time, so the same frame came back.
  const typed = Number(atSec);
  const typedNew =
    !live &&
    frame != null &&
    atSec.trim() !== '' &&
    Number.isFinite(typed) &&
    typed !== frame.atSec;
  const another = () => {
    if (live || !frame) return load.mutate(undefined);
    if (typedNew) return load.mutate(typed);
    const next = frame.atSec + FRAME_STEP_SEC;
    load.mutate(frame.durationSec && next >= frame.durationSec ? 0 : next);
  };

  // Learning runs in the vision service; poll it until it finishes, then load the proposal as a draft.
  const learn = useMutation({
    mutationFn: async () => {
      cancelled.current = false;
      let st = await trafficService.startAutoZones(camera.id, src);
      setProgress(st);
      while (!cancelled.current && !FINISHED.includes(st.state)) {
        await new Promise((r) => setTimeout(r, 1500));
        try {
          st = await trafficService.autoZones(camera.id);
        } catch {
          continue;
        }
        setProgress(st);
      }
      return st;
    },
    onSuccess: (st) => {
      setProgress(null);
      if (st.state === 'done' && st.result) {
        const cfg = st.result.config;
        setZones(cfg);
        setReport(st.result.report);
        setEditorKey((k) => k + 1);
        // the zones belong to the view of this frame (the camera may have moved later in the video)
        const refT = cfg.auto?.reference_t;
        if (refT != null && !live) {
          setAtSec(String(refT));
          load.mutate(refT);
        }
        toast.success('Zones learned: check them, fix anything wrong, then press Save zones');
      } else if (st.state === 'error') {
        toast.error(st.message || 'Automatic zones failed');
      }
    },
    onError: (e) => {
      setProgress(null);
      toast.error(apiErrorMessage(e, 'Could not learn the zones'));
    },
  });
  const cancelLearning = async () => {
    cancelled.current = true;
    setProgress(null);
    try {
      await trafficService.cancelAutoZones(camera.id);
    } catch {
      // the job ends by itself anyway
    }
  };
  const close = () => {
    if (learn.isPending) void cancelLearning();
    onClose();
  };

  // A frame to draw on as soon as the dialog opens (and learning, if asked for).
  useEffect(() => {
    if (src) load.mutate(undefined);
    if (src && autoStart && auto) learn.mutate();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = frame ? fitZones(zones, frame.width, frame.height) : zones;
  const roads = shown.zones.filter((z) => (z.type ?? 'road') === 'road');
  const unmeasured = roads.filter((z) => !(Number(z.width_m) > 0 && Number(z.length_m) > 0));
  const autoSized = roads.filter((z) => z.scale_source === 'auto');
  const save = useMutation({
    mutationFn: () => trafficService.saveZones(camera.id, shown),
    onSuccess: () => {
      toast.success(`Zones of ${camera.name} saved`);
      qc.invalidateQueries({ queryKey: ['traffic.cameras'] });
      onClose();
    },
    onError: (e) => toast.error(apiErrorMessage(e, 'Could not save the zones')),
  });

  return (
    <Dialog open onClose={close} fullScreen>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Icons.camera /> Define zones: {camera.name}
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            spacing={2}
            sx={{ alignItems: { md: 'center' } }}
          >
            <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
              Frame from:{' '}
              {src
                ? `${src.kind === 'ip' ? 'IP camera' : src.kind} ${live ? '' : src.value.split(/[\\/]/).pop()}`
                : 'no source'}
              {frame?.durationSec ? ` (${Math.round(frame.durationSec)} s long)` : ''}
            </Typography>
            {!live && (
              <TextField
                size="small"
                label="Frame at (s)"
                value={atSec}
                onChange={(e) => setAtSec(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !load.isPending && load.mutate(typed || 0)}
                sx={{ width: 120 }}
              />
            )}
            <Button
              variant="outlined"
              startIcon={load.isPending ? <CircularProgress size={16} /> : <Icons.refresh />}
              disabled={!src || load.isPending}
              onClick={another}
            >
              {!frame || typedNew
                ? 'Load frame'
                : live
                  ? 'Another frame'
                  : `Another frame (+${FRAME_STEP_SEC} s)`}
            </Button>
            {auto && (
              <Button
                variant="contained"
                startIcon={
                  learn.isPending ? (
                    <CircularProgress size={16} color="inherit" />
                  ) : (
                    <Icons.autoZones />
                  )
                }
                disabled={!src || learn.isPending}
                onClick={() => learn.mutate()}
              >
                Detect zones automatically
              </Button>
            )}
          </Stack>

          {progress && (
            <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
              <Stack direction="row" spacing={2} sx={{ alignItems: 'center', mb: 1 }}>
                <Typography variant="subtitle2" sx={{ flex: 1 }}>
                  Learning the road layout from traffic
                </Typography>
                <Button size="small" color="inherit" onClick={cancelLearning}>
                  Cancel
                </Button>
              </Stack>
              <LinearProgress
                variant={progress.progress ? 'determinate' : 'indeterminate'}
                value={(progress.progress ?? 0) * 100}
              />
              <Typography variant="body2" sx={{ mt: 1 }}>
                {progress.message}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                The AI watches up to 7 minutes of the video (a short one to its end), finds each
                carriageway and its direction from the vehicle paths, calibrates the camera from
                vehicle sizes, then marks kerbs, junctions, bus stops, signal queues and U-turns.
                Nothing is saved until you press Save zones.
              </Typography>
            </Paper>
          )}

          {report && !progress && <AutoReport report={report} />}

          {auto ? (
            <Alert severity="info" icon={<Icons.info />}>
              <b>Automatic</b>: press <b>Detect zones automatically</b>, then check and fix the
              result. <b>Manual</b>: draw a <b>road zone</b> by clicking the 4 corners of a
              rectangle on the road (far-left, far-right, near-right, near-left); no measuring
              needed, its size is estimated from vehicle sizes. Select a road zone to set its
              allowed direction (V4), banned classes (V8), and to add <b>no-parking kerb</b> strips
              along its edges (V3; a strip may reach past the road zone&apos;s edge to where
              vehicles stand, and still counts as part of that road). Add an <b>intersection</b> and
              a <b>bus stop</b> just after it (V1), and <b>solid lane lines</b> where they are
              painted (V5). Select any shape to drag its corners or move it.
              {camera.learning && ' Directions seen in the last run are offered as suggestions.'}
            </Alert>
          ) : (
            <Alert severity="info" icon={<Icons.info />}>
              Draw a <b>road zone</b> by clicking the 4 corners of a road rectangle you measured
              (far-left, far-right, near-right, near-left) and type its real width and length: every
              speed depends on them. Set the road type and any lower local limit on the selected
              zone. Select a zone to drag its corners or move it. Speed tracking uses measured road
              zones only.
            </Alert>
          )}
          {auto ? (
            <ZoneEditor
              key={editorKey}
              value={shown}
              onChange={setZones}
              image={frame?.image ?? null}
              frameSize={frame ? [frame.width, frame.height] : shown.frame_size}
              learning={camera.learning}
              purpose={purpose}
            />
          ) : (
            <SpeedZoneEditor
              value={shown}
              onChange={setZones}
              image={frame?.image ?? null}
              frameSize={frame ? [frame.width, frame.height] : shown.frame_size}
            />
          )}
          {unmeasured.length > 0 &&
            (auto ? (
              <Alert severity="info">
                No size typed for {unmeasured.map((z) => z.name).join(', ')}: the box estimates it
                from vehicle sizes when it starts (from this camera&apos;s Auto zones calibration if
                there is one, else it first watches about a minute of traffic).
              </Alert>
            ) : (
              <Alert severity="warning">
                Measure these road zones before saving: {unmeasured.map((z) => z.name).join(', ')}
              </Alert>
            ))}
          {!auto && autoSized.length > 0 && (
            <Alert severity="warning">
              Found by Auto zones, so speed tracking skips them until you type their measured width
              and length: {autoSized.map((z) => z.name).join(', ')}
            </Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 1.5 }}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="caption" color="text.secondary">
            {auto
              ? `${roads.length} road zones, ${shown.zones.length - roads.length} areas, ${shown.lane_lines?.length ?? 0} lane lines`
              : `${roads.length} speed zone${roads.length === 1 ? '' : 's'}`}
          </Typography>
        </Box>
        <Button onClick={close}>Cancel</Button>
        <Button
          variant="contained"
          startIcon={<Icons.save />}
          disabled={
            !roads.length || (!auto && unmeasured.length > 0) || save.isPending || learn.isPending
          }
          onClick={() => save.mutate()}
        >
          Save zones
        </Button>
      </DialogActions>
    </Dialog>
  );
}
