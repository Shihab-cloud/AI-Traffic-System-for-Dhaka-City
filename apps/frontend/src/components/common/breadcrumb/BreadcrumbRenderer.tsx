'use client';

import { Box, Breadcrumbs, Chip, Menu, MenuItem } from '@mui/material';
import { usePathname, useRouter } from 'next/navigation';

import { useState } from 'react';
import { Icons } from '@/lib/icons';

interface BreadcrumbProps {
  minimized?: boolean;
  nonClickableSegments?: string[];
}

const isId = (str: string): boolean => {
  return /^[0-9a-fA-F-]{20,}$/.test(str);
};

// Function to get display name for dynamic routes based on parent route
const getDynamicRouteDisplayName = (parentPath: string): string => {
  switch (parentPath) {
    default:
      return 'Details';
  }
};

// Function to get the href for a path segment
const getHref = (path: string, index: number, segments: string[]): string => {
  return `/${segments.slice(0, index + 1).join('/')}`;
};

/** Paths that group pages but have none of their own: a crumb for one would lead to a 404. */
const PATHS_WITHOUT_PAGE = new Set(['/admin', '/system/user-management/user']);

function formatSegment(segment: string) {
  return segment.replace(/-/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

export default function BreadcrumbRenderer({
  minimized = false,
  nonClickableSegments = [],
}: BreadcrumbProps) {
  const router = useRouter();
  const paths = usePathname();
  const pathNames = paths.split('/').filter((path) => path);

  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const open = Boolean(anchorEl);

  const handleMenuClose = () => {
    setAnchorEl(null);
  };

  // Function to get display name for a path segment
  const getDisplayName = (path: string, index: number): string => {
    // If it's a dynamic ID segment, get the display name based on parent route
    if (isId(path)) {
      const parentPath = index > 0 ? pathNames[index - 1] : '';
      return getDynamicRouteDisplayName(parentPath);
    }
    return formatSegment(path);
  };

  const handleMenuItemClick = (href: string) => {
    router.push(href);
    handleMenuClose();
  };

  // Function to generate the breadcrumb items
  const generateBreadcrumbs = (pathNames: string[]) => {
    const breadcrumbs = pathNames.map((path, index) => {
      const isLast = index === pathNames.length - 1;
      const isNonClickable =
        nonClickableSegments.includes(path) ||
        PATHS_WITHOUT_PAGE.has(getHref(path, index, pathNames));

      return (
        <Chip
          key={path}
          size="small"
          label={getDisplayName(path, index)}
          onClick={
            isNonClickable || isLast
              ? undefined
              : () => router.push(getHref(path, index, pathNames))
          }
          color={isLast ? 'secondary' : 'default'}
          sx={{
            maxWidth: 150,
            '& .MuiChip-label': {
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            },
          }}
        />
      );
    });

    if (minimized) {
      return breadcrumbs.length > 1
        ? [
            <Chip
              key="more"
              size="small"
              label={<Icons.more size="1rem" />}
              onClick={(e) => setAnchorEl(e ? e.currentTarget : null)}
            />,
            breadcrumbs[breadcrumbs.length - 1],
          ]
        : breadcrumbs;
    }

    return [
      <Chip
        key="home"
        size="small"
        label={'Home'}
        onClick={() => router.push('/')}
        icon={<Icons.home size="1rem" />}
      />,
      ...breadcrumbs,
    ];
  };

  return (
    <>
      <Menu anchorEl={anchorEl} open={open && minimized} onClose={handleMenuClose}>
        {pathNames.map((path, index) => {
          if (index === pathNames.length - 1) return null;
          return (
            <MenuItem
              key={path}
              disabled={
                nonClickableSegments.includes(path) ||
                PATHS_WITHOUT_PAGE.has(getHref(path, index, pathNames))
              }
              onClick={() => handleMenuItemClick(getHref(path, index, pathNames))}
            >
              {getDisplayName(path, index)}
            </MenuItem>
          );
        })}
      </Menu>
      <Breadcrumbs
        separator={
          <Box component="span" sx={{ display: 'flex', color: 'text.primary' }}>
            <Icons.chevronRight size="1.25rem" />
          </Box>
        }
        maxItems={4}
        sx={{
          // Gives way to the account chip beside it rather than pushing it off a phone's edge.
          minWidth: 0,
          overflow: 'hidden',
          '& .MuiBreadcrumbs-ol': {
            alignItems: 'center',
            flexWrap: 'nowrap',
          },
          '& .MuiBreadcrumbs-li': {
            display: 'flex',
            alignItems: 'center',
          },
        }}
      >
        {generateBreadcrumbs(pathNames)}
      </Breadcrumbs>
    </>
  );
}
