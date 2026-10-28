'use client';

import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import toast from 'react-hot-toast';

import PageHeader from '@/components/common/header/PageHeader';
import PageBody from '@/components/common/layout/PageBody';
import CameraNetworkDialog from '@/components/traffic/CameraNetworkDialog';
import ZoneEditor, { fitZones } from '@/components/traffic/ZoneEditor';
import { Icons } from '@/lib/icons';
import trafficService from '@/lib/services/traffic.service';
import type { Camera, CameraZones, SourceKind } from '@/lib/types/traffic.types';
import { apiErrorMessage } from '@/lib/utils/common.util';

type Draft = Omit<Camera, 'id'> & { id?: string };

const EMPTY: Draft = {
  name: '',
  code: '',
  address: '',
  speedLimitKph: 60,
  active: true,
  notes: '',
  defaultSource: { kind: 'ip', value: '' },
  zones: { frame_size: [1920, 1080], zones: [], lane_lines: [], peak_hours: [['07:00', '10:30'], ['16:00', '20:30']] },
};

function CameraEditor({ draft, onClose }: { draft: Draft | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [d, setD] = useState<Draft | null>(draft);
  const [frame, setFrame] = useState<{ image: string; width: number; height: number } | null>(null);
  const [atSec, setAtSec] = useState('0');
  const videos = useQuery({ queryKey: ['traffic.videos'], queryFn: () => trafficService.videos(), enabled: !!draft });

  const loadFrame = useMutation({
    mutationFn: () => trafficService.frame(d!.defaultSource!, Number(atSec) || 0),
    onSuccess: (f) => setFrame(f),
    onError: (e) => toast.error(apiErrorMessage(e, 'Could not read a frame')),
  });
  const save = useMutation({
    mutationFn: () => {
      const { id, ...body } = d!;
      return trafficService.saveCamera(
        { ...body, lat: body.lat || undefined, lng: body.lng || undefined, defaultSource: body.defaultSource?.value ? body.defaultSource : undefined },
        id,
      );
    },
    onSuccess: () => {
      toast.success('Camera saved');
      qc.invalidateQueries({ queryKey: ['traffic.cameras'] });
      onClose();
    },
    onError: (e) => toast.error(apiErrorMessage(e, 'Could not save')),
  });
  if (!draft || !d) return null;
  const zones = d.zones ?? EMPTY.zones!;
  const frameSize: [number, number] = frame ? [frame.width, frame.height] : zones.frame_size;
  const set = (patch: Partial<Draft>) => setD({ ...d, ...patch });
  const src = d.defaultSource ?? { kind: 'ip' as SourceKind, value: '' };

  return (
    <Dialog open onClose={onClose} fullScreen>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Icons.camera /> {d.id ? `Edit ${d.name}` : 'New camera'}
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: '2fr 1fr 2fr 1fr 1fr 1fr' } }}>
            <TextField size="small" label="Name" value={d.name} onChange={(e) => set({ name: e.target.value })} />
            <TextField size="small" label="Code" value={d.code} onChange={(e) => set({ code: e.target.value })} helperText="e.g. KAK-01" />
            <TextField size="small" label="Address" value={d.address} onChange={(e) => set({ address: e.target.value })} />
            <TextField size="small" type="number" label="Latitude" value={d.lat ?? ''} onChange={(e) => set({ lat: e.target.value ? Number(e.target.value) : undefined })} />
            <TextField size="small" type="number" label="Longitude" value={d.lng ?? ''} onChange={(e) => set({ lng: e.target.value ? Number(e.target.value) : undefined })} />
            <TextField
              size="small"
              type="number"
              label="Speed limit (km/h)"
              value={d.speedLimitKph}
              onChange={(e) => set({ speedLimitKph: Number(e.target.value) })}
            />
          </Box>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ alignItems: { md: 'center' } }}>
            <TextField
              select
              size="small"
              label="Source"
              value={src.kind}
              onChange={(e) => set({ defaultSource: { kind: e.target.value as SourceKind, value: '' } })}
              sx={{ minWidth: 150 }}
            >
              <MenuItem value="ip">IP camera</MenuItem>
              <MenuItem value="webcam">Webcam</MenuItem>
              <MenuItem value="file">Video file</MenuItem>
              <MenuItem value="upload">Uploaded video</MenuItem>
            </TextField>
            {src.kind === 'file' || src.kind === 'upload' ? (
              <TextField
                select
                size="small"
                label="Video"
                value={src.value}
                onChange={(e) => set({ defaultSource: { kind: src.kind, value: e.target.value } })}
                sx={{ flex: 1 }}
              >
                {(videos.data?.videos ?? [])
                  .filter((v) => v.kind === src.kind)
                  .map((v) => (
                    <MenuItem key={v.path} value={v.kind === 'upload' ? v.name : v.path}>
                      {v.name}
                    </MenuItem>
                  ))}
              </TextField>
            ) : (
              <TextField
                size="small"
                label={src.kind === 'webcam' ? 'Webcam number' : 'Stream address (rtsp:// or http://)'}
                value={src.value}
                onChange={(e) => set({ defaultSource: { kind: src.kind, value: e.target.value } })}
                sx={{ flex: 1 }}
              />
            )}
            {(src.kind === 'file' || src.kind === 'upload') && (
              <TextField size="small" label="Frame at (s)" value={atSec} onChange={(e) => setAtSec(e.target.value)} sx={{ width: 120 }} />
            )}
            <Button
              variant="outlined"
              startIcon={loadFrame.isPending ? <CircularProgress size={16} /> : <Icons.camera />}
              disabled={!src.value || loadFrame.isPending}
              onClick={() => loadFrame.mutate()}
            >
              Load frame
            </Button>
            <FormControlLabel control={<Checkbox checked={d.active} onChange={(e) => set({ active: e.target.checked })} />} label="Active" />
          </Stack>
          {frame && zones.zones.length > 0 && (frame.width !== zones.frame_size[0] || frame.height !== zones.frame_size[1]) && (
            <Alert severity="info">
              The zones were drawn on a {zones.frame_size[0]}x{zones.frame_size[1]} frame and this frame is {frame.width}x{frame.height}:
              they are scaled to it when you save.
            </Alert>
          )}
          <ZoneEditor
            value={frame ? fitZones(zones, frame.width, frame.height) : zones}
            onChange={(z: CameraZones) => set({ zones: z })}
            image={frame?.image ?? null}
            frameSize={frameSize}
            learning={d.learning}
          />
          <TextField size="small" label="Notes" value={d.notes} onChange={(e) => set({ notes: e.target.value })} multiline />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 1.5 }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" startIcon={<Icons.save />} disabled={!d.name || !d.code || save.isPending} onClick={() => save.mutate()}>
          Save camera
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default function CamerasPage() {
  const qc = useQueryClient();
  const cameras = useQuery({ queryKey: ['traffic.cameras'], queryFn: () => trafficService.cameras() });
  const [editing, setEditing] = useState<Draft | null>(null);
  const [network, setNetwork] = useState<Camera | null>(null);
  const remove = useMutation({
    mutationFn: (id: string) => trafficService.deleteCamera(id),
    onSuccess: (r) => {
      toast.success(r.deactivated ? 'Camera has evidence: deactivated instead of deleted' : 'Camera deleted');
      qc.invalidateQueries({ queryKey: ['traffic.cameras'] });
    },
    onError: (e) => toast.error(apiErrorMessage(e, 'Could not delete')),
  });

  return (
    <>
      <PageHeader
        title="Cameras & zones"
        subtitle="Each camera view: its source, location, speed limit, and the measured road zones and areas the rules use."
        icon={Icons.camera}
        rightSlot={
          <Button variant="contained" startIcon={<Icons.add />} onClick={() => setEditing({ ...EMPTY })}>
            Add camera
          </Button>
        }
      />
      <PageBody>
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
          {(cameras.data ?? []).map((c) => {
            const roads = c.zones?.zones?.filter((z) => (z.type ?? 'road') === 'road') ?? [];
            const areas = (c.zones?.zones?.length ?? 0) - roads.length;
            return (
              <Paper key={c.id} variant="outlined" sx={{ p: 2, borderRadius: 2, opacity: c.active ? 1 : 0.6 }}>
                <Stack direction="row" sx={{ alignItems: 'center', mb: 1 }}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 700, flex: 1 }}>
                    {c.name}
                  </Typography>
                  <Chip size="small" label={c.code} />
                </Stack>
                <Typography variant="body2" color="text.secondary">
                  {c.address || 'No address'}
                </Typography>
                <Typography variant="body2" sx={{ mt: 1 }}>
                  {roads.length} road zone{roads.length === 1 ? '' : 's'}, {areas} area{areas === 1 ? '' : 's'},{' '}
                  {c.zones?.lane_lines?.length ?? 0} lane lines · limit {c.speedLimitKph} km/h
                </Typography>
                <Typography variant="caption" color="text.secondary" component="div" noWrap>
                  {c.defaultSource ? `${c.defaultSource.kind}: ${c.defaultSource.value}` : 'No default source'}
                </Typography>
                {!c.active && <Chip size="small" label="Inactive" sx={{ mt: 1 }} />}
                <Typography variant="caption" color="text.secondary" component="div">
                  Network: {c.network?.gates?.length ?? 0} gates, {c.network?.links?.length ?? 0} links to next cameras
                </Typography>
                <Stack direction="row" spacing={1} sx={{ mt: 1.5, flexWrap: 'wrap', rowGap: 1 }}>
                  <Button size="small" variant="outlined" startIcon={<Icons.edit />} onClick={() => setEditing({ ...c })}>
                    Edit & zones
                  </Button>
                  <Button size="small" variant="outlined" startIcon={<Icons.track />} onClick={() => setNetwork(c)}>
                    Network
                  </Button>
                  <Button size="small" color="error" startIcon={<Icons.delete />} onClick={() => confirm(`Delete ${c.name}?`) && remove.mutate(c.id)}>
                    Delete
                  </Button>
                </Stack>
              </Paper>
            );
          })}
        </Box>
        {!cameras.isLoading && !cameras.data?.length && (
          <Typography color="text.secondary" sx={{ textAlign: 'center', py: 6 }}>
            No cameras yet.
          </Typography>
        )}
      </PageBody>
      {editing && <CameraEditor key={editing.id ?? 'new'} draft={editing} onClose={() => setEditing(null)} />}
      {network && <CameraNetworkDialog camera={network} cameras={cameras.data ?? []} onClose={() => setNetwork(null)} />}
    </>
  );
}
