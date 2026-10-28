'use client';

import supportFileService from '@/lib/services/supportFile.service';
import { useCallback, useRef, useState } from 'react';

/** Exported so the picker advertises exactly what this hook accepts. */
export const ALLOWED_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'application/pdf',
  'text/csv',
];
export const MAX_SIZE_MB = 100;
const MAX_SIZE = MAX_SIZE_MB * 1024 * 1024;

export type UploadState = 'staged' | 'uploading' | 'done' | 'error';

export interface SupportFileUploadResult {
  fileKey: string;
  fileName: string;
}

export interface UploadSlot {
  id: string;
  file: File;
  state: UploadState;
  progress: number;
  result: SupportFileUploadResult | null;
  error: string | null;
}

/** The reason a file cannot be uploaded, or `null` when it can. */
function rejectionReason(file: File): string | null {
  if (!ALLOWED_TYPES.includes(file.type)) {
    return 'Unsupported file type. Allowed: images, video, PDF, CSV.';
  }
  if (file.size > MAX_SIZE) return `File exceeds the ${MAX_SIZE_MB}MB limit.`;
  return null;
}

export default function useSupportFileUpload() {
  const [slots, setSlots] = useState<UploadSlot[]>([]);
  // The ref is the source of truth and is written synchronously; `slots` only
  // mirrors it for rendering. Parallel uploads mutate this list from their own
  // callbacks, so reading it back out of React state would race with them.
  const slotsRef = useRef<UploadSlot[]>([]);

  const commit = useCallback((next: UploadSlot[]) => {
    slotsRef.current = next;
    setSlots(next);
  }, []);

  const updateSlot = useCallback(
    (id: string, patch: Partial<UploadSlot>) => {
      commit(slotsRef.current.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    },
    [commit],
  );

  const uploadSlot = useCallback(
    async (slot: UploadSlot): Promise<void> => {
      const { id, file } = slot;
      updateSlot(id, { state: 'uploading', progress: 0, error: null });

      try {
        const { presignedUrl, key } = await supportFileService.getPresignedUrl({
          fileName: file.name,
          mimeType: file.type,
        });
        let lastProgress = -1;
        await supportFileService.uploadToS3({
          presignedUrl,
          file,
          // XHR fires progress far more often than the bar can show; only a
          // whole-percent change is worth a re-render of the slot list.
          onProgress: (progress) => {
            const whole = Math.floor(progress);
            if (whole === lastProgress) return;
            lastProgress = whole;
            updateSlot(id, { progress: whole });
          },
        });
        updateSlot(id, { state: 'done', result: { fileKey: key, fileName: file.name } });
      } catch (err) {
        updateSlot(id, {
          state: 'error',
          error: err instanceof Error ? err.message : 'Upload failed',
        });
      }
    },
    [updateSlot],
  );

  const addFiles = useCallback(
    (files: File[]) => {
      const newSlots = files.map<UploadSlot>((file) => {
        const error = rejectionReason(file);
        return {
          id: crypto.randomUUID(),
          file,
          state: error ? 'error' : 'staged',
          progress: 0,
          result: null,
          error,
        };
      });
      commit([...slotsRef.current, ...newSlots]);
    },
    [commit],
  );

  /**
   * Upload everything still staged, then report on the whole list.
   *
   * Both halves are deliberately read from the committed list rather than from
   * this run's results: a slot that succeeded on an earlier attempt is still an
   * attachment, and a file rejected at add-time never became `staged`, so
   * neither would otherwise be visible to the caller's send gate.
   */
  const uploadAll = useCallback(async (): Promise<{
    results: SupportFileUploadResult[];
    hasErrors: boolean;
  }> => {
    const staged = slotsRef.current.filter((s) => s.state === 'staged');
    await Promise.all(staged.map((slot) => uploadSlot(slot)));

    return {
      results: slotsRef.current.flatMap((s) => (s.result ? [s.result] : [])),
      hasErrors: slotsRef.current.some((s) => s.state === 'error'),
    };
  }, [uploadSlot]);

  const removeSlot = useCallback(
    (id: string) => {
      commit(slotsRef.current.filter((s) => s.id !== id));
    },
    [commit],
  );

  const reset = useCallback(() => commit([]), [commit]);

  const isUploading = slots.some((s) => s.state === 'uploading');

  return { slots, addFiles, removeSlot, reset, isUploading, uploadAll };
}
