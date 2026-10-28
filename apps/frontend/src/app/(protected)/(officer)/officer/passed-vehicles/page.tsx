'use client';

import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  Link as MuiLink,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import NextLink from 'next/link';
import { useState } from 'react';
import toast from 'react-hot-toast';

import PageHeader from '@/components/common/header/PageHeader';
import PageBody from '@/components/common/layout/PageBody';
import StatusChip from '@/components/common/StatusChip';
import { dhakaDateTime } from '@/components/traffic/format';
import { Icons } from '@/lib/icons';
import { RouteUrls } from '@/lib/routes/route.config';
import trafficService from '@/lib/services/traffic.service';
import type { PassedVehicle, PassedVehicleRun } from '@/lib/types/traffic.types';
import { apiErrorMessage } from '@/lib/utils/common.util';

const ALL_RUNS = 'all';

function runLabel(r: PassedVehicleRun) {
  const when = dhakaDateTime(r.startedAt ?? r.from);
  const what = r.slot === 'plates' ? 'plate box' : r.source || 'run';
  return `${when} · ${what} · ${r.vehicles} vehicles${r.state === 'running' ? ' (running)' : ''}`;
}

/** The two-word look from the vision-language model, or why it is not there yet. */
function Appearance({ v }: { v: PassedVehicle }) {
  if (v.appearance?.status === 'done' && v.appearance.text) return <>{v.appearance.text}</>;
  if (v.appearance?.status === 'pending')
    return (
      <Tooltip title="The AI describes the vehicles while no surveillance box is running (the model and a box do not fit in the GPU together)">
        <Chip size="small" variant="outlined" icon={<Icons.ai />} label="Describing..." />
      </Tooltip>
    );
  return (
    <Typography component="span" variant="body2" color="text.secondary">
      -
    </Typography>
  );
}

function PhotoDialog({ v, onClose }: { v: PassedVehicle; onClose: () => void }) {
  const images = [
    { url: v.vehicleImage, caption: 'Vehicle' },
    {
      url: v.evidenceImage !== v.vehicleImage ? v.evidenceImage : '',
      caption: 'Vehicle and plate',
    },
    { url: v.plateImage, caption: 'Number plate' },
  ].filter((i) => i.url);
  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle component="div" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography variant="h6" component="h2" sx={{ flex: 1 }}>
          #{v.trackId} {v.vehicleClass}
          {v.appearance?.status === 'done' && v.appearance.text ? ` · ${v.appearance.text}` : ''}
        </Typography>
        <IconButton onClick={onClose} aria-label="Close">
          <Icons.close />
        </IconButton>
      </DialogTitle>
      <DialogContent>
        <Typography variant="body2" component="div" sx={{ mb: 1.5 }}>
          {v.registration || 'No registration read'} <StatusChip status={v.plateStatus} /> · seen{' '}
          {dhakaDateTime(v.firstSeen)} to {dhakaDateTime(v.lastSeen)} · {v.cameraName}
        </Typography>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={2}
          sx={{ alignItems: 'flex-start' }}
        >
          {images.map((i) => (
            <Box
              key={i.caption}
              sx={{ flex: i.caption === 'Number plate' ? '0 0 auto' : 1, minWidth: 0 }}
            >
              <Box
                component="img"
                src={i.url}
                alt={i.caption}
                sx={{
                  width: i.caption === 'Number plate' ? 200 : '100%',
                  maxHeight: 420,
                  objectFit: 'contain',
                  bgcolor: '#0b0f14',
                  borderRadius: 1.5,
                  display: 'block',
                  imageRendering: i.caption === 'Number plate' ? 'pixelated' : 'auto',
                }}
              />
              <Typography variant="caption" color="text.secondary">
                {i.caption}
              </Typography>
            </Box>
          ))}
        </Stack>
      </DialogContent>
    </Dialog>
  );
}

export default function PassedVehiclesPage() {
  const cameras = useQuery({
    queryKey: ['traffic.passed.cameras'],
    queryFn: () => trafficService.passedVehicleCameras(),
    refetchInterval: 30_000,
  });
  const [cameraChoice, setCameraChoice] = useState('');
  // The camera that listed vehicles most recently comes first.
  const cameraId = cameraChoice || cameras.data?.[0]?.id || '';
  const runs = useQuery({
    queryKey: ['traffic.passed.runs', cameraId],
    queryFn: () => trafficService.passedVehicleRuns(cameraId),
    enabled: !!cameraId,
    refetchInterval: 10_000,
  });
  const [runChoice, setRunChoice] = useState<string | null>(null); // null: the newest run
  const runId = runChoice ?? runs.data?.[0]?.runId ?? ALL_RUNS;
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [limit, setLimit] = useState(50);
  const [photo, setPhoto] = useState<PassedVehicle | null>(null);

  const filter = {
    cameraId,
    runId: runId === ALL_RUNS ? undefined : runId,
    search: search.trim() || undefined,
  };
  const list = useQuery({
    queryKey: ['traffic.passed', filter, page, limit],
    queryFn: () => trafficService.passedVehicles({ ...filter, page: page + 1, limit }),
    enabled: !!cameraId && runs.isFetched,
    placeholderData: keepPreviousData,
    refetchInterval: 10_000,
  });
  const csv = useMutation({
    mutationFn: () =>
      trafficService.passedVehiclesCsv(
        filter,
        `passed_vehicles_${cameras.data?.find((c) => c.id === cameraId)?.code ?? 'list'}.csv`,
      ),
    onError: (e) => toast.error(apiErrorMessage(e, 'Could not download the list')),
  });

  const run = runs.data?.find((r) => r.runId === runId);
  const describing = run ? run.describing : (runs.data ?? []).reduce((n, r) => n + r.describing, 0);
  const rows = list.data?.docs ?? [];

  return (
    <>
      <PageHeader
        title="Passed Vehicles"
        subtitle="Every vehicle the other-violations box saw pass a camera: its plate, when it was first and last seen, and what it looks like."
        icon={Icons.passedVehicles}
      />
      <PageBody>
        {cameras.isError && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {apiErrorMessage(cameras.error, 'Could not load the cameras')}
          </Alert>
        )}
        <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            spacing={2}
            sx={{ p: 2, borderBottom: 1, borderColor: 'divider', alignItems: { md: 'center' } }}
          >
            <TextField
              select
              size="small"
              label="Camera point"
              value={cameraId}
              onChange={(e) => {
                setCameraChoice(e.target.value);
                setRunChoice(null);
                setPage(0);
              }}
              sx={{ minWidth: 300 }}
            >
              {(cameras.data ?? []).map((c) => (
                <MenuItem key={c.id} value={c.id}>
                  {c.name} ({c.code}) · {c.vehicles} vehicles
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              size="small"
              label="Run"
              value={runs.data?.length ? runId : ALL_RUNS}
              onChange={(e) => {
                setRunChoice(e.target.value);
                setPage(0);
              }}
              sx={{ minWidth: 320, flex: 1 }}
              disabled={!runs.data?.length}
            >
              <MenuItem value={ALL_RUNS}>All runs</MenuItem>
              {(runs.data ?? []).map((r) => (
                <MenuItem key={r.runId} value={r.runId}>
                  {runLabel(r)}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              size="small"
              placeholder="Plate, class, look or ID"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
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
            <Button
              variant="outlined"
              startIcon={csv.isPending ? <CircularProgress size={16} /> : <Icons.download />}
              disabled={!cameraId || !list.data?.totalDocs || csv.isPending}
              onClick={() => csv.mutate()}
            >
              CSV
            </Button>
          </Stack>
          {list.data && (
            <Typography variant="body2" color="text.secondary" sx={{ px: 2, pt: 1.5 }}>
              {list.data.totalDocs} vehicles
              {describing > 0 &&
                ` · the AI is still describing ${describing} (it works while no surveillance box is running)`}
            </Typography>
          )}
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Vehicle ID</TableCell>
                  <TableCell>Vehicle class</TableCell>
                  <TableCell>Registration number</TableCell>
                  <TableCell>First seen</TableCell>
                  <TableCell>Last seen</TableCell>
                  <TableCell>Appearance</TableCell>
                  <TableCell align="center">Photo</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((v) => (
                  <TableRow key={v.id} hover>
                    <TableCell sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                      {v.vid ? (
                        <MuiLink component={NextLink} href={`${RouteUrls.officer.track}?vid=${v.vid}`} sx={{ fontFamily: 'monospace' }}>
                          {v.vid}
                        </MuiLink>
                      ) : (
                        <Typography variant="body2" color="text.secondary" component="span">
                          assigning…
                        </Typography>
                      )}
                      <Typography variant="caption" color="text.secondary" component="div">
                        track #{v.trackId}
                      </Typography>
                    </TableCell>
                    <TableCell>{v.vehicleClass}</TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                        <Typography
                          variant="body2"
                          sx={{ fontFamily: 'monospace' }}
                          color={v.registration ? 'text.primary' : 'text.secondary'}
                        >
                          {v.registration || '-'}
                        </Typography>
                        <StatusChip status={v.plateStatus} />
                      </Stack>
                    </TableCell>
                    <TableCell>{dhakaDateTime(v.firstSeen)}</TableCell>
                    <TableCell>{dhakaDateTime(v.lastSeen)}</TableCell>
                    <TableCell>
                      <Appearance v={v} />
                    </TableCell>
                    <TableCell align="center" sx={{ py: 0.5 }}>
                      {v.vehicleImage ? (
                        <Box
                          component="img"
                          src={v.vehicleImage}
                          alt={`#${v.trackId} ${v.vehicleClass}`}
                          onClick={() => setPhoto(v)}
                          sx={{
                            height: 44,
                            width: 64,
                            objectFit: 'cover',
                            borderRadius: 1,
                            cursor: 'zoom-in',
                            display: 'block',
                            mx: 'auto',
                          }}
                        />
                      ) : (
                        '-'
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {!rows.length && (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      sx={{ color: 'text.secondary', textAlign: 'center', py: 4 }}
                    >
                      {list.isFetching || cameras.isLoading
                        ? 'Loading...'
                        : search
                          ? 'No vehicle matches the search.'
                          : 'No vehicles listed for this camera yet. Run the Other violations box on it (Surveillance): every vehicle that passes is listed here with its plate.'}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
          <TablePagination
            component="div"
            count={list.data?.totalDocs ?? 0}
            page={page}
            onPageChange={(_, p) => setPage(p)}
            rowsPerPage={limit}
            rowsPerPageOptions={[25, 50, 100, 200]}
            onRowsPerPageChange={(e) => {
              setLimit(Number(e.target.value));
              setPage(0);
            }}
          />
        </Paper>
      </PageBody>
      {photo && <PhotoDialog v={photo} onClose={() => setPhoto(null)} />}
    </>
  );
}
