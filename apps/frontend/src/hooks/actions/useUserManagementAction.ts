'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { QUERY_KEYS } from '@/lib/constants/query-keys';
import {
  CreateUserPayload,
  UserCreateRequest,
  UserUpdateRequest,
} from '@/lib/dtos/request/user-management.req';
import userManagementService from '@/lib/services/user-management.service';

function buildCreateUserPayload(data: UserCreateRequest): CreateUserPayload {
  const { sendInvite, confirmPassword, sendWelcomeEmail, ...payload } = data;
  if (sendInvite) {
    delete payload.password;
    return payload;
  }
  return { ...payload, sendWelcomeEmail: sendWelcomeEmail ?? false };
}

export default function useUserManagementAction() {
  const queryClient = useQueryClient();

  const useUserListQuery = (params: QueryParams) =>
    useQuery({
      queryKey: [QUERY_KEYS.userManagement.getUserList, params],
      queryFn: () => userManagementService.listUsers(params),
      placeholderData: keepPreviousData,
    });

  const useUserQuery = (id: ID) =>
    useQuery({
      enabled: !!id,
      queryKey: [QUERY_KEYS.userManagement.getUser, id],
      queryFn: () => userManagementService.getUser(id),
    });

  const createUserMutation = useMutation({
    mutationFn: (data: UserCreateRequest) =>
      userManagementService.createUser(buildCreateUserPayload(data)),
    onSuccess() {
      queryClient.invalidateQueries({
        predicate: ({ queryKey }) => queryKey[0] === QUERY_KEYS.userManagement.getUserList,
      });
    },
  });

  const updateUserMutation = useMutation({
    mutationFn: ({ id, data }: { id: ID; data: UserUpdateRequest }) =>
      userManagementService.updateUser(id, data),
    onSuccess() {
      queryClient.invalidateQueries({
        predicate: ({ queryKey }) => queryKey[0] === QUERY_KEYS.userManagement.getUserList,
      });
    },
  });

  const deleteUserMutation = useMutation({
    mutationFn: userManagementService.deleteUser,
    onSuccess() {
      queryClient.invalidateQueries({
        predicate: ({ queryKey }) => queryKey[0] === QUERY_KEYS.userManagement.getUserList,
      });
    },
  });

  const banUserMutation = useMutation({
    mutationFn: userManagementService.banUser,
    onSuccess() {
      queryClient.invalidateQueries({
        predicate: ({ queryKey }) => queryKey[0] === QUERY_KEYS.userManagement.getUserList,
      });
    },
  });

  const unbanUserMutation = useMutation({
    mutationFn: userManagementService.unbanUser,
    onSuccess() {
      queryClient.invalidateQueries({
        predicate: ({ queryKey }) => queryKey[0] === QUERY_KEYS.userManagement.getUserList,
      });
    },
  });

  const revokeSessionsMutation = useMutation({
    mutationFn: userManagementService.revokeSessions,
    onSuccess() {
      queryClient.invalidateQueries({
        predicate: ({ queryKey }) => queryKey[0] === QUERY_KEYS.userManagement.getUserList,
      });
    },
  });

  const resetCredentialsMutation = useMutation({
    mutationFn: userManagementService.resetCredentials,
    // A credentials reset writes `updatedAt`, which is a visible column —
    // invalidate the list.
    onSuccess: () => {
      queryClient.invalidateQueries({
        predicate: ({ queryKey }) => queryKey[0] === QUERY_KEYS.userManagement.getUserList,
      });
    },
  });

  return {
    useUserListQuery,
    useUserQuery,
    createUserMutation,
    updateUserMutation,
    deleteUserMutation,
    banUserMutation,
    unbanUserMutation,
    revokeSessionsMutation,
    resetCredentialsMutation,
  };
}
