'use client';

import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import toast from 'react-hot-toast';

import PageHeader from '@/components/common/header/PageHeader';
import PageBody from '@/components/common/layout/PageBody';
import { Icons } from '@/lib/icons';
import trafficService from '@/lib/services/traffic.service';
import type { Vehicle } from '@/lib/types/traffic.types';
import { apiErrorMessage } from '@/lib/utils/common.util';

type Draft = Omit<Vehicle, 'id'> & { id?: string };
const EMPTY: Draft = { registration: '', vehicleClass: '', makeModel: '', colour: '', ownerName: '', ownerEmail: '', ownerPhone: '', ownerAddress: '' };
const FIELDS: { key: keyof Draft; label: string; help?: string; full?: boolean }[] = [
  { key: 'registration', label: 'Registration', help: 'As on the plate, e.g. Dhaka Metro-Ga 11-5431', full: true },
  { key: 'vehicleClass', label: 'Class', help: 'Car, Bus, CNG, Motorbike, ...' },
  { key: 'makeModel', label: 'Make / model' },
  { key: 'colour', label: 'Colour' },
  { key: 'ownerName', label: 'Owner name' },
  { key: 'ownerEmail', label: 'Owner email', help: 'Tickets are emailed here; the owner signs in with it' },
  { key: 'ownerPhone', label: 'Owner phone' },
  { key: 'ownerAddress', label: 'Owner address', full: true },
];

export default function VehiclesPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [draft, setDraft] = useState<Draft | null>(null);
  const list = useQuery({
    queryKey: ['traffic.vehicles', search, page],
    queryFn: () => trafficService.vehicles({ search: search || undefined, page: page + 1, limit: 20 }),
    placeholderData: keepPreviousData,
  });
  const save = useMutation({
    mutationFn: () => {
      const { id, ...body } = draft!;
      return trafficService.saveVehicle({ ...body, ownerEmail: body.ownerEmail || undefined }, id);
    },
    onSuccess: () => {
      toast.success('Vehicle saved');
      setDraft(null);
      qc.invalidateQueries({ queryKey: ['traffic.vehicles'] });
    },
    onError: (e) => toast.error(apiErrorMessage(e, 'Could not save')),
  });
  const remove = useMutation({
    mutationFn: (id: string) => trafficService.deleteVehicle(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['traffic.vehicles'] }),
    onError: (e) => toast.error(apiErrorMessage(e, 'Could not delete')),
  });

  return (
    <>
      <PageHeader
        title="Vehicle registry"
        subtitle="Registration number to owner (the BRTA record). Tickets go to the owner of the registration on the plate."
        icon={Icons.vehicle}
        rightSlot={
          <Button variant="contained" startIcon={<Icons.add />} onClick={() => setDraft({ ...EMPTY })}>
            Add vehicle
          </Button>
        }
      />
      <PageBody>
        <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
          <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider' }}>
            <TextField
              size="small"
              placeholder="Registration, owner, email, phone"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
              slotProps={{ input: { startAdornment: <InputAdornment position="start"><Icons.search /></InputAdornment> } }}
              sx={{ minWidth: 320 }}
            />
          </Box>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Registration</TableCell>
                <TableCell>Vehicle</TableCell>
                <TableCell>Owner</TableCell>
                <TableCell>Contact</TableCell>
                <TableCell align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {(list.data?.docs ?? []).map((v) => (
                <TableRow key={v.id} hover>
                  <TableCell sx={{ fontFamily: 'monospace', fontWeight: 600 }}>{v.registration}</TableCell>
                  <TableCell>{[v.vehicleClass, v.makeModel, v.colour].filter(Boolean).join(' · ') || '-'}</TableCell>
                  <TableCell>{v.ownerName}</TableCell>
                  <TableCell>
                    {v.ownerEmail || '-'}
                    <Typography variant="caption" color="text.secondary" component="div">
                      {v.ownerPhone}
                    </Typography>
                  </TableCell>
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                    <IconButton size="small" aria-label="Edit" onClick={() => setDraft({ ...v })}>
                      <Icons.edit />
                    </IconButton>
                    <IconButton
                      size="small"
                      aria-label="Delete"
                      onClick={() => confirm(`Remove ${v.registration} from the registry?`) && remove.mutate(v.id)}
                    >
                      <Icons.delete />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
              {!list.data?.docs.length && (
                <TableRow>
                  <TableCell colSpan={5} sx={{ textAlign: 'center', py: 5, color: 'text.secondary' }}>
                    {list.isLoading ? 'Loading...' : 'No vehicles.'}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          <TablePagination
            component="div"
            count={list.data?.totalDocs ?? 0}
            page={page}
            onPageChange={(_, p) => setPage(p)}
            rowsPerPage={20}
            rowsPerPageOptions={[20]}
          />
        </Paper>
      </PageBody>
      <Dialog open={!!draft} onClose={() => setDraft(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{draft?.id ? 'Edit vehicle' : 'Add vehicle'}</DialogTitle>
        <DialogContent dividers>
          {draft && (
            <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: '1fr 1fr' }}>
              {FIELDS.map((f) => (
                <TextField
                  key={f.key}
                  size="small"
                  label={f.label}
                  helperText={f.help}
                  value={(draft[f.key] as string) ?? ''}
                  onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
                  sx={{ gridColumn: f.full ? '1 / -1' : undefined }}
                />
              ))}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDraft(null)}>Cancel</Button>
          <Button variant="contained" disabled={!draft?.registration || !draft?.ownerName || save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
