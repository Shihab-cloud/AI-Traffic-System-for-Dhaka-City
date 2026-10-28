import NiceModal, { useModal } from '@ebay/nice-modal-react';
import {
  Button,
  ButtonProps,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentProps,
  DialogProps,
  DialogTitle,
  IconButton,
  IconButtonProps,
  Typography,
  TypographyProps,
} from '@mui/material';
import { HTMLAttributes, MouseEvent, ReactElement, ReactNode, useEffect, useState } from 'react';
import { Icons } from '@/lib/icons';

interface ModalLayoutProps extends Pick<
  DialogProps,
  'maxWidth' | 'fullWidth' | 'scroll' | 'fullScreen' | 'component' | 'onSubmit'
> {
  children: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  externalControl?: { open: boolean; onClose: () => any };
  targetComponent?: ReactElement<HTMLAttributes<HTMLElement>, any>;
  autoCloseOnConfirm?: boolean;
  slotProps?: {
    dialogContent?: DialogContentProps;
    title?: TypographyProps;
    subtitle?: TypographyProps;
    close?: IconButtonProps;
    confirm?: Omit<ButtonProps, 'onClick'> & {
      text: string;
      onClick?: (e: MouseEvent<HTMLButtonElement>, closeModal: () => void) => any;
    };
    cancel?: ButtonProps & {
      text: string;
    };
  };
}

export default function ModalLayout({
  title,
  subtitle,
  fullWidth = true,
  autoCloseOnConfirm = true,
  externalControl,
  children,
  slotProps,
  targetComponent: TargetComponent,
  ...props
}: ModalLayoutProps) {
  const [openModal, setOpenModal] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs internal open state from the controlled `externalControl.open` prop; component also supports uncontrolled mode (handleOpen), so state can't be derived during render
    if (externalControl) setOpenModal(externalControl.open);
  }, [externalControl]);

  const handleClose = () => {
    if (externalControl) externalControl.onClose();
    else setOpenModal(false);
  };

  const handleOpen = () => {
    setOpenModal(true);
  };

  const handleCancelClick = (e: MouseEvent<HTMLButtonElement>) => {
    slotProps?.cancel?.onClick?.(e);
    handleClose();
  };

  const handleConfirmClick = (e: MouseEvent<HTMLButtonElement>) => {
    if (autoCloseOnConfirm) {
      slotProps?.confirm?.onClick?.(e, () => {});
      handleClose();
    } else {
      slotProps?.confirm?.onClick?.(e, handleClose);
    }
  };

  return (
    <>
      {TargetComponent && (
        <TargetComponent.type
          {...TargetComponent.props}
          onClick={TargetComponent.props.onClick || handleOpen}
        />
      )}

      <Dialog
        {...props}
        fullWidth={fullWidth}
        scroll="paper"
        open={openModal}
        onClose={handleClose}
        slotProps={{
          paper: { elevation: 0 },
        }}
      >
        <DialogTitle
          sx={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            width: '100%',
          }}
        >
          <div>
            <Typography variant="h6" color="text.primary" {...slotProps?.title}>
              {title}
            </Typography>
            {subtitle && (
              <Typography variant="subtitle1" color="text.secondary" {...slotProps?.subtitle}>
                {subtitle}
              </Typography>
            )}
          </div>
          <IconButton color="default" {...slotProps?.close} onClick={handleClose}>
            <Icons.close />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers {...slotProps?.dialogContent}>
          {children}
        </DialogContent>
        {slotProps && (
          <DialogActions>
            {slotProps.cancel && (
              <Button
                color="ghost"
                fullWidth
                variant="outlined"
                {...slotProps.cancel}
                onClick={handleCancelClick}
              >
                {slotProps.cancel.text}
              </Button>
            )}

            {slotProps.confirm && (
              <Button
                color="primary"
                fullWidth
                variant="contained"
                autoFocus
                {...slotProps.confirm}
                onClick={handleConfirmClick}
              >
                {slotProps.confirm.text}
              </Button>
            )}
          </DialogActions>
        )}
      </Dialog>
    </>
  );
}

export const ModalHookLayout = NiceModal.create((props: ModalLayoutProps) => {
  const modal = useModal();

  return (
    <ModalLayout
      {...props}
      externalControl={{
        open: modal.visible,
        onClose: modal.hide,
      }}
    >
      {props.children}
    </ModalLayout>
  );
});
