'use client';

import { FormProvider, useForm } from 'react-hook-form';
import { CreateTicketRequest } from '@/lib/dtos/request/support.req';
import { TicketCreateValidation } from '@/lib/validators/support-ticket.validator';

import { Button } from '@mui/material';
import ModalLayout from '@/components/common/modal/ModalLayout';
import PageHeader from '@/components/common/header/PageHeader';
import PageBody from '@/components/common/layout/PageBody';
import TicketCreateForm from '@/components/support/TicketCreateForm';
import TicketTable from '@/components/support/TicketTable';
import toast from 'react-hot-toast';
import useSupportTicketAction from '@/hooks/actions/useSupportTicketAction';
import useSupportFileUpload from '@/hooks/useSupportFileUpload';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { Icons } from '@/lib/icons';

export default function Page() {
  const [openModal, setOpenModal] = useState(false);

  const ticketFormMethods = useForm<CreateTicketRequest>({
    resolver: zodResolver(TicketCreateValidation),
    defaultValues: {
      subject: '',
      description: '',
      category: 'GENERAL',
      priority: 'MEDIUM',
    },
  });

  const {
    slots,
    addFiles,
    removeSlot,
    isUploading,
    reset: resetUploads,
    uploadAll,
  } = useSupportFileUpload();
  const { createTicketMutation } = useSupportTicketAction();

  const onCreateTicket = async (data: CreateTicketRequest, closeModal: () => void) => {
    const { results, hasErrors } = await uploadAll();
    if (hasErrors) {
      toast.error('Some files failed to upload. Remove them before submitting.');
      return;
    }
    const payload: CreateTicketRequest = { ...data, attachments: results };
    createTicketMutation.mutate(payload, {
      onSuccess: () => {
        closeModal();
        ticketFormMethods.reset();
        toast.success('Ticket created successfully');
      },
    });
  };

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Support Tickets"
        subtitle="Manage user support requests and issue tracking"
        icon={Icons.support}
        rightSlot={
          <FormProvider {...ticketFormMethods}>
            <ModalLayout
              externalControl={{
                open: openModal,
                onClose: () => {
                  setOpenModal(false);
                  resetUploads();
                  ticketFormMethods.reset();
                },
              }}
              targetComponent={
                <Button
                  onClick={() => setOpenModal(true)}
                  startIcon={<Icons.add />}
                  variant="contained"
                  color="primary"
                  sx={{ borderRadius: 9999 }}
                >
                  New Ticket
                </Button>
              }
              autoCloseOnConfirm={false}
              maxWidth="md"
              title="Create Support Ticket"
              subtitle="Fill in the details to create a new support ticket."
              slotProps={{
                cancel: { text: 'Cancel' },
                confirm: {
                  text: 'Create Ticket',
                  color: 'primary',
                  disabled: isUploading,
                  onClick: (_, closeModal) => {
                    ticketFormMethods.handleSubmit((data) => onCreateTicket(data, closeModal))();
                  },
                },
              }}
            >
              <TicketCreateForm slots={slots} addFiles={addFiles} removeSlot={removeSlot} />
            </ModalLayout>
          </FormProvider>
        }
      />

      <PageBody>
        <TicketTable />
      </PageBody>
    </div>
  );
}
