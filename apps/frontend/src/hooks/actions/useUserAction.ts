'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { QUERY_KEYS } from '@/lib/constants/query-keys';
import { authClient } from '@/lib/auth-client';
import userService from '@/lib/services/user.service';

export default function useUserAction() {
  const queryClient = useQueryClient();

  const updateProfileMutation = useMutation({
    mutationFn: userService.updateProfile,
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.user.getProfile] });
      // The header and drawer read the name and avatar from better-auth's
      // session, which is a separate cache this invalidation does not reach —
      // so renaming yourself updated the profile card while the sidebar kept
      // the old name until a hard reload.
      // `disableCookieCache` forces a round trip rather than replaying the
      // cached session cookie, which is the whole point here.
      await authClient.getSession({ query: { disableCookieCache: true } });
    },
  });

  const updatePasswordMutation = useMutation({
    mutationFn: userService.updatePassword,
  });

  const useProfileQuery = () =>
    useQuery({
      queryKey: [QUERY_KEYS.user.getProfile],
      queryFn: userService.getProfile,
    });

  const useUserQuery = (id: ID) =>
    useQuery({
      enabled: !!id,
      queryKey: [QUERY_KEYS.user.getUser, id],
      queryFn: () => userService.getUser(id),
    });

  return {
    updateProfileMutation,
    updatePasswordMutation,
    useProfileQuery,
    useUserQuery,
  };
}
