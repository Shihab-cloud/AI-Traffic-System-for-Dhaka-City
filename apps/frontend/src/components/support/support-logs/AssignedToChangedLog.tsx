import { SupportTicketLogResponse } from '@/lib/dtos/response/support.res';
import { SupportTicketLogDetailsMap } from '@/lib/types/support.types';
import { SupportTicketLogTypeEnum } from '@/lib/enums/support.enum';
import { Typography } from '@mui/material';
import CollapsibleLogWrapper from './CollapsibleLogWrapper';
import { Icons } from '@/lib/icons';

interface Props {
  log: SupportTicketLogResponse;
}

export default function AssignedToChangedLog({ log }: Props) {
  const details =
    log.details as SupportTicketLogDetailsMap[SupportTicketLogTypeEnum.ASSIGNED_TO_CHANGED];
  const name = log.performedBy?.name ?? 'Someone';

  return (
    <CollapsibleLogWrapper
      icon={Icons.assigned}
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
          reassigned ticket from{' '}
          <Typography
            variant="inherit"
            component="span"
            sx={{
              fontWeight: 500,
            }}
          >
            {details?.oldAssignedTo ?? 'Unassigned'}
          </Typography>{' '}
          to{' '}
          <Typography
            variant="inherit"
            component="span"
            sx={{
              fontWeight: 500,
            }}
          >
            {details?.newAssignedTo ?? 'Unassigned'}
          </Typography>
        </Typography>
      }
    />
  );
}
