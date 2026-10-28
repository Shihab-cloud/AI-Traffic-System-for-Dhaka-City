'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { authClient } from '@/lib/auth-client';
import { QUERY_KEYS } from '@/lib/constants/query-keys';
import { RoleCreationRequest } from '@/lib/dtos/request/role.req';
import rbacService from '@/lib/services/rbac.service';

export default function useRbacAction() {
  const queryClient = useQueryClient();

  const useRoleListQuery = (params: QueryParams) =>
    useQuery({
      queryKey: [QUERY_KEYS.role.getRoleList, params],
      queryFn: () => rbacService.listRoles(params),
    });

  /**
   * A role mutation changes more than the role list.
   *
   * The user table renders each user's role name, so it goes stale on a rename.
   * More importantly, editing *your own* role's permissions changes what you
   * may do — and `useHasPermission`, `PermissionLayout` and the sidebar filter
   * all read the permission set off the session, which this must refresh or
   * they keep applying the old one until a hard reload.
   */
  const invalidateRoleDependents = async () => {
    queryClient.invalidateQueries({
      predicate: ({ queryKey }) =>
        queryKey[0] === QUERY_KEYS.role.getRoleList ||
        queryKey[0] === QUERY_KEYS.userManagement.getUserList,
    });
    await authClient.getSession({ query: { disableCookieCache: true } });
  };

  const roleCreationMutation = useMutation({
    mutationFn: rbacService.createRole,
    async onSuccess() {
      await invalidateRoleDependents();
    },
  });

  const roleUpdateMutation = useMutation({
    mutationFn: ({ id, data }: { id: ID; data: RoleCreationRequest }) =>
      rbacService.updateRole(id, data),
    async onSuccess() {
      await invalidateRoleDependents();
    },
  });

  const roleDeleteMutation = useMutation({
    mutationFn: rbacService.deleteRole,
    async onSuccess() {
      await invalidateRoleDependents();
    },
  });

  return {
    useRoleListQuery,
    roleCreationMutation,
    roleUpdateMutation,
    roleDeleteMutation,
  };
}
