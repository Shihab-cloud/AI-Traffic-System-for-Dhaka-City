import { Typography } from '@mui/material';
import { SupportTicketLogResponse } from '@/lib/dtos/response/support.res';
import LogItem from './LogItem';

interface Props {
  logs: SupportTicketLogResponse[];
}

export default function SupportTicketTimeline({ logs }: Props) {
  if (logs.length === 0) return null;

  return (
    <div>
      <Typography
        variant="subtitle1"
        sx={{
          fontWeight: 600,
          mb: 2,
        }}
      >
        Activity
      </Typography>
      <div style={{ position: 'relative' }}>
        <div
          style={{
            position: 'absolute',
            left: 31,
            top: 0,
            bottom: -20,
            width: 2,
            backgroundColor: '#d1d5db',
            zIndex: 0,
          }}
        />
        <div
          style={{
            position: 'relative',
            zIndex: 1,
            display: 'flex',
            flexDirection: 'column',
            gap: 24,
          }}
        >
          {logs.map((log) => (
            <LogItem key={log.id} log={log} />
          ))}
        </div>
      </div>
    </div>
  );
}
