import StatusChip from '@/components/common/StatusChip';
import { SupportTicketLogResponse } from '@/lib/dtos/response/support.res';
import { SupportTicketLogDetailsMap } from '@/lib/types/support.types';
import { SupportTicketLogTypeEnum } from '@/lib/enums/support.enum';
import { Typography } from '@mui/material';
import CollapsibleLogWrapper from './CollapsibleLogWrapper';
import { Icons } from '@/lib/icons';

interface Props {
  log: SupportTicketLogResponse;
}

export default function PriorityChangedLog({ log }: Props) {
  const details =
    log.details as SupportTicketLogDetailsMap[SupportTicketLogTypeEnum.PRIORITY_CHANGED];
  const name = log.performedBy?.name ?? 'Someone';

  return (
    <CollapsibleLogWrapper
      icon={Icons.priority}
      timestamp={log.createdAt}
      title={
        <Typography variant="body2" component="div">
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
          changed priority from{' '}
          <StatusChip status={details?.oldPriority} size="small" variant="filled" /> to{' '}
          <StatusChip status={details?.newPriority} size="small" variant="filled" />
        </Typography>
      }
    />
  );
}
