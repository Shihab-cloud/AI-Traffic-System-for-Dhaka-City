'use client';

import {
  Alert,
  Button,
  Checkbox,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import toast from 'react-hot-toast';

import PageHeader from '@/components/common/header/PageHeader';
import PageBody from '@/components/common/layout/PageBody';
import { Icons } from '@/lib/icons';
import trafficService from '@/lib/services/traffic.service';
import type { Fine } from '@/lib/types/traffic.types';
import { apiErrorMessage } from '@/lib/utils/common.util';

function FineRow({ fine }: { fine: Fine }) {
  const qc = useQueryClient();
  const [f, setF] = useState(fine);
  const dirty = JSON.stringify(f) !== JSON.stringify(fine);
  const save = useMutation({
    mutationFn: () =>
      trafficService.saveFine(f.code, {
        title: f.title,
        amount: Number(f.amount),
        dueDays: Number(f.dueDays),
        legalReference: f.legalReference,
        description: f.description,
        active: f.active,
      }),
    onSuccess: () => {
      toast.success(`${f.code} saved`);
      qc.invalidateQueries({ queryKey: ['traffic.fines'] });
    },
    onError: (e) => toast.error(apiErrorMessage(e, 'Could not save')),
  });
  return (
    <TableRow>
      <TableCell sx={{ fontWeight: 700 }}>{f.code}</TableCell>
      <TableCell>
        <TextField size="small" variant="standard" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} fullWidth />
      </TableCell>
      <TableCell sx={{ width: 130 }}>
        <TextField size="small" variant="standard" type="number" value={f.amount} onChange={(e) => setF({ ...f, amount: Number(e.target.value) })} />
      </TableCell>
      <TableCell sx={{ width: 90 }}>
        <TextField size="small" variant="standard" type="number" value={f.dueDays} onChange={(e) => setF({ ...f, dueDays: Number(e.target.value) })} />
      </TableCell>
      <TableCell>
        <TextField
          size="small"
          variant="standard"
          placeholder="e.g. Road Transport Act 2018, section ..."
          value={f.legalReference}
          onChange={(e) => setF({ ...f, legalReference: e.target.value })}
          fullWidth
        />
      </TableCell>
      <TableCell padding="checkbox">
        <Checkbox checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />
      </TableCell>
      <TableCell align="right">
        <Button size="small" variant={dirty ? 'contained' : 'text'} disabled={!dirty || save.isPending} onClick={() => save.mutate()} startIcon={<Icons.save />}>
          Save
        </Button>
      </TableCell>
    </TableRow>
  );
}

export default function FinesPage() {
  const fines = useQuery({ queryKey: ['traffic.fines'], queryFn: () => trafficService.fines() });
  return (
    <>
      <PageHeader title="Fines" subtitle="The fine and the time to pay for each violation type. Tickets use the values at the time they are sent." icon={Icons.fines} />
      <PageBody width="8xl">
        <Alert severity="warning" sx={{ mb: 2 }}>
          The amounts were filled in as placeholders. Check each one against the Road Transport Act 2018 (and its rules) and
          fill in the legal reference before tickets are sent to the public.
        </Alert>
        <Paper variant="outlined" sx={{ borderRadius: 2, overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Code</TableCell>
                <TableCell>Violation</TableCell>
                <TableCell>Fine (BDT)</TableCell>
                <TableCell>Days to pay</TableCell>
                <TableCell>Legal reference</TableCell>
                <TableCell>Active</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {(fines.data ?? []).map((f) => (
                <FineRow key={JSON.stringify(f)} fine={f} />
              ))}
            </TableBody>
          </Table>
        </Paper>
      </PageBody>
    </>
  );
}
