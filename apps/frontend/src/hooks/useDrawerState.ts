import { useCallback, useEffect, useRef, useState } from 'react';
import { useMediaQuery, useTheme } from '@mui/material';

import { drawerCookieName } from '@/lib/drawer-cookie';

const STORAGE_PREFIX = 'drawer_state';

function getStoredState(key: string): boolean | null {
  if (typeof window === 'undefined') return null;
  try {
    const val = localStorage.getItem(`${STORAGE_PREFIX}:${key}`);
    return val !== null ? JSON.parse(val) : null;
  } catch {
    return null;
  }
}

function storeState(key: string, value: boolean) {
  localStorage.setItem(`${STORAGE_PREFIX}:${key}`, JSON.stringify(value));
  document.cookie = `${drawerCookieName(key)}=${value}; path=/; max-age=31536000; samesite=lax`;
}

/**
 * Open/closed state of a drawer, remembered per `key`. `initial` is the value the server read from the cookie: the
 * first render must use it (not localStorage, which the server cannot see) or hydration fails.
 */
export default function useDrawerState(key = 'default', initial: boolean | null = null) {
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up('md'));
  const initializedRef = useRef(false);

  const [open, setOpenRaw] = useState(initial ?? true);

  // After mount: no stored preference -> follow the breakpoint; a preference saved before the cookie existed -> apply
  // it and write the cookie.
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    const stored = getStoredState(key);
    if (stored === null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time sync of initial drawer state to the resolved responsive breakpoint when no stored preference exists; useMediaQuery resolves on the client, so this can't be done in the lazy initializer
      setOpenRaw(isDesktop);
    } else if (stored !== initial) {
      storeState(key, stored);
      setOpenRaw(stored);
    }
  }, [isDesktop, key, initial]);

  const setOpen = useCallback(
    (value: boolean | ((prev: boolean) => boolean)) => {
      setOpenRaw((prev) => {
        const next = typeof value === 'function' ? value(prev) : value;
        storeState(key, next);
        return next;
      });
    },
    [key],
  );

  return [open, setOpen] as const;
}
