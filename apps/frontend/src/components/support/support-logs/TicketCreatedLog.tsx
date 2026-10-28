import { SupportTicketLogResponse } from '@/lib/dtos/response/support.res';
import { SupportTicketLogDetailsMap } from '@/lib/types/support.types';
import { SupportTicketLogTypeEnum } from '@/lib/enums/support.enum';
import { Typography } from '@mui/material';
import CollapsibleLogWrapper from './CollapsibleLogWrapper';
import { Icons } from '@/lib/icons';

interface Props {
  log: SupportTicketLogResponse;
}

export default function TicketCreatedLog({ log }: Props) {
  const details =
    log.details as SupportTicketLogDetailsMap[SupportTicketLogTypeEnum.TICKET_CREATED];
  const name = log.performedBy?.name ?? 'Someone';

  return (
    <CollapsibleLogWrapper
      icon={Icons.ticketCreated}
      timestamp={log.createdAt}
      title={
        <Typography variant="body2">
          <Typography
            variant="inherit"
            color="primary"
            component="span"
            sx={{
              fontWeight: 600,
            }}
          >
            {name}
          </Typography>{' '}
          submitted this ticket
          {details && (
            <Typography variant="inherit" color="text.secondary" component="span">
              {' '}
              — {details.category.replace(/_/g, ' ')} / {details.priority}
            </Typography>
          )}
        </Typography>
      }
    />
  );
}
