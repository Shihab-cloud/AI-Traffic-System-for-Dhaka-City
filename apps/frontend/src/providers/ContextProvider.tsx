'use client';

// Registers the dayjs utc/timezone/relativeTime plugins once at the app root, so
// `LocalizationProvider` below and every `dayjs.utc` caller can rely on them
// regardless of which module renders first.
import '@/lib/utils/dayjs.setup';

import AppProgress from '@/components/common/loader/AppProgress';
import { apiErrorMessage } from '@/lib/utils/common.util';
import type { ThemeSettings } from '@/lib/theme/theme-settings';
import { ThemeContextProvider } from '@/providers/ThemeContextProvider';
import ModalProvider from '@ebay/nice-modal-react';
import { AppRouterCacheProvider } from '@mui/material-nextjs/v13-appRouter';
import { LocalizationProvider } from '@mui/x-date-pickers';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import toast, { Toaster } from 'react-hot-toast';
import { IconProvider } from '@/lib/icons';

const onHttpError = (error: any, _v: any, _c: any, mutation: any) => {
  if (mutation?.options?.onError) return;
  return toast.error(apiErrorMessage(error, 'Something went wrong'));
};

function createQueryClient() {
  return new QueryClient({
    mutationCache: new MutationCache({
      onError: onHttpError,
    }),
    defaultOptions: {
      queries: {
        // `true`, not `'always'`: `'always'` ignores `staleTime` entirely, so
        // alt-tabbing back refetches every mounted query and flashes the
        // top progress bar on each one.
        refetchOnWindowFocus: true,
        retry: false,
        staleTime: 1000 * 60,
      },
    },
  });
}

export default function ContextProvider({
  children,
  initialThemeSettings,
}: {
  children: React.ReactNode;
  initialThemeSettings?: ThemeSettings;
}) {
  // Per-render-tree, not module scope: Next evaluates client modules on the
  // server too, so a module-scope client would be one cache shared across
  // every SSR request and every user.
  const [queryClient] = useState(createQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      <AppRouterCacheProvider>
        <ThemeContextProvider initialSettings={initialThemeSettings}>
          <LocalizationProvider dateAdapter={AdapterDayjs}>
            {/* Inside the theme, so the bar takes the active theme's primary colour. */}
            <AppProgress>
              <IconProvider>
                <ModalProvider.Provider>
                  {children}
                  <Toaster position="top-center" reverseOrder={false} gutter={8} />
                </ModalProvider.Provider>
              </IconProvider>
            </AppProgress>
          </LocalizationProvider>
        </ThemeContextProvider>
      </AppRouterCacheProvider>
      {/* <ReactQueryDevtools initialIsOpen={false} /> */}
    </QueryClientProvider>
  );
}
