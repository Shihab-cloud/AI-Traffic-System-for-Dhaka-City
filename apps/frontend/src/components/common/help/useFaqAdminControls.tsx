'use client';

import { ReactNode, useCallback, useEffect, useState } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AnimatePresence, motion } from 'motion/react';
import { Box, Button, Typography } from '@mui/material';
import toast from 'react-hot-toast';
import ModalLayout from '@/components/common/modal/ModalLayout';
import FaqForm from '@/components/super-admin/faq/FaqForm';
import useFaqAction from '@/hooks/actions/useFaqAction';
import { CreateFaqRequest } from '@/lib/dtos/request/faq.req';
import { FaqResponse } from '@/lib/dtos/response/faq.res';
import { FaqAudienceEnum } from '@/lib/enums/faq.enum';
import { FaqCreateValidation } from '@/lib/validators/faq.validator';
import { Icons } from '@/lib/icons';

const emptyFaq: CreateFaqRequest = {
  question: '',
  answer: '',
  category: 'General',
  audience: [FaqAudienceEnum.PUBLIC],
  isPublished: false,
};

interface FaqAdminControls {
  items: FaqResponse[];
  isDirty: boolean;
  setLocalItems: (items: FaqResponse[]) => void;
  createOpen: boolean;
  openCreate: () => void;
  closeCreate: () => void;
  handleEdit: (faq: FaqResponse) => void;
  handleDelete: (faq: FaqResponse) => void;
  modals: ReactNode;
  reorderBar: ReactNode;
}

export function useFaqAdminControls(serverItems: FaqResponse[]): FaqAdminControls {
  const [editingFaq, setEditingFaq] = useState<FaqResponse | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<FaqResponse | null>(null);
  const [localItems, setLocalItemsState] = useState<FaqResponse[]>(serverItems);
  const [isDirty, setIsDirty] = useState(false);

  const { createFaqMutation, updateFaqMutation, deleteFaqMutation, reorderFaqsMutation } =
    useFaqAction();

  // Re-sync local items with refetched server data only while not dirty. Keyed
  // on the id list (a stable string), NOT the array reference — callers often
  // pass `data ?? []`, which mints a new array every render; depending on the
  // reference would re-fire this effect endlessly (Maximum update depth).
  const serverItemsKey = serverItems.map((f) => f.id).join(',');
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- gated on user-driven `isDirty`, so not derivable during render
    if (!isDirty) setLocalItemsState(serverItems);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally key on the stable id-list, not the array identity
  }, [serverItemsKey, isDirty]);

  const setLocalItems = useCallback((next: FaqResponse[]) => {
    setLocalItemsState(next);
    setIsDirty(true);
  }, []);

  const cancelReorder = useCallback(() => {
    setLocalItemsState(serverItems);
    setIsDirty(false);
  }, [serverItems]);

  const items = isDirty ? localItems : serverItems;

  const createMethods = useForm<CreateFaqRequest>({
    resolver: zodResolver(FaqCreateValidation),
    defaultValues: emptyFaq,
  });
  const editMethods = useForm<CreateFaqRequest>({
    resolver: zodResolver(FaqCreateValidation),
    defaultValues: emptyFaq,
  });

  const handleEdit = (faq: FaqResponse) => {
    setEditingFaq(faq);
    editMethods.reset({
      question: faq.question,
      answer: faq.answer,
      category: faq.category,
      audience: faq.audience,
      isPublished: faq.isPublished,
    });
    setEditOpen(true);
  };

  const onCreate = (dto: CreateFaqRequest, closeModal: () => void) => {
    createFaqMutation.mutate(dto, {
      onSuccess: () => {
        closeModal();
        setCreateOpen(false);
        createMethods.reset(emptyFaq);
        toast.success('FAQ created');
      },
      onError: () => toast.error('Failed to create FAQ'),
    });
  };

  const onUpdate = (dto: CreateFaqRequest, closeModal: () => void) => {
    if (!editingFaq) return;
    updateFaqMutation.mutate(
      { id: editingFaq.id, data: dto },
      {
        onSuccess: () => {
          closeModal();
          setEditOpen(false);
          setEditingFaq(null);
          toast.success('FAQ updated');
        },
        onError: () => toast.error('Failed to update FAQ'),
      },
    );
  };

  const onDelete = (closeModal: () => void) => {
    if (!deleteTarget) return;
    deleteFaqMutation.mutate(deleteTarget.id, {
      onSuccess: () => {
        closeModal();
        setDeleteTarget(null);
        toast.success('FAQ deleted');
      },
      onError: () => toast.error('Failed to delete FAQ'),
    });
  };

  const handleSaveOrder = () => {
    reorderFaqsMutation.mutate(
      { faqItems: localItems.map((faq, index) => ({ id: faq.id, displayOrder: index })) },
      {
        onSuccess: () => {
          setIsDirty(false);
          toast.success('Order saved');
        },
        onError: () => toast.error('Failed to save order'),
      },
    );
  };

  const reorderBar = (
    <AnimatePresence>
      {isDirty && (
        <motion.div
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 80, opacity: 0 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          style={{
            position: 'fixed',
            bottom: 24,
            left: 0,
            right: 0,
            display: 'flex',
            justifyContent: 'center',
            zIndex: 1300,
            pointerEvents: 'none',
          }}
        >
          <Box
            sx={{
              pointerEvents: 'auto',
              display: 'flex',
              alignItems: 'center',
              gap: 2,
              px: 2.5,
              py: 1.25,
              bgcolor: 'background.paper',
              border: (theme) => `1px solid ${theme.palette.divider}`,
              borderRadius: 9999,
              boxShadow: 4,
            }}
          >
            <Typography
              variant="body2"
              sx={{
                fontWeight: 600,
              }}
            >
              Unsaved order changes
            </Typography>
            <Button
              size="small"
              variant="text"
              color="ghost"
              startIcon={<Icons.close />}
              onClick={cancelReorder}
              disabled={reorderFaqsMutation.isPending}
              sx={{ borderRadius: 9999 }}
            >
              Cancel
            </Button>
            <Button
              size="small"
              variant="contained"
              color="primary"
              startIcon={<Icons.save />}
              onClick={handleSaveOrder}
              loading={reorderFaqsMutation.isPending}
              sx={{ borderRadius: 9999 }}
            >
              Save order
            </Button>
          </Box>
        </motion.div>
      )}
    </AnimatePresence>
  );

  const modals = (
    <>
      <FormProvider {...createMethods}>
        <ModalLayout
          externalControl={{ open: createOpen, onClose: () => setCreateOpen(false) }}
          autoCloseOnConfirm={false}
          maxWidth="md"
          title="Create FAQ"
          subtitle="Draft a new question and answer."
          slotProps={{
            cancel: { text: 'Cancel' },
            confirm: {
              text: 'Create',
              color: 'primary',
              onClick: (_, closeModal) => {
                createMethods.handleSubmit((dto) => onCreate(dto, closeModal))();
              },
            },
          }}
        >
          <FaqForm />
        </ModalLayout>
      </FormProvider>

      <FormProvider {...editMethods}>
        <ModalLayout
          externalControl={{ open: editOpen, onClose: () => setEditOpen(false) }}
          autoCloseOnConfirm={false}
          maxWidth="md"
          title="Edit FAQ"
          subtitle="Update the FAQ content and settings."
          slotProps={{
            cancel: { text: 'Cancel' },
            confirm: {
              text: 'Save',
              color: 'primary',
              onClick: (_, closeModal) => {
                editMethods.handleSubmit((dto) => onUpdate(dto, closeModal))();
              },
            },
          }}
        >
          <FaqForm />
        </ModalLayout>
      </FormProvider>

      <ModalLayout
        externalControl={{ open: !!deleteTarget, onClose: () => setDeleteTarget(null) }}
        autoCloseOnConfirm={false}
        maxWidth="xs"
        title="Delete FAQ"
        slotProps={{
          cancel: { text: 'Cancel' },
          confirm: {
            text: 'Delete',
            color: 'error',
            loading: deleteFaqMutation.isPending,
            onClick: (_, closeModal) => onDelete(closeModal),
          },
        }}
      >
        {deleteTarget && (
          <>
            Are you sure you want to delete this FAQ?
            <br />
            <strong>&ldquo;{deleteTarget.question}&rdquo;</strong>
            <br />
            <span style={{ opacity: 0.7 }}>This action cannot be undone.</span>
          </>
        )}
      </ModalLayout>
    </>
  );

  return {
    items,
    isDirty,
    setLocalItems,
    createOpen,
    openCreate: () => setCreateOpen(true),
    closeCreate: () => setCreateOpen(false),
    handleEdit,
    handleDelete: setDeleteTarget,
    modals,
    reorderBar,
  };
}
