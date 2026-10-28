'use client';

import { useSession } from '@/lib/auth-client';
import { SidebarGroup } from '@/lib/routes/index.routes';
import { filterSidebarGroups, sidebarGroupKey } from '@/lib/routes/sidebar.util';
import { Divider } from '@mui/material';
import { useMemo } from 'react';
import { twMerge } from 'tailwind-merge';
import DrawerAccountMenu from './menu/DrawerAccountMenu';
import NavigationList from './NavigationList';

interface DrawerContentProps {
  items: SidebarGroup[];
  compact?: boolean;
}

export default function DrawerContent({ items, compact = false }: DrawerContentProps) {
  const { data: session } = useSession();
  const rolePermissions = session?.user?.role?.permissions;

  /*
   * Plain any-of overlap at both levels — the same rule `useHasPermission` and
   * every `PermissionLayout` apply, so the sidebar shows exactly the pages the
   * user can open. See `filterSidebarGroups` for what the old audience-marker
   * special case broke.
   */
  const filteredItems = useMemo(
    () => filterSidebarGroups(items, rolePermissions ?? []),
    [items, rolePermissions],
  );

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Scrollable navigation area */}
      <div
        className={twMerge(
          // `scrollbar-none` is not a Tailwind default and no plugin defines it —
          // the arbitrary variants are what actually hide the scrollbar.
          'flex flex-1 flex-col overflow-auto px-3 py-2 [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden',
          !compact && 'gap-4',
        )}
      >
        {filteredItems.map((item) => (
          <NavigationList key={sidebarGroupKey(item)} item={item} compact={compact} />
        ))}
      </div>

      {/* Bottom pinned section */}
      <div className="shrink-0 px-3 pb-3">
        <Divider sx={{ mb: 2, borderColor: (theme) => theme.custom.sidebar.navDivider }} />
        <DrawerAccountMenu compact={compact} />
      </div>
    </div>
  );
}
