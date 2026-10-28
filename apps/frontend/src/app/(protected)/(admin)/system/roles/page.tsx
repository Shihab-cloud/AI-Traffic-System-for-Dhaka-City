'use client';

import { Box, Button, Skeleton, Typography } from '@mui/material';
import { FormProvider, useForm } from 'react-hook-form';

import { ModalHookLayout } from '@/components/common/modal/ModalLayout';
import PageHeader from '@/components/common/header/PageHeader';
import PageBody from '@/components/common/layout/PageBody';
import RoleCreationForm from '@/components/system-config/role-management/RoleCreationForm';
import { RoleCreationRequest } from '@/lib/dtos/request/role.req';
import { RoleCreationValidation } from '@/lib/validators/rbac.validator';
import { RoleResponse } from '@/lib/dtos/response/role.res';
import dynamic from 'next/dynamic';
import { tableQueryBuilder } from '@/lib/utils/queryParamBuilder';
import toast from 'react-hot-toast';
import { useMemo } from 'react';
import { useModal } from '@ebay/nice-modal-react';
import useRbacAction from '@/hooks/actions/useRbacAction';
import { zodResolver } from '@hookform/resolvers/zod';
import { Icons } from '@/lib/icons';

const RoleTree = dynamic(() => import('@/components/system-config/role-management/RoleTree'));

const queryParam = tableQueryBuilder({
  pagination: { pageIndex: 0, pageSize: Number.MAX_SAFE_INTEGER },
});

export default function Page() {
  const modal = useModal(ModalHookLayout);

  const formMethods = useForm<RoleCreationRequest>({
    resolver: zodResolver(RoleCreationValidation),
  });

  const { useRoleListQuery, roleCreationMutation, roleUpdateMutation } = useRbacAction();

  const { data, isLoading } = useRoleListQuery(queryParam);

  const sortedRoles = useMemo(
    () => [...(data?.data ?? [])].sort((a, b) => a.rank - b.rank),
    [data],
  );

  const onSubmit = (data: RoleCreationRequest, closeModal: () => void) => {
    roleCreationMutation.mutate(data, {
      onSuccess: () => {
        closeModal();
        toast.success('Role created successfully');
      },
    });
  };

  const onEdit = (data: RoleResponse) => {
    formMethods.reset({
      ...data,
      permissions: data.permissions.map((t) => t),
    });

    modal.show({
      title: `Edit Role #${data.id}`,
      subtitle: 'Update the details of the role',
      maxWidth: 'md',
      autoCloseOnConfirm: false,
      slotProps: {
        cancel: { text: 'Cancel' },
        confirm: {
          text: 'Update role',
          onClick: (_, closeModal) => {
            formMethods.handleSubmit((req) => {
              roleUpdateMutation.mutate(
                { id: data.id, data: req },
                {
                  onSuccess: () => {
                    closeModal();
                    modal.remove();
                    toast.success('Role updated successfully');
                  },
                },
              );
            })();
          },
        },
      },
      children: (
        <FormProvider {...formMethods}>
          <RoleCreationForm editingRoleId={data.id} existingRank={data.rank} />
        </FormProvider>
      ),
    });
  };

  const onCreate = () => {
    const maxRank = sortedRoles.length ? sortedRoles[sortedRoles.length - 1].rank + 10 : 10;
    formMethods.reset({ permissions: [], name: '', description: '', rank: maxRank });
    modal.show({
      title: 'Add New Role',
      subtitle: 'Fill in the details to create a new role',
      maxWidth: 'md',
      autoCloseOnConfirm: false,
      slotProps: {
        cancel: { text: 'Cancel' },
        confirm: {
          text: 'Create Role',
          onClick: (_, closeModal) => {
            formMethods.handleSubmit((data) => onSubmit(data, closeModal))();
          },
        },
      },
      children: (
        <FormProvider {...formMethods}>
          <RoleCreationForm />
        </FormProvider>
      ),
    });
  };

  const roleCount = sortedRoles.length;

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Role Management"
        subtitle="Define roles and assign permissions to control system access"
        icon={Icons.roles}
        rightSlot={
          <Button
            startIcon={<Icons.add />}
            variant="contained"
            color="primary"
            onClick={onCreate}
            sx={{ borderRadius: 9999 }}
          >
            Add New Role
          </Button>
        }
      />

      {/* Content */}
      <PageBody>
        {/* Loading state */}
        {isLoading && (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} variant="rounded" height={84} sx={{ borderRadius: 2 }} />
            ))}
          </div>
        )}

        {/* Empty state */}
        {!isLoading && roleCount === 0 && (
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              py: 12,
              px: 4,
              borderRadius: 2,
              border: '2px dashed',
              borderColor: 'divider',
            }}
          >
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 64,
                height: 64,
                borderRadius: '50%',
                bgcolor: 'action.hover',
                mb: 3,
              }}
            >
              <Icons.roles size={28} style={{ opacity: 0.4 }} />
            </Box>
            <Typography
              variant="h6"
              gutterBottom
              sx={{
                fontWeight: 600,
              }}
            >
              No roles defined yet
            </Typography>
            <Typography
              variant="body2"
              sx={{
                color: 'text.secondary',
                textAlign: 'center',
                maxWidth: 360,
                mb: 3,
              }}
            >
              Create your first role to start managing permissions and access control across the
              system.
            </Typography>
            <Button
              startIcon={<Icons.add />}
              variant="contained"
              onClick={onCreate}
              sx={{ borderRadius: 9999 }}
            >
              Create First Role
            </Button>
          </Box>
        )}

        {/* Role hierarchy — top-down tree */}
        {!isLoading && roleCount > 0 && <RoleTree roles={sortedRoles} onEdit={onEdit} />}
      </PageBody>
    </div>
  );
}
