'use client';

import { Avatar, Paper, Typography } from '@mui/material';
import { SupportTicketLogResponse } from '@/lib/dtos/response/support.res';
import { SupportTicketLogDetailsMap } from '@/lib/types/support.types';
import { SupportTicketLogTypeEnum } from '@/lib/enums/support.enum';
import StatusChip from '@/components/common/StatusChip';
import { RoleNameEnum } from '@/lib/enums/role-name.enum';
import { stringToColor } from '@/lib/utils/common.util';
import dayjs from 'dayjs';
import MessageAttachment from './MessageAttachment';

interface TicketConversationProps {
  messages: SupportTicketLogResponse[];
}

export default function TicketConversation({ messages }: TicketConversationProps) {
  return (
    <Paper variant="outlined" sx={{ p: 3 }}>
      <Typography
        variant="subtitle1"
        sx={{
          fontWeight: 600,
          mb: 2,
        }}
      >
        Conversation
      </Typography>
      {messages.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
          No messages yet.
        </Typography>
      ) : (
        <div className="flex flex-col gap-0.5">
          {messages.map((log, idx) => {
            const content =
              log.type === SupportTicketLogTypeEnum.MESSAGE_ADDED
                ? ((
                    log.details as SupportTicketLogDetailsMap[SupportTicketLogTypeEnum.MESSAGE_ADDED]
                  )?.content ?? '')
                : '';
            const senderName = log.performedBy?.name ?? 'Unknown';
            const senderRole = log.performedBy?.role ?? '';
            const senderId = log.performedBy?.id ?? '';
            const isMember = senderRole.toLowerCase() === RoleNameEnum.USER.toLowerCase();
            const showAvatar = idx === 0 || messages[idx - 1].performedBy?.id !== senderId;

            return (
              <div
                key={log.id}
                className="flex gap-2.5"
                style={{ marginTop: showAvatar ? (idx === 0 ? 0 : 16) : 0 }}
              >
                <div className="w-7 shrink-0">
                  {showAvatar && (
                    <Avatar
                      sx={{
                        width: 28,
                        height: 28,
                        bgcolor: stringToColor(senderName),
                        fontSize: 12,
                      }}
                    >
                      {senderName[0]}
                    </Avatar>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  {showAvatar && (
                    <div className="mb-0.5 flex items-center gap-2">
                      <Typography
                        variant="caption"
                        sx={{
                          fontWeight: 600,
                        }}
                      >
                        {senderName}
                      </Typography>
                      <Typography
                        variant="caption"
                        color="text.disabled"
                        sx={{ fontSize: '0.7rem' }}
                      >
                        {dayjs(log.createdAt).format('MMM D, h:mm A')}
                      </Typography>
                      {!isMember && (
                        <StatusChip status={senderRole} size="small" variant="filled" />
                      )}
                    </div>
                  )}
                  {content && (
                    <Typography
                      variant="body2"
                      sx={{
                        bgcolor: isMember ? 'action.hover' : 'transparent',
                        border: isMember ? 'none' : 1,
                        borderColor: 'divider',
                        borderRadius: 1,
                        px: 1.5,
                        py: 1,
                        mt: 0.5,
                        display: 'inline-block',
                        maxWidth: '85%',
                        lineHeight: 1.5,
                      }}
                    >
                      {content}
                    </Typography>
                  )}
                  {log.attachments && log.attachments.length > 0 && (
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(3, 240px)',
                        gap: 8,
                        marginTop: 8,
                        alignItems: 'end',
                      }}
                    >
                      {log.attachments.map((a, i) => (
                        <MessageAttachment key={i} attachment={a} />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Paper>
  );
}
