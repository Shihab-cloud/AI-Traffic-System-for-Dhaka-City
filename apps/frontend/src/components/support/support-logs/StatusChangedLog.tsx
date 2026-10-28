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

export default function StatusChangedLog({ log }: Props) {
  const details =
    log.details as SupportTicketLogDetailsMap[SupportTicketLogTypeEnum.STATUS_CHANGED];
  const name = log.performedBy?.name ?? 'Someone';

  return (
    <CollapsibleLogWrapper
      icon={Icons.statusChange}
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
          changed status from <StatusChip status={details?.oldStatus} size="small" /> to{' '}
          <StatusChip status={details?.newStatus} size="small" />
        </Typography>
      }
    />
  );
}
