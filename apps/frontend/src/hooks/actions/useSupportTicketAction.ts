'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { QUERY_KEYS } from '@/lib/constants/query-keys';
import supportService from '@/lib/services/support.service';
import { SupportTicketPriorityEnum, SupportTicketStatusEnum } from '@/lib/enums/support.enum';
import { CreateMessageRequest, CreateTicketRequest } from '@/lib/dtos/request/support.req';

export default function useSupportTicketAction() {
  const queryClient = useQueryClient();

  const useTicketListQuery = (params: QueryParams) =>
    useQuery({
      queryKey: [QUERY_KEYS.supportTicket.getList, params],
      queryFn: () => supportService.listTickets(params),
      placeholderData: keepPreviousData,
    });

  const useMyTicketListQuery = (params: QueryParams) =>
    useQuery({
      queryKey: [QUERY_KEYS.supportTicket.getMyList, params],
      queryFn: () => supportService.listMyTickets(params),
      placeholderData: keepPreviousData,
    });

  const useTicketDetailQuery = (id: ID) =>
    useQuery({
      enabled: !!id,
      queryKey: [QUERY_KEYS.supportTicket.getDetail, id],
      queryFn: () => supportService.getTicket(id),
    });

  const createTicketMutation = useMutation({
    mutationFn: (data: CreateTicketRequest) => supportService.createTicket(data),
    onSuccess() {
      queryClient.invalidateQueries({
        predicate: ({ queryKey }) =>
          queryKey[0] === QUERY_KEYS.supportTicket.getList ||
          queryKey[0] === QUERY_KEYS.supportTicket.getMyList,
      });
    },
  });

  const replyToTicketMutation = useMutation({
    mutationFn: ({ ticketId, data }: { ticketId: ID; data: CreateMessageRequest }) =>
      supportService.addMessage(ticketId, data),
    onSuccess(_, variables) {
      // The lists too, not just the detail — both render `lastResponseAt` and
      // the 60s staleTime would otherwise show a pre-reply timestamp.
      queryClient.invalidateQueries({
        predicate: ({ queryKey }) =>
          queryKey[0] === QUERY_KEYS.supportTicket.getList ||
          queryKey[0] === QUERY_KEYS.supportTicket.getMyList ||
          (queryKey[0] === QUERY_KEYS.supportTicket.getDetail &&
            queryKey[1] === variables.ticketId),
      });
    },
  });

  const updateTicketMutation = useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: ID;
      data: {
        status?: SupportTicketStatusEnum;
        priority?: SupportTicketPriorityEnum;
        assignedTo?: string;
      };
    }) => supportService.updateTicket(id, data),
    onSuccess(_, variables) {
      queryClient.invalidateQueries({
        predicate: ({ queryKey }) =>
          queryKey[0] === QUERY_KEYS.supportTicket.getList ||
          queryKey[0] === QUERY_KEYS.supportTicket.getMyList ||
          (queryKey[0] === QUERY_KEYS.supportTicket.getDetail && queryKey[1] === variables.id),
      });
    },
  });

  return {
    useTicketListQuery,
    useMyTicketListQuery,
    useTicketDetailQuery,
    createTicketMutation,
    replyToTicketMutation,
    updateTicketMutation,
  };
}
