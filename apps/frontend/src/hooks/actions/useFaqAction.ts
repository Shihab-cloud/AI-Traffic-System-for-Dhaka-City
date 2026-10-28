'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { QUERY_KEYS } from '@/lib/constants/query-keys';
import {
  CreateFaqRequest,
  FaqsReorderItemsRequest,
  UpdateFaqRequest,
} from '@/lib/dtos/request/faq.req';
import faqService from '@/lib/services/faq.service';

export default function useFaqAction() {
  const queryClient = useQueryClient();

  const invalidateLists = () =>
    queryClient.invalidateQueries({
      predicate: ({ queryKey }) =>
        queryKey[0] === QUERY_KEYS.faq.list ||
        queryKey[0] === QUERY_KEYS.faq.listMe ||
        queryKey[0] === QUERY_KEYS.faq.listAll,
    });

  const useFaqListQuery = (params: QueryParams, options?: { enabled?: boolean }) =>
    useQuery({
      enabled: options?.enabled ?? true,
      queryKey: [QUERY_KEYS.faq.list, params],
      queryFn: () => faqService.listFaqs(params),
      placeholderData: keepPreviousData,
    });

  const useFaqListMeQuery = (params: QueryParams, options?: { enabled?: boolean }) =>
    useQuery({
      enabled: options?.enabled ?? true,
      queryKey: [QUERY_KEYS.faq.listMe, params],
      queryFn: () => faqService.listMyFaqs(params),
      placeholderData: keepPreviousData,
    });

  const useFaqListAllQuery = (params: QueryParams, options?: { enabled?: boolean }) =>
    useQuery({
      enabled: options?.enabled ?? true,
      queryKey: [QUERY_KEYS.faq.listAll, params],
      queryFn: () => faqService.listAllFaqs(params),
      placeholderData: keepPreviousData,
    });

  const useFaqCategoriesQuery = () =>
    useQuery({
      queryKey: [QUERY_KEYS.faq.categories],
      queryFn: () => faqService.getFaqCategories(),
    });

  const createFaqMutation = useMutation({
    mutationFn: (data: CreateFaqRequest) => faqService.createFaq(data),
    onSuccess: invalidateLists,
  });

  const updateFaqMutation = useMutation({
    mutationFn: ({ id, data }: { id: ID; data: UpdateFaqRequest }) =>
      faqService.updateFaq(id, data),
    onSuccess: invalidateLists,
  });

  const deleteFaqMutation = useMutation({
    mutationFn: (id: ID) => faqService.deleteFaq(id),
    onSuccess: invalidateLists,
  });

  const reorderFaqsMutation = useMutation({
    mutationFn: (data: FaqsReorderItemsRequest) => faqService.reorderFaqs(data),
    onSuccess: invalidateLists,
  });

  return {
    useFaqListQuery,
    useFaqListMeQuery,
    useFaqListAllQuery,
    useFaqCategoriesQuery,
    createFaqMutation,
    updateFaqMutation,
    deleteFaqMutation,
    reorderFaqsMutation,
  };
}
