'use client';

import {
  Box,
  Collapse,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  Tooltip,
} from '@mui/material';
import { MouseEvent, useEffect, useRef, useState } from 'react';

import { SidebarItem } from '@/lib/routes/index.routes';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { twMerge } from 'tailwind-merge';
import NavigationList from './NavigationList';
import { Icons } from '@/lib/icons';

interface NavigationItemProps {
  compact?: boolean;
  item: SidebarItem;
}

export default function NavigationItem({ item, compact }: NavigationItemProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

  const isActiveLink = (itemLink: string): boolean => {
    if (!itemLink || !pathname) return false;
    if (itemLink === '/') return pathname === '/';

    const cleanSegments = (url: string) => url.split('/').filter(Boolean);
    const linkSegments = cleanSegments(itemLink);
    const pathSegments = cleanSegments(pathname);

    return (
      linkSegments.length <= pathSegments.length &&
      linkSegments.every((segment, index) => segment === pathSegments[index])
    );
  };

  const active = isActiveLink(item.link);

  /*
   * The page's own entry kept in view: the sidebar hides its scrollbar and pins the account card at
   * the bottom, so an active item further down would otherwise sit under the card unseen.
   */
  const buttonRef = useRef<HTMLDivElement>(null);
  const leafActive = active && !item.child;
  useEffect(() => {
    if (leafActive) buttonRef.current?.scrollIntoView({ block: 'nearest' });
  }, [leafActive]);

  const handleClick = (e: MouseEvent<HTMLDivElement>) => {
    if (item.child && !compact) {
      setOpen(!open);
    } else if (compact && item.child) {
      setAnchor(e.currentTarget);
    }
  };

  return (
    <div>
      <Tooltip title={item.text} arrow placement="right" disableHoverListener={!compact}>
        <ListItem
          component={item.child ? 'div' : Link}
          href={item.link}
          disablePadding
          sx={{ py: 0.25 }}
        >
          <ListItemButton
            ref={buttonRef}
            selected={active}
            onClick={handleClick}
            sx={{
              borderRadius: (theme) => `${theme.shape.borderRadius}px`,
              justifyContent: compact ? 'center' : 'initial',
              py: 0.9,
              px: 1.5,
              ...(active && {
                bgcolor: (theme) => theme.custom.sidebar.navItemActiveBg,
              }),
              '&:hover': {
                bgcolor: (theme) => theme.custom.sidebar.navItemHoverBg,
              },
              '&.Mui-selected': {
                bgcolor: (theme) => theme.custom.sidebar.navItemActiveBg,
                '&:hover': {
                  bgcolor: (theme) => theme.custom.sidebar.navItemActiveBg,
                },
              },
            }}
          >
            <ListItemIcon
              sx={{
                minWidth: 0,
                mr: compact ? 0 : 1.5,
                p: compact ? 0.75 : 0,
                color: (theme) =>
                  active
                    ? theme.custom.sidebar.navItemIconActive
                    : theme.custom.sidebar.navItemIcon,
                transition: 'color 0.15s ease',
              }}
            >
              <item.icon size={19} className="shrink-0" />
            </ListItemIcon>

            <Collapse
              in={!compact}
              orientation="horizontal"
              sx={{
                minWidth: 0,
                flex: 1,
                '& .MuiCollapse-wrapper': { width: '100%' },
                '& .MuiCollapse-wrapperInner': { width: '100%' },
              }}
            >
              <ListItemText
                primary={item.text}
                sx={{ overflow: 'hidden', minWidth: 0 }}
                slotProps={{
                  primary: {
                    noWrap: true,
                    sx: {
                      fontSize: 13.5,
                      fontWeight: active ? 600 : 500,
                      color: (theme) =>
                        active
                          ? theme.custom.sidebar.navItemTextActive
                          : theme.custom.sidebar.navItemText,
                      transition: 'color 0.15s ease',
                    },
                  },
                }}
              />
            </Collapse>

            {item.child && !compact && (
              <Box
                component="span"
                sx={{
                  ml: 'auto',
                  flexShrink: 0,
                  opacity: 0.4,
                  color: (theme) => theme.custom.sidebar.navItemArrow,
                }}
              >
                <Icons.chevronRight
                  size={18}
                  className={twMerge('transition-transform duration-200', open && 'rotate-90')}
                />
              </Box>
            )}
          </ListItemButton>
        </ListItem>
      </Tooltip>

      {item.child && (
        <>
          <Menu
            anchorEl={anchor}
            open={Boolean(anchor)}
            onClose={() => setAnchor(null)}
            anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
            transformOrigin={{ vertical: 'top', horizontal: 'left' }}
            slotProps={{
              paper: {
                sx: {
                  overflow: 'visible',
                  ml: 2,
                  px: 1,
                  mt: -0.5,
                  '&::before': {
                    content: '""',
                    display: 'block',
                    position: 'absolute',
                    top: 20,
                    left: 0,
                    width: 14,
                    height: 14,
                    borderColor: 'divider',
                    borderWidth: '1px 0px 0px 1px',
                    bgcolor: 'background.paper',
                    transform: 'translateX(-50%) rotate(-45deg)',
                  },
                },
              },
            }}
          >
            <NavigationList item={item.child} />
          </Menu>

          <Collapse in={open && !compact}>
            <Box
              sx={{
                ml: 3,
                pl: 1,
                borderLeft: 2,
                borderColor: (theme) => theme.custom.sidebar.navBranchBorder,
              }}
            >
              <NavigationList item={item.child} />
            </Box>
          </Collapse>
        </>
      )}
    </div>
  );
}
