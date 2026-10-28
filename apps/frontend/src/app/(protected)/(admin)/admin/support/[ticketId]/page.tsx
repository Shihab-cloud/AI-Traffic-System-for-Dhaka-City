'use client';

import { SupportTicketPriorityEnum, SupportTicketStatusEnum } from '@/lib/enums/support.enum';
import { Alert, Skeleton } from '@mui/material';

import PageHeader from '@/components/common/header/PageHeader';
import PageBody from '@/components/common/layout/PageBody';
import { PermissionsEnum } from '@/lib/enums/permission.enum';
import TicketDetailView from '@/components/support/TicketDetailView';
import useHasPermission from '@/hooks/useHasPermission';
import useSupportTicketAction from '@/hooks/actions/useSupportTicketAction';
import { RouteUrls } from '@/lib/routes/route.config';
import { useParams } from 'next/navigation';
import toast from 'react-hot-toast';

export default function Page() {
  const params = useParams<{ ticketId: string }>();
  const ticketId = params.ticketId;

  // Mirrors the backend's `isManager` (`support.service.ts` → `detectRole`): triage
  // is ADMIN *or* MANAGE_SUPPORT_TICKET. Hardcoding these to `true` showed controls
  // the API would reject for a role that reaches this page without either.
  const { hasPermission: canTriage } = useHasPermission([
    PermissionsEnum.ADMIN,
    PermissionsEnum.MANAGE_SUPPORT_TICKET,
  ]);

  const { useTicketDetailQuery, replyToTicketMutation, updateTicketMutation } =
    useSupportTicketAction();

  const { data: ticket, isLoading } = useTicketDetailQuery(ticketId);

  const handleReply = (content: string, attachments?: { fileKey: string; fileName: string }[]) => {
    replyToTicketMutation.mutate(
      { ticketId, data: { content: content || undefined, attachments } },
      {
        onSuccess: () => toast.success('Reply sent'),
        onError: () => toast.error('Failed to send reply'),
      },
    );
  };

  const handleStatusUpdate = (status: SupportTicketStatusEnum) => {
    updateTicketMutation.mutate(
      { id: ticketId, data: { status } },
      {
        onSuccess: () => toast.success('Ticket status updated'),
        onError: () => toast.error('Failed to update ticket status'),
      },
    );
  };

  const handleUpdateAssignedTo = (assignedTo: string) => {
    updateTicketMutation.mutate(
      { id: ticketId, data: { assignedTo } },
      {
        onSuccess: () => toast.success('Assigned to updated'),
        onError: () => toast.error('Failed to update assigned to'),
      },
    );
  };

  const handleUpdatePriority = (priority: SupportTicketPriorityEnum) => {
    updateTicketMutation.mutate(
      { id: ticketId, data: { priority } },
      {
        onSuccess: () => toast.success('Priority updated'),
        onError: () => toast.error('Failed to update priority'),
      },
    );
  };

  if (isLoading) {
    return (
      <PageBody>
        <Skeleton width={200} height={40} />
        <Skeleton width="100%" height={200} sx={{ mt: 2 }} />
      </PageBody>
    );
  }

  return (
    <div className="flex flex-col">
      <PageHeader
        compact
        title={ticket?.ticketNumber ? `Ticket #${ticket.ticketNumber}` : 'Ticket Detail'}
        backUrl={RouteUrls.admin.support.index}
      />

      <PageBody>
        {!ticket ? (
          <Alert severity="error">No Ticket Found</Alert>
        ) : (
          <TicketDetailView
            ticket={ticket}
            onReply={handleReply}
            onStatusUpdate={handleStatusUpdate}
            onUpdateAssignedTo={handleUpdateAssignedTo}
            onUpdatePriority={handleUpdatePriority}
            canReply
            canUpdateStatus={canTriage}
            canAssign={canTriage}
            canChangePriority={canTriage}
            replyLoading={replyToTicketMutation.isPending}
          />
        )}
      </PageBody>
    </div>
  );
}
