'use client';

import { FormProvider, UseFormSetError, useForm } from 'react-hook-form';
import ModalLayout, { ModalHookLayout } from '@/components/common/modal/ModalLayout';
import { UserCreateRequest, UserUpdateRequest } from '@/lib/dtos/request/user-management.req';
import { UserCreationValidation, UserUpdateValidation } from '@/lib/validators/user.validator';

import { AxiosError } from 'axios';
import { Box, Button, IconButton, Typography } from '@mui/material';
import PageHeader from '@/components/common/header/PageHeader';
import PageBody from '@/components/common/layout/PageBody';
import UserCreationForm from '@/components/user-management/UserCreationForm';
import UserManagementTable from '@/components/user-management/UserManagementTable';
import { UserResponse } from '@/lib/dtos/response/user.res';
import UserUpdateForm from '@/components/user-management/UserUpdateForm';
import toast from 'react-hot-toast';
import { useModal } from '@ebay/nice-modal-react';
import useUserManagementAction from '@/hooks/actions/useUserManagementAction';
import { zodResolver } from '@hookform/resolvers/zod';
import { Icons } from '@/lib/icons';

/**
 * Surfaces backend errors for create/update user mutations.
 *
 * `USERNAME_TAKEN` needs an inline RHF field error — toast can't reach form state.
 * For everything else, mirror the global mutation toast in `ContextProvider.tsx`,
 * because defining a local `onError` short-circuits that global handler.
 */
function applyUsernameError<T extends { username?: string | null }>(
  err: unknown,
  setError: UseFormSetError<T>,
): void {
  const data = (err as AxiosError<{ error?: string; suggestion?: string; message?: string }>)
    ?.response?.data;
  if (data?.error === 'USERNAME_TAKEN' && data.suggestion) {
    setError('username' as unknown as Parameters<UseFormSetError<T>>[0], {
      type: 'manual',
      message: `${data.message ?? 'Username taken'}. Try "${data.suggestion}".`,
    });
    return;
  }
  toast.error(data?.message || (err instanceof Error ? err.message : 'Request failed'));
}

export default function Page() {
  const modal = useModal(ModalHookLayout);

  const userCreateFormMethods = useForm<UserCreateRequest>({
    resolver: zodResolver(UserCreationValidation),
    defaultValues: { sendInvite: false },
  });

  const userUpdateFormMethods = useForm<UserUpdateRequest>({
    resolver: zodResolver(UserUpdateValidation),
  });

  const {
    createUserMutation,
    deleteUserMutation,
    updateUserMutation,
    banUserMutation,
    unbanUserMutation,
    revokeSessionsMutation,
    resetCredentialsMutation,
  } = useUserManagementAction();

  const onUserCreate = (data: UserCreateRequest, closeModal: () => void) => {
    // Strip empty strings so the backend sees `undefined` for the email-or-username
    // CHECK constraint and the email-validity check skips empty inputs.
    const payload = {
      ...data,
      email: data.email?.trim() ? data.email.trim() : undefined,
      username: data.username?.trim() ? data.username.trim() : undefined,
    } as UserCreateRequest;
    createUserMutation.mutate(payload, {
      onSuccess: () => {
        closeModal();
        toast.success('User created successfully');
      },
      onError: (err) => {
        applyUsernameError(err, userCreateFormMethods.setError);
      },
    });
  };

  const onUserDelete = (user: UserResponse) => {
    deleteUserMutation.mutate(user.id, {
      onSuccess: () => {
        toast.success('User deleted successfully');
      },
    });
  };

  const onUserBan = (user: UserResponse) => {
    banUserMutation.mutate(user.id, {
      onSuccess: () => {
        toast.success('User banned successfully');
      },
    });
  };

  const onUserUnban = (user: UserResponse) => {
    unbanUserMutation.mutate(user.id, {
      onSuccess: () => {
        toast.success('User unbanned successfully');
      },
    });
  };

  const onRevokeSession = (user: UserResponse) => {
    revokeSessionsMutation.mutate(user.id, {
      onSuccess: () => {
        toast.success('Sessions revoked successfully');
      },
    });
  };

  const showTempPasswordDialog = (user: UserResponse, tempPassword: string) => {
    const copyToClipboard = async () => {
      try {
        await navigator.clipboard.writeText(tempPassword);
        toast.success('Password copied to clipboard');
      } catch {
        toast.error('Failed to copy — copy manually');
      }
    };

    modal.show({
      title: 'Temp Password Generated',
      subtitle: `Hand the password below to ${user.name}. It will not be shown again.`,
      maxWidth: 'sm',
      children: (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, py: 1 }}>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 2,
              p: 2,
              borderRadius: 2,
              border: '1px solid',
              borderColor: 'divider',
              bgcolor: 'action.hover',
            }}
          >
            <Typography
              sx={{
                fontFamily: 'monospace',
                fontSize: '1.25rem',
                letterSpacing: 1,
                wordBreak: 'break-all',
              }}
            >
              {tempPassword}
            </Typography>
            <IconButton onClick={copyToClipboard} aria-label="Copy password">
              <Icons.copy />
            </IconButton>
          </Box>
          <Typography variant="body2" color="warning.main">
            This is the only time the password will be displayed. The user must change it on next
            login.
          </Typography>
        </Box>
      ),
      slotProps: {
        confirm: {
          text: "I've Saved It",
          onClick: () => modal.remove(),
        },
      },
    });
  };

  const onResetCredentials = (user: UserResponse) => {
    resetCredentialsMutation.mutate(user.id, {
      onSuccess: (data) => {
        showTempPasswordDialog(user, data.tempPassword);
      },
    });
  };

  const onUserEdit = (data: UserResponse) => {
    userUpdateFormMethods.reset({
      ...data,
      roleId: data.role.id,
      username: data.displayUsername ?? data.username ?? '',
    });

    modal.show({
      title: `Edit ${data.name}`,
      subtitle: 'Update the details of the user',
      maxWidth: 'md',
      autoCloseOnConfirm: false,
      slotProps: {
        cancel: { text: 'Cancel' },
        confirm: {
          text: 'Confirm',
          onClick: (_, closeModal) => {
            userUpdateFormMethods.handleSubmit((req) => {
              updateUserMutation.mutate(
                { id: data.id, data: req },
                {
                  onSuccess: () => {
                    closeModal();
                    modal.remove();
                    toast.success('User updated successfully');
                  },
                  onError: (err) => {
                    applyUsernameError(err, userUpdateFormMethods.setError);
                  },
                },
              );
            })();
          },
        },
      },
      children: (
        <FormProvider {...userUpdateFormMethods}>
          <UserUpdateForm />
        </FormProvider>
      ),
    });
  };

  return (
    <div className="flex flex-col">
      <PageHeader
        title="User Management"
        subtitle="Manage your users and their permissions"
        icon={Icons.users}
        rightSlot={
          <FormProvider {...userCreateFormMethods}>
            <ModalLayout
              targetComponent={
                <Button
                  startIcon={<Icons.add />}
                  variant="contained"
                  color="primary"
                  sx={{ borderRadius: 9999 }}
                >
                  Add New User
                </Button>
              }
              autoCloseOnConfirm={false}
              maxWidth="md"
              title="Create New User"
              subtitle="Fill in the details to create a new user."
              slotProps={{
                cancel: { text: 'Cancel' },
                confirm: {
                  text: 'Create User',
                  onClick: (_, closeModal) => {
                    userCreateFormMethods.handleSubmit((data) => onUserCreate(data, closeModal))();
                  },
                },
              }}
            >
              <UserCreationForm />
            </ModalLayout>
          </FormProvider>
        }
      />

      <PageBody>
        <UserManagementTable
          onRowDelete={onUserDelete}
          onRowEdit={onUserEdit}
          onRowBan={onUserBan}
          onRowUnban={onUserUnban}
          onRevokeSession={onRevokeSession}
          onResetCredentials={onResetCredentials}
        />
      </PageBody>
    </div>
  );
}
