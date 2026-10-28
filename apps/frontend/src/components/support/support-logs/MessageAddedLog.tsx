import { SupportTicketLogResponse } from '@/lib/dtos/response/support.res';
import { SupportTicketLogDetailsMap } from '@/lib/types/support.types';
import { SupportTicketLogTypeEnum } from '@/lib/enums/support.enum';
import { Typography } from '@mui/material';
import CollapsibleLogWrapper from './CollapsibleLogWrapper';
import { Icons } from '@/lib/icons';

interface Props {
  log: SupportTicketLogResponse;
}

export default function MessageAddedLog({ log }: Props) {
  const details = log.details as SupportTicketLogDetailsMap[SupportTicketLogTypeEnum.MESSAGE_ADDED];
  const name = log.performedBy?.name ?? 'Someone';

  return (
    <CollapsibleLogWrapper
      icon={Icons.message}
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
          replied to this ticket
        </Typography>
      }
    >
      {details?.content && (
        <Typography variant="caption" color="text.secondary" className="pl-2 italic">
          &quot;{details.content}&quot;
        </Typography>
      )}
    </CollapsibleLogWrapper>
  );
}
