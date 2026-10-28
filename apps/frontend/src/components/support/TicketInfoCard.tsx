'use client';

import { useState } from 'react';
import {
  Divider,
  IconButton,
  MenuItem,
  Paper,
  Select,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { SupportMessageFileResponse, SupportTicketResponse } from '@/lib/dtos/response/support.res';
import MessageAttachment from './MessageAttachment';
import StatusChip from '@/components/common/StatusChip';
import { SupportTicketPriorityEnum, SupportTicketStatusEnum } from '@/lib/enums/support.enum';
import dayjs from 'dayjs';
import { Icons } from '@/lib/icons';

interface TicketInfoCardProps {
  ticket: SupportTicketResponse;
  creationAttachments?: SupportMessageFileResponse[];
  canUpdateStatus?: boolean;
  onStatusUpdate?: (status: SupportTicketStatusEnum) => void;
  canChangePriority?: boolean;
  onUpdatePriority?: (priority: SupportTicketPriorityEnum) => void;
  canAssign?: boolean;
  onUpdateAssignedTo?: (assignedTo: string) => void;
}

export default function TicketInfoCard({
  ticket,
  creationAttachments = [],
  canUpdateStatus = false,
  onStatusUpdate,
  canChangePriority = false,
  onUpdatePriority,
  canAssign = false,
  onUpdateAssignedTo,
}: TicketInfoCardProps) {
  const [assignedToText, setAssignedToText] = useState(ticket.assignedTo ?? '');
  const [editingAssignee, setEditingAssignee] = useState(false);

  const handleAssignedToSave = () => {
    if (!assignedToText.trim()) return;
    onUpdateAssignedTo?.(assignedToText.trim());
  };

  return (
    <Paper variant="outlined" sx={{ p: 3 }}>
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <Typography
            variant="h6"
            sx={{
              fontWeight: 600,
            }}
          >
            {ticket.subject}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {ticket.ticketNumber}
          </Typography>
        </div>
        <Typography variant="body2" color="text.secondary">
          {ticket.description}
        </Typography>
        {creationAttachments.length > 0 && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 240px)',
              gap: 8,
              marginTop: 8,
              alignItems: 'end',
            }}
          >
            {creationAttachments.map((a, i) => (
              <MessageAttachment key={i} attachment={a} />
            ))}
          </div>
        )}
        <Divider />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <Typography variant="caption" color="text.secondary">
              Category
            </Typography>
            <div className="mt-1">
              <StatusChip status={ticket.category} />
            </div>
          </div>
          <div>
            <Typography variant="caption" color="text.secondary">
              Priority
            </Typography>
            <div className="mt-1">
              {canChangePriority && onUpdatePriority ? (
                <Select
                  value={ticket.priority}
                  onChange={(e) => onUpdatePriority(e.target.value as SupportTicketPriorityEnum)}
                  variant="outlined"
                  renderValue={(val) => <StatusChip status={val} variant="filled" />}
                  sx={{
                    minWidth: 120,
                    height: 32,
                    '.MuiSelect-select': { display: 'flex', alignItems: 'center', py: 0.5 },
                  }}
                >
                  <MenuItem value={SupportTicketPriorityEnum.LOW}>
                    <StatusChip status={SupportTicketPriorityEnum.LOW} variant="filled" />
                  </MenuItem>
                  <MenuItem value={SupportTicketPriorityEnum.MEDIUM}>
                    <StatusChip status={SupportTicketPriorityEnum.MEDIUM} variant="filled" />
                  </MenuItem>
                  <MenuItem value={SupportTicketPriorityEnum.HIGH}>
                    <StatusChip status={SupportTicketPriorityEnum.HIGH} variant="filled" />
                  </MenuItem>
                  <MenuItem value={SupportTicketPriorityEnum.CRITICAL}>
                    <StatusChip status={SupportTicketPriorityEnum.CRITICAL} variant="filled" />
                  </MenuItem>
                </Select>
              ) : (
                <StatusChip status={ticket.priority} variant="filled" />
              )}
            </div>
          </div>
          <div>
            <Typography variant="caption" color="text.secondary">
              Status
            </Typography>
            <div className="mt-1">
              {canUpdateStatus && onStatusUpdate ? (
                <Select
                  value={ticket.status}
                  onChange={(e) => onStatusUpdate(e.target.value as SupportTicketStatusEnum)}
                  variant="outlined"
                  renderValue={(val) => <StatusChip status={val} variant="filled" />}
                  sx={{
                    minWidth: 120,
                    height: 32,
                    '.MuiSelect-select': { display: 'flex', alignItems: 'center', py: 0.5 },
                  }}
                >
                  <MenuItem value={SupportTicketStatusEnum.SUBMITTED}>
                    <StatusChip status={SupportTicketStatusEnum.SUBMITTED} variant="filled" />
                  </MenuItem>
                  <MenuItem value={SupportTicketStatusEnum.IN_REVIEW}>
                    <StatusChip status={SupportTicketStatusEnum.IN_REVIEW} variant="filled" />
                  </MenuItem>
                  <MenuItem value={SupportTicketStatusEnum.RESOLVED}>
                    <StatusChip status={SupportTicketStatusEnum.RESOLVED} variant="filled" />
                  </MenuItem>
                </Select>
              ) : (
                <StatusChip status={ticket.status} variant="filled" />
              )}
            </div>
          </div>
          <div>
            <Typography variant="caption" color="text.secondary">
              Created
            </Typography>
            <Typography variant="body2" sx={{ mt: 0.5 }}>
              {dayjs(ticket.createdAt).format('MMM D, YYYY h:mm A')}
            </Typography>
          </div>
        </div>
        <Divider />
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Typography variant="body2" color="text.secondary">
              Submitted by:
            </Typography>
            <Typography
              variant="body2"
              sx={{
                fontWeight: 500,
              }}
            >
              {ticket.submittedByName}
            </Typography>
          </div>
          {canAssign && onUpdateAssignedTo ? (
            <div className="flex items-center gap-1.5">
              <Typography variant="body2" color="text.secondary">
                Assigned to:
              </Typography>
              {editingAssignee ? (
                <div className="flex items-center gap-1">
                  <TextField
                    value={assignedToText}
                    onChange={(e) => setAssignedToText(e.target.value)}
                    placeholder="Team or person"
                    sx={{
                      width: 180,
                      '.MuiInputBase-root': { height: 30, fontSize: '0.8125rem' },
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleAssignedToSave();
                        setEditingAssignee(false);
                      }
                      if (e.key === 'Escape') setEditingAssignee(false);
                    }}
                    autoFocus
                  />
                  <Tooltip title="Save">
                    <span>
                      <IconButton
                        size="small"
                        onClick={() => {
                          handleAssignedToSave();
                          setEditingAssignee(false);
                        }}
                        disabled={
                          !assignedToText.trim() || assignedToText.trim() === ticket.assignedTo
                        }
                        color="primary"
                      >
                        <Icons.check size={16} />
                      </IconButton>
                    </span>
                  </Tooltip>
                </div>
              ) : (
                <div className="flex items-center gap-0.5">
                  <Typography
                    variant="body2"
                    sx={{
                      fontWeight: 500,
                    }}
                  >
                    {ticket.assignedTo || 'Unassigned'}
                  </Typography>
                  <Tooltip title="Edit assignee">
                    <IconButton size="small" onClick={() => setEditingAssignee(true)}>
                      <Icons.edit size={14} />
                    </IconButton>
                  </Tooltip>
                </div>
              )}
            </div>
          ) : (
            ticket.assignedTo && (
              <div className="flex items-center gap-1.5">
                <Typography variant="body2" color="text.secondary">
                  Assigned to:
                </Typography>
                <Typography
                  variant="body2"
                  sx={{
                    fontWeight: 500,
                  }}
                >
                  {ticket.assignedTo}
                </Typography>
              </div>
            )
          )}
        </div>
      </div>
    </Paper>
  );
}
