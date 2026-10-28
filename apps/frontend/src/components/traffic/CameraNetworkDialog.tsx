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
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';

import { Icons } from '@/lib/icons';
import trafficService from '@/lib/services/traffic.service';
import type { Camera, CameraFrame, CameraGate, CameraLink } from '@/lib/types/traffic.types';
import { apiErrorMessage } from '@/lib/utils/common.util';

type Pt = [number, number];
const COLORS = ['#00b4ff', '#ffb000', '#00d084', '#ff5c8a', '#a970ff', '#ff7a00', '#00e5e5', '#e6e600'];

/**
 * A camera's place in the camera network (multi-camera tracking), like the paper's crossroad zones: gates = areas of
 * the picture where vehicles come into or leave the view (click the outline on a frame), links = "leaving through
 * this gate, a vehicle reaches that camera's gate after min..max seconds". The next camera keeps a vehicle's
 * Vehicle ID only for vehicles that left through a linked gate within that time.
 */
export default function CameraNetworkDialog({
  camera,
  cameras,
  onClose,
}: {
  camera: Camera;
  cameras: Camera[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [gates, setGates] = useState<CameraGate[]>(camera.network?.gates ?? []);
  const [links, setLinks] = useState<CameraLink[]>(camera.network?.links ?? []);
  const [frame, setFrame] = useState<CameraFrame | null>(null);
  const [drawing, setDrawing] = useState<Pt[] | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const zonesSize = (camera.zones as { frame_size?: [number, number] } | undefined)?.frame_size;
  const size: [number, number] = frame ? [frame.width, frame.height] : (camera.network?.frameSize ?? zonesSize ?? [1920, 1080]);

  const load = useMutation({
    mutationFn: () => trafficService.frame(camera.defaultSource!, 20),
    onSuccess: setFrame,
    onError: (e) => toast.error(apiErrorMessage(e, 'Could not load a frame (is the vision service running?)')),
  });
  useEffect(() => {
    if (camera.defaultSource) load.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = useMutation({
    mutationFn: () => trafficService.saveNetwork(camera.id, { frameSize: size, gates, links }),
    onSuccess: () => {
      toast.success('Camera network saved');
      qc.invalidateQueries({ queryKey: ['traffic.cameras'] });
      qc.invalidateQueries({ queryKey: ['cameras'] });
      onClose();
    },
    onError: (e) => toast.error(apiErrorMessage(e, 'Could not save')),
  });

  const click = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!drawing || !svgRef.current) return;
    const r = svgRef.current.getBoundingClientRect();
    const x = Math.round(((e.clientX - r.left) / r.width) * size[0]);
    const y = Math.round(((e.clientY - r.top) / r.height) * size[1]);
    setDrawing([...drawing, [x, y]]);
  };
  const finish = () => {
    if (!drawing || drawing.length < 3) return;
    let n = gates.length + 1;
    while (gates.some((g) => g.id === `G${n}`)) n++;
    setGates([...gates, { id: `G${n}`, name: `Gate ${n}`, points: drawing }]);
    setDrawing(null);
  };
  const setGate = (i: number, patch: Partial<CameraGate>) => setGates(gates.map((g, k) => (k === i ? { ...g, ...patch } : g)));
  const setLink = (i: number, patch: Partial<CameraLink>) => setLinks(links.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const others = cameras.filter((c) => c.id !== camera.id);
  const stroke = Math.max(2, size[0] / 500);

  return (
    <Dialog open onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle>Camera network: {camera.name} ({camera.code})</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            <b>Gates</b>: draw where vehicles come into and leave this camera&apos;s view (e.g. the far end of each
            carriageway, the near end, a side road). <b>Links</b>: where a vehicle leaving through a gate turns up next,
            and how long that takes. A vehicle keeps its Vehicle ID at the next camera when it left through the linked
            gate within that time and looks the same (or its plate matches).
          </Typography>

          <Box sx={{ position: 'relative', bgcolor: '#0b0f14', borderRadius: 1, overflow: 'hidden', aspectRatio: `${size[0]} / ${size[1]}` }}>
            {frame && <Box component="img" src={frame.image} alt="" sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />}
            {!frame && (
              <Stack sx={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center', color: '#aaa' }}>
                {load.isPending ? <CircularProgress size={28} /> : <Typography variant="body2">No frame loaded</Typography>}
              </Stack>
            )}
            <svg
              ref={svgRef}
              viewBox={`0 0 ${size[0]} ${size[1]}`}
              preserveAspectRatio="none"
              onClick={click}
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', cursor: drawing ? 'crosshair' : 'default' }}
            >
              {gates.map((g, i) => {
                const c = COLORS[i % COLORS.length];
                const cx = g.points.reduce((s, p) => s + p[0], 0) / g.points.length;
                const cy = g.points.reduce((s, p) => s + p[1], 0) / g.points.length;
                return (
                  <g key={`${g.id}-${i}`}>
                    <polygon points={g.points.map((p) => p.join(',')).join(' ')} fill={`${c}33`} stroke={c} strokeWidth={stroke} />
                    <text x={cx} y={cy} fill="#fff" stroke="#000" strokeWidth={stroke / 2} fontSize={size[0] / 45} textAnchor="middle" fontWeight={700}>
                      {g.id}
                    </text>
                  </g>
                );
              })}
              {drawing && drawing.length > 0 && (
                <>
                  <polyline points={drawing.map((p) => p.join(',')).join(' ')} fill="none" stroke="#fff" strokeWidth={stroke} strokeDasharray="8 6" />
                  {drawing.map((p, i) => (
                    <circle key={i} cx={p[0]} cy={p[1]} r={stroke * 2.5} fill="#fff" />
                  ))}
                </>
              )}
            </svg>
          </Box>
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
            {camera.defaultSource && (
              <Button size="small" variant="outlined" onClick={() => load.mutate()} disabled={load.isPending}>
                Reload frame
              </Button>
            )}
            {!drawing ? (
              <Button size="small" variant="contained" startIcon={<Icons.add />} onClick={() => setDrawing([])}>
                New gate
              </Button>
            ) : (
              <>
                <Typography variant="body2" sx={{ alignSelf: 'center' }}>
                  Click the gate&apos;s outline on the picture ({drawing.length} points)
                </Typography>
                <Button size="small" variant="contained" disabled={drawing.length < 3} onClick={finish}>
                  Finish gate
                </Button>
                <Button size="small" disabled={!drawing.length} onClick={() => setDrawing(drawing.slice(0, -1))}>
                  Undo point
                </Button>
                <Button size="small" onClick={() => setDrawing(null)}>
                  Cancel
                </Button>
              </>
            )}
          </Stack>

          <Box>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              Gates ({gates.length})
            </Typography>
            {!gates.length && <Typography variant="body2" color="text.secondary">No gates yet.</Typography>}
            <Stack spacing={1}>
              {gates.map((g, i) => (
                <Stack key={i} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <Box sx={{ width: 14, height: 14, borderRadius: 0.5, bgcolor: COLORS[i % COLORS.length], flex: '0 0 auto' }} />
                  <TextField size="small" label="Id" value={g.id} onChange={(e) => setGate(i, { id: e.target.value.replace(/[^A-Za-z0-9_-]/g, '') })} sx={{ width: 130 }} />
                  <TextField size="small" label="Name" value={g.name} onChange={(e) => setGate(i, { name: e.target.value })} fullWidth />
                  <Tooltip title="Delete gate">
                    <IconButton onClick={() => setGates(gates.filter((_, k) => k !== i))}>
                      <Icons.delete />
                    </IconButton>
                  </Tooltip>
                </Stack>
              ))}
            </Stack>
          </Box>

          <Box>
            <Stack direction="row" sx={{ alignItems: 'center', mb: 1 }}>
              <Typography variant="subtitle2" sx={{ flex: 1 }}>
                Links to the next cameras ({links.length})
              </Typography>
              <Button
                size="small"
                startIcon={<Icons.add />}
                disabled={!others.length}
                onClick={() => setLinks([...links, { fromGate: gates[0]?.id ?? '', toCameraId: others[0]?.id ?? '', toGate: '', minS: 30, maxS: 600 }])}
              >
                Add link
              </Button>
            </Stack>
            {!links.length && (
              <Typography variant="body2" color="text.secondary">
                No links: vehicles keep their Vehicle ID at this camera only (and wherever their confirmed plate is read).
              </Typography>
            )}
            <Stack spacing={1}>
              {links.map((l, i) => {
                const target = cameras.find((c) => c.id === l.toCameraId);
                return (
                  <Stack key={i} direction={{ xs: 'column', md: 'row' }} spacing={1} sx={{ alignItems: { md: 'center' } }}>
                    <TextField select size="small" label="Leaving through" value={l.fromGate} onChange={(e) => setLink(i, { fromGate: e.target.value })} sx={{ minWidth: 150 }}>
                      <MenuItem value="">any gate</MenuItem>
                      {gates.map((g) => (
                        <MenuItem key={g.id} value={g.id}>
                          {g.id} · {g.name}
                        </MenuItem>
                      ))}
                    </TextField>
                    <TextField select size="small" label="Reaches camera" value={l.toCameraId} onChange={(e) => setLink(i, { toCameraId: e.target.value, toGate: '' })} sx={{ minWidth: 200 }}>
                      {others.map((c) => (
                        <MenuItem key={c.id} value={c.id}>
                          {c.name} ({c.code})
                        </MenuItem>
                      ))}
                    </TextField>
                    <TextField select size="small" label="At its gate" value={l.toGate} onChange={(e) => setLink(i, { toGate: e.target.value })} sx={{ minWidth: 150 }}>
                      <MenuItem value="">any gate</MenuItem>
                      {(target?.network?.gates ?? []).map((g) => (
                        <MenuItem key={g.id} value={g.id}>
                          {g.id} · {g.name}
                        </MenuItem>
                      ))}
                    </TextField>
                    <TextField size="small" type="number" label="After at least (s)" value={l.minS} onChange={(e) => setLink(i, { minS: Number(e.target.value) })} sx={{ width: 150 }} />
                    <TextField size="small" type="number" label="At most (s)" value={l.maxS} onChange={(e) => setLink(i, { maxS: Number(e.target.value) })} sx={{ width: 120 }} />
                    <TextField size="small" type="number" label="Distance (m)" value={l.distanceM ?? ''} onChange={(e) => setLink(i, { distanceM: e.target.value ? Number(e.target.value) : undefined })} sx={{ width: 120 }} />
                    <Tooltip title="Delete link">
                      <IconButton onClick={() => setLinks(links.filter((_, k) => k !== i))}>
                        <Icons.delete />
                      </IconButton>
                    </Tooltip>
                  </Stack>
                );
              })}
            </Stack>
            {links.some((l) => !(l.maxS > l.minS && l.minS >= 0)) && (
              <Alert severity="warning" sx={{ mt: 1 }}>
                A link&apos;s &quot;at most&quot; must be longer than its &quot;at least&quot;.
              </Alert>
            )}
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" startIcon={<Icons.save />} disabled={save.isPending || !!drawing} onClick={() => save.mutate()}>
          Save network
        </Button>
      </DialogActions>
    </Dialog>
  );
}
