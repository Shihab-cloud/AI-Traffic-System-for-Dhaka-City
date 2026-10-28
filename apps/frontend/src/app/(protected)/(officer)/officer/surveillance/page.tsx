'use client';

import {
  Alert,
  Box,
  Chip,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';

import PageHeader from '@/components/common/header/PageHeader';
import PageBody from '@/components/common/layout/PageBody';
import StatusChip from '@/components/common/StatusChip';
import { dhakaDateTime } from '@/components/traffic/format';
import SurveillanceBox from '@/components/traffic/SurveillanceBox';
import useHasPermission from '@/hooks/useHasPermission';
import { PermissionsEnum } from '@/lib/enums/permission.enum';
import { Icons } from '@/lib/icons';
import trafficService from '@/lib/services/traffic.service';
import type { SlotName } from '@/lib/types/traffic.types';

const ORDER: SlotName[] = ['speed', 'violations'];

export default function SurveillancePage() {
  const status = useQuery({
    queryKey: ['traffic.slots'],
    queryFn: () => trafficService.slots(),
    refetchInterval: 2000,
  });
  const cameras = useQuery({
    queryKey: ['traffic.cameras'],
    queryFn: () => trafficService.cameras(),
  });
  // The run history is for admins (officers start and stop the boxes).
  const { hasPermission: isAdmin } = useHasPermission([PermissionsEnum.ADMIN]);
  const runs = useQuery({
    queryKey: ['traffic.runs'],
    queryFn: () => trafficService.runs({ limit: 10 }),
    refetchInterval: 15000,
    enabled: isAdmin,
  });
  const s = status.data;
  const delivery = s?.delivery;

  return (
    <>
      <PageHeader
        title="Surveillance"
        subtitle="Run detection on IP cameras or recorded video. What each box shows is the detection view of its script."
        icon={Icons.surveillance}
        rightSlot={
          s && (
            <Chip
              size="small"
              variant="outlined"
              color={s.online ? 'success' : 'error'}
              label={s.online ? 'Vision service online' : 'Vision service offline'}
            />
          )
        }
      />
      <PageBody>
        {s && !s.online && (
          <Alert severity="error" sx={{ mb: 2 }}>
            The vision service is not running. Start it on the processing computer:{' '}
            <code>cd vision</code> then <code>python server.py</code> (with the project&apos;s .venv
            active).
          </Alert>
        )}
        {delivery && delivery.pending > 0 && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            {delivery.pending} records are waiting to reach the server ({delivery.lastError}). They
            are kept and sent again automatically.
          </Alert>
        )}
        <Box
          sx={{
            display: 'grid',
            gap: 2,
            gridTemplateColumns: { xs: '1fr', xl: '1fr 1fr' },
            alignItems: 'start',
          }}
        >
          {ORDER.map((name) => {
            const slot = s?.slots.find((x) => x.slot === name);
            return slot ? (
              <SurveillanceBox key={name} slot={slot} cameras={cameras.data ?? []} />
            ) : (
              <Paper key={name} variant="outlined" sx={{ borderRadius: 2, p: 2, minHeight: 240 }} />
            );
          })}
        </Box>

        {isAdmin && (
          <>
            <Typography variant="subtitle1" sx={{ fontWeight: 700, mt: 4, mb: 1 }}>
              Recent runs
            </Typography>
            <Paper variant="outlined" sx={{ borderRadius: 2, overflowX: 'auto' }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Box</TableCell>
                    <TableCell>Camera</TableCell>
                    <TableCell>Source</TableCell>
                    <TableCell>Started</TableCell>
                    <TableCell>By</TableCell>
                    <TableCell>Found</TableCell>
                    <TableCell>State</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(runs.data?.docs ?? []).map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>{r.slot}</TableCell>
                      <TableCell>{r.cameraName || '-'}</TableCell>
                      <TableCell>
                        {r.source?.kind}: {r.source?.value}
                      </TableCell>
                      <TableCell>{dhakaDateTime(r.startedAt)}</TableCell>
                      <TableCell>{r.startedByName || '-'}</TableCell>
                      <TableCell>
                        {Object.entries(r.stats ?? {})
                          .map(([k, v]) => `${v} ${k}`)
                          .join(', ') || '-'}
                      </TableCell>
                      <TableCell>
                        <StatusChip status={r.state} />
                      </TableCell>
                    </TableRow>
                  ))}
                  {!runs.data?.docs.length && (
                    <TableRow>
                      <TableCell
                        colSpan={7}
                        sx={{ color: 'text.secondary', textAlign: 'center', py: 3 }}
                      >
                        No runs yet.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </Paper>
          </>
        )}
      </PageBody>
    </>
  );
}
