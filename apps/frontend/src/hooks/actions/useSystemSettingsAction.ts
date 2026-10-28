'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { QUERY_KEYS } from '@/lib/constants/query-keys';
import { UpdateSystemSettingsRequest } from '@/lib/dtos/request/system-settings.req';
import systemSettingsService from '@/lib/services/system-settings.service';

export default function useSystemSettingsAction() {
  const qc = useQueryClient();

  // ── Queries ──────────────────────────────────────────────────────────────

  const useSettingsQuery = (enabled = true) =>
    useQuery({
      queryKey: [QUERY_KEYS.systemSettings.get],
      queryFn: () => systemSettingsService.getSettings(),
      enabled,
    });

  const usePublicSettingsQuery = (enabled = true) =>
    useQuery({
      queryKey: [QUERY_KEYS.systemSettings.getPublic],
      queryFn: () => systemSettingsService.getPublicSettings(),
      enabled,
    });

  // ── Mutations ────────────────────────────────────────────────────────────

  const useUpdateSettingsMutation = () =>
    useMutation({
      mutationFn: (data: UpdateSystemSettingsRequest) => systemSettingsService.updateSettings(data),
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: [QUERY_KEYS.systemSettings.get] });
        qc.invalidateQueries({ queryKey: [QUERY_KEYS.systemSettings.getPublic] });
      },
    });

  return {
    useSettingsQuery,
    usePublicSettingsQuery,
    useUpdateSettingsMutation,
  };
}
