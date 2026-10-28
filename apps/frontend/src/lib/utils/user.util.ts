import { UserResponse } from '@/lib/dtos/response/user.res';

export function userDisplayName(user: Partial<UserResponse> | null | undefined): string | null {
  if (!user) return null;
  return (
    user.name ||
    user.fullName ||
    [user.firstName, user.lastName].filter(Boolean).join(' ') ||
    (user.id ? `user …${user.id.slice(-6)}` : null)
  );
}
