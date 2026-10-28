'use client';

import { Collapse, IconButton, Paper, Typography } from '@mui/material';
import { formatDistanceToNow } from 'date-fns';
import { useState } from 'react';
import { twMerge } from 'tailwind-merge';
import LogWrapper, { LogWrapperProps } from './LogWrapper';
import { Icons } from '@/lib/icons';

export interface CollapsibleLogWrapperProps extends LogWrapperProps {
  opened?: boolean;
  title: React.ReactNode;
  timestamp?: string | Date;
}

export default function CollapsibleLogWrapper({
  opened = false,
  title,
  timestamp,
  children,
  ...props
}: CollapsibleLogWrapperProps) {
  const hasContent = Boolean(children);
  const [expanded, setExpanded] = useState(opened && hasContent);

  return (
    <LogWrapper {...props}>
      <Paper
        variant="outlined"
        sx={{
          display: 'flex',
          flexDirection: 'column',
          p: 1,
          pl: 2,
          width: '100%',
          overflow: 'hidden',
        }}
      >
        <div className="flex items-center">
          <Typography variant="body2" component="div" className="flex-1">
            {title}
          </Typography>

          <Typography
            variant="body2"
            color="text.secondary"
            component="div"
            className="whitespace-nowrap"
            sx={{
              py: 1.5,
              px: 1,
            }}
          >
            {timestamp ? formatDistanceToNow(new Date(timestamp), { addSuffix: true }) : ''}
          </Typography>

          {hasContent && (
            <IconButton onClick={() => setExpanded(!expanded)} size="small">
              <Icons.expand
                className={twMerge(
                  'h-5 w-5 transform transition-transform',
                  expanded && 'rotate-180',
                )}
              />
            </IconButton>
          )}
        </div>
        <Collapse in={expanded}>
          <div className="pb-2">{children}</div>
        </Collapse>
      </Paper>
    </LogWrapper>
  );
}
