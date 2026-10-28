/* eslint-disable @next/next/no-img-element */
'use client';

import { useEffect, useRef, useState } from 'react';

import { alpha, Box, Typography } from '@mui/material';

import DropzonePreview from './DropzonePreview';

interface DropzoneProps {
  className?: string;
  maxSizeMB?: number;
  /** Override the accepted MIME types for the active variant. */
  acceptedTypes?: string[];
  onChange?: (file: File | null) => void;
  defaultValue?: File | null | string;
  compact?: boolean;
  previewHeight?: number;
  variant?: 'image' | 'video' | 'file';
  error?: boolean;
  /**
   * Accept several files per drop, and hand them to `onFiles` instead of
   * previewing one internally.
   *
   * In this mode the caller owns the resulting list — which is the right split
   * when the files are being uploaded individually and each needs its own
   * progress and error state, as the support-ticket attachment flow does.
   * Validation is left to the caller too, so the rules live in one place
   * rather than being enforced here and again on upload.
   */
  multiple?: boolean;
  /** Required when `multiple` is set. */
  onFiles?: (files: File[]) => void;
  /** Replaces the default copy — e.g. to name what is being attached. */
  hint?: string;
  /** Overrides the noun in "Click to upload {label}" (default: the variant). */
  label?: string;
  /** Disables selection while an upload is in flight. */
  disabled?: boolean;
}

const VARIANT_DEFAULTS = {
  image: {
    types: ['image/jpeg', 'image/png'],
    hint: 'JPEG or PNG',
    label: 'image',
    errorMsg: 'Invalid file type. Please choose a valid image file.',
  },
  video: {
    types: ['video/mp4'],
    hint: 'MP4',
    label: 'video',
    errorMsg: 'Invalid file type. Please choose a valid video file.',
  },
  file: {
    types: [
      'text/csv',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ],
    hint: 'CSV or Excel',
    label: 'file',
    errorMsg: 'Invalid file type. Please choose a CSV or Excel file.',
  },
};

/**
 * Drag-and-drop file picker. Three variants — `image`, `video` and `file` —
 * each with their own accepted MIME types and preview.
 */
export default function Dropzone({
  className,
  maxSizeMB = 5,
  acceptedTypes,
  onChange,
  defaultValue,
  compact = false,
  variant = 'image',
  previewHeight,
  error,
  multiple = false,
  onFiles,
  hint: hintOverride,
  label: labelOverride,
  disabled = false,
}: DropzoneProps) {
  const [preview, setPreview] = useState<File | string | null>(defaultValue ?? null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resyncs local preview when the `defaultValue` prop changes; preview is also mutated by user file select/remove so it can't be derived during render
    setPreview(defaultValue ?? null);
  }, [defaultValue]);

  const defaults = VARIANT_DEFAULTS[variant];
  const types = acceptedTypes ?? defaults.types;
  const accept = types.join(',');
  const hint = hintOverride ?? `${defaults.hint} (MAX. ${maxSizeMB}MB)`;

  const isValidFile = (file: File): boolean => {
    if (file.size > maxSizeMB * 1024 * 1024) {
      setValidationError(`File size exceeds the maximum limit of ${maxSizeMB} MB.`);
      return false;
    }
    if (!types.includes(file.type)) {
      setValidationError(defaults.errorMsg);
      return false;
    }
    return true;
  };

  const handleFileChange = (file: File | null | undefined) => {
    setValidationError(null);
    if (!file || !isValidFile(file)) return;
    setPreview(file);
    onChange?.(file);
  };

  /** Multi-file path: hand everything to the caller, keep no preview state. */
  const handleFilesChange = (files: FileList | null) => {
    setValidationError(null);
    const list = Array.from(files ?? []);
    if (list.length > 0) onFiles?.(list);
  };

  const handleFileRemove = () => {
    setPreview(null);
    setValidationError(null);
    if (inputRef.current) inputRef.current.value = '';
    onChange?.(null);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    if (disabled) return;
    if (multiple) {
      handleFilesChange(e.dataTransfer.files);
      return;
    }
    handleFileChange(e.dataTransfer.files[0]);
  };

  const hasError = error || !!validationError;

  return (
    <Box
      className={className}
      sx={{ width: '100%' }}
      onDragEnter={(e) => {
        e.preventDefault();
        setIsDragOver(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        setIsDragOver(false);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
    >
      {!multiple && (
        <DropzonePreview
          variant={variant}
          media={preview}
          height={previewHeight}
          onRemoveClick={handleFileRemove}
        />
      )}

      {(multiple || !preview) && (
        <Box
          onClick={() => !disabled && inputRef.current?.click()}
          sx={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            width: '100%',
            overflow: 'hidden',
            cursor: disabled ? 'not-allowed' : 'pointer',
            opacity: disabled ? 0.6 : 1,
            borderRadius: 1,
            border: 2,
            borderStyle: 'dashed',
            p: 2,
            py: compact ? 4 : 2,
            transition: (theme) =>
              theme.transitions.create(['background-color', 'border-color'], {
                duration: theme.transitions.duration.short,
              }),
            borderColor: hasError ? 'error.main' : isDragOver ? 'primary.main' : 'divider',
            bgcolor: (theme) =>
              hasError
                ? alpha(theme.palette.error.main, 0.06)
                : isDragOver
                  ? alpha(theme.palette.primary.main, 0.06)
                  : 'background.paper',
            '&:hover': {
              bgcolor: (theme) =>
                hasError ? alpha(theme.palette.error.main, 0.1) : 'action.hover',
            },
          }}
        >
          {!compact && variant !== 'file' && (
            <img src={'/mediaUpload.svg'} alt="Upload" style={{ height: 176, marginTop: -24 }} />
          )}

          <Typography variant="body2" sx={{ mb: 0.75 }}>
            <Box component="span" sx={{ fontWeight: 600 }}>
              Click to upload {labelOverride ?? defaults.label}
            </Box>{' '}
            or drag and drop
          </Typography>

          <Typography variant="caption" color="text.secondary">
            {hint}
          </Typography>
          <input
            ref={inputRef}
            type="file"
            accept={accept}
            multiple={multiple}
            disabled={disabled}
            onChange={(e) => {
              if (multiple) {
                handleFilesChange(e.target.files);
                // Clear, so picking the same file twice still fires a change.
                e.target.value = '';
                return;
              }
              handleFileChange(e.target.files?.[0]);
            }}
            style={{ display: 'none' }}
          />
        </Box>
      )}

      {validationError && (
        <Typography variant="caption" color="error" sx={{ display: 'block', mt: 0.75 }}>
          {validationError}
        </Typography>
      )}
    </Box>
  );
}
