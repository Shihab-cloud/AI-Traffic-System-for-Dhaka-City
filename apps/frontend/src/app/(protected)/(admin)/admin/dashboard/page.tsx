'use client';

import {
  Box,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import PageHeader from '@/components/common/header/PageHeader';
import PageBody from '@/components/common/layout/PageBody';
import { BarList, ColumnChart, compact } from '@/components/traffic/charts';
import { money } from '@/components/traffic/format';
import StatCard from '@/components/traffic/StatCard';
import { Icons } from '@/lib/icons';
import trafficService from '@/lib/services/traffic.service';

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, minWidth: 0 }}>
      <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
        {title}
      </Typography>
      {subtitle && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          {subtitle}
        </Typography>
      )}
      {children}
    </Paper>
  );
}

const dayLabel = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

export default function AdminOverviewPage() {
  const [days, setDays] = useState(30);
  const q = useQuery({ queryKey: ['traffic.overview', days], queryFn: () => trafficService.overview(days), refetchInterval: 30000 });
  const o = q.data;
  const s = o?.violations.byStatus;

  return (
    <>
      <PageHeader
        title="Overview"
        subtitle="Violations, tickets, payments and cameras across the whole system."
        icon={Icons.overview}
        rightSlot={
          <ToggleButtonGroup size="small" exclusive value={days} onChange={(_, v) => v && setDays(v)}>
            <ToggleButton value={7}>7 days</ToggleButton>
            <ToggleButton value={30}>30 days</ToggleButton>
            <ToggleButton value={90}>90 days</ToggleButton>
          </ToggleButtonGroup>
        }
      />
      <PageBody>
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' }, mb: 3 }}>
          <StatCard label={`Violations, last ${days} days`} value={o ? compact(o.violations.total) : '-'} icon={Icons.violation} tone="warning" hint={s ? `${s.new ?? 0} still to check` : undefined} />
          <StatCard label="Tickets issued (all time)" value={o?.cases.issued ?? '-'} icon={Icons.cases} hint={o ? `${Math.round(o.cases.paidRate * 100)}% paid` : undefined} />
          <StatCard label="Fines collected" value={o ? money(o.revenue.total) : '-'} icon={Icons.payments} tone="success" hint={o ? `${o.revenue.payments} payments` : undefined} />
          <StatCard label="Outstanding" value={o ? money(o.cases.outstanding) : '-'} icon={Icons.fines} tone="error" hint={o ? `${o.pendingReviews} reviews waiting` : undefined} />
          <StatCard label="Active cameras" value={o?.activeCameras ?? '-'} icon={Icons.camera} tone="info" />
          <StatCard label="Vehicles listed" value={o ? compact(o.plateSightings) : '-'} icon={Icons.passedVehicles} tone="info" hint={`last ${days} days`} />
          <StatCard label="Registered vehicles" value={o ? compact(o.registeredVehicles) : '-'} icon={Icons.vehicle} />
          <StatCard
            label="Average over-speed"
            value={o?.violations.speed ? `+${o.violations.speed.avgOverKph} km/h` : '-'}
            icon={Icons.speed}
            tone="warning"
            hint={o?.violations.speed ? `${o.violations.speed.count} speeding, max ${o.violations.speed.maxKph} km/h` : undefined}
          />
        </Box>

        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' }, mb: 2 }}>
          <Card title="Violations per day" subtitle="Detected by all cameras (Dhaka days)">
            <ColumnChart
              data={(o?.series ?? []).map((d) => ({ label: dayLabel(d.day), value: d.violations }))}
              tooltipLabel={(d) => `${d.label}: ${d.value} violation${d.value === 1 ? '' : 's'}`}
            />
          </Card>
          <Card title="Fines collected per day" subtitle="Successful payments, BDT">
            <ColumnChart
              data={(o?.series ?? []).map((d) => ({ label: dayLabel(d.day), value: d.revenue }))}
              format={(v) => compact(v)}
              tooltipLabel={(d) => `${d.label}: ${money(d.value)}`}
            />
          </Card>
        </Box>

        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr', xl: '1fr 1fr 1fr' } }}>
          <Card title="By violation type">
            <BarList rows={(o?.violations.byCode ?? []).map((c) => ({ key: c.code, label: `${c.code} ${c.title}`, value: c.count }))} />
          </Card>
          <Card title="By camera">
            <BarList rows={(o?.violations.byCamera ?? []).map((c) => ({ key: String(c.cameraId ?? c.name), label: c.name, value: c.count }))} />
          </Card>
          <Card title="By vehicle class">
            <BarList rows={(o?.violations.byClass ?? []).slice(0, 8).map((c) => ({ key: c.vehicleClass, label: c.vehicleClass, value: c.count }))} />
          </Card>
          <Card title="Tickets by status">
            <BarList
              rows={Object.entries(o?.cases.byStatus ?? {}).map(([k, v]) => ({
                key: k,
                label: k.replace('_', ' ').replace(/^\w/, (c) => c.toUpperCase()),
                value: v?.count ?? 0,
                hint: money(v?.amount ?? 0),
              }))}
            />
          </Card>
          <Card title="Most-ticketed vehicles">
            {o?.topVehicles.length ? (
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Registration</TableCell>
                    <TableCell align="right">Tickets</TableCell>
                    <TableCell align="right">Fines</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {o.topVehicles.map((t) => (
                    <TableRow key={t.registration}>
                      <TableCell sx={{ fontFamily: 'monospace' }}>{t.registration}</TableCell>
                      <TableCell align="right">{t.cases}</TableCell>
                      <TableCell align="right">{money(t.amount)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <Typography variant="body2" color="text.secondary">
                No tickets yet.
              </Typography>
            )}
          </Card>
          <Card title="System">
            <Stack spacing={1}>
              <Typography variant="body2">
                <b>{o?.users ?? '-'}</b> user accounts
              </Typography>
              <Typography variant="body2">
                <b>{s?.ticketed ?? 0}</b> violations ticketed, <b>{s?.dismissed ?? 0}</b> dismissed in this period
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Officers work in Traffic Enforcement; manage cameras, the vehicle registry and fines below in the Admin menu.
              </Typography>
            </Stack>
          </Card>
        </Box>
      </PageBody>
    </>
  );
}
