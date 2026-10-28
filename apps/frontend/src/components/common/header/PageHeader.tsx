import { Box, Button, Typography } from '@mui/material';
import React, { useEffect, useRef, useState } from 'react';

import { useScrollContainer } from '@/components/common/navigation/drawerLayout/ScrollContainerContext';
import { CONTENT_WIDTH, PAGE_GUTTER, type ContentWidth } from '@/lib/constants/content-layout';
import Link from 'next/link';
import { Icons, type IconType } from '@/lib/icons';

function useScrollCompact(container: HTMLElement | null, threshold = 80) {
  const [compact, setCompact] = useState(false);
  const compactRef = useRef(false);

  useEffect(() => {
    if (!container) return;
    const handleScroll = () => {
      const top = container.scrollTop;
      if (!compactRef.current && top > threshold) {
        compactRef.current = true;
        setCompact(true);
      } else if (compactRef.current && top <= 4) {
        compactRef.current = false;
        setCompact(false);
      }
    };
    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [container, threshold]);

  return compact;
}

interface PageHeaderProps {
  title: React.ReactNode;
  /** Shown below the title in full mode. Hidden in compact mode. */
  subtitle?: React.ReactNode;
  /** Icon rendered in a coloured square beside the title. Hidden in compact mode. */
  icon?: IconType;
  /** Content rendered on the right side of the header (e.g. action buttons). */
  rightSlot?: React.ReactNode;
  /** Renders a Back button navigating to this URL. Inline with the title in compact mode, above the title row in full mode. */
  backUrl?: string;
  /** Force compact mode permanently — no icon, no subtitle, reduced padding. Use on detail pages where the title is dynamic. */
  compact?: boolean;
  /** Automatically collapse to compact after scrolling some ammount, restore when scrolled back to the top. On by default. */
  scrollCompact?: boolean;
  /**
   * The width of the page's body, when it is a centred column narrower than the page — the same
   * value its `PageBody` takes, so the title sits over the content. Full width by default.
   */
  width?: ContentWidth;
}

export default function PageHeader({
  title,
  subtitle,
  icon: IconComponent,
  rightSlot,
  backUrl,
  compact: forceCompact = false,
  scrollCompact = true,
  width = 'full',
}: PageHeaderProps) {
  const scrollContainer = useScrollContainer();
  const scrolled = useScrollCompact(scrollCompact ? scrollContainer : null, 150);
  const isCompact = forceCompact || scrolled;

  return (
    <Box
      className={PAGE_GUTTER}
      sx={{
        position: 'sticky',
        top: 0,
        zIndex: 'appBar',
        bgcolor: 'background.paper',
        borderBottom: 1,
        borderColor: 'divider',
        transition: 'padding 0.2s ease',
        py: isCompact ? 2 : 4,
      }}
    >
      {isCompact ? (
        <div className={`mx-auto flex w-full items-center gap-3 ${CONTENT_WIDTH[width]}`}>
          {backUrl && (
            <Button
              component={Link}
              variant="text"
              sx={{ borderRadius: 9999 }}
              href={backUrl}
              startIcon={<Icons.back size={16} />}
            >
              Back
            </Button>
          )}
          <Typography
            variant="body1"
            component={'span'}
            sx={{
              fontWeight: 700,
              mr: 'auto',
            }}
          >
            {title}
          </Typography>
          {/* Never squeezed: a wrapped button label reads as two buttons. The title wraps instead. */}
          {rightSlot && (
            <Box sx={{ flexShrink: 0, '& .MuiButton-root': { whiteSpace: 'nowrap' } }}>
              {rightSlot}
            </Box>
          )}
        </div>
      ) : (
        <div className={`mx-auto flex w-full flex-col gap-3 ${CONTENT_WIDTH[width]}`}>
          {backUrl && (
            <Button
              component={Link}
              variant="text"
              sx={{ borderRadius: 9999, width: 'fit-content' }}
              href={backUrl}
              startIcon={<Icons.back size={16} />}
            >
              Back
            </Button>
          )}

          <div className="flex flex-col items-start gap-4 lg:flex-row lg:items-center">
            <div className="mr-auto flex items-center gap-3">
              {IconComponent && (
                <Box
                  sx={{
                    // On a phone the badge costs the subtitle a third of its width.
                    display: { xs: 'none', sm: 'flex' },
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 54,
                    height: 54,
                    borderRadius: 2,
                    bgcolor: 'primary.main',
                    color: 'primary.contrastText',
                    flexShrink: 0,
                  }}
                >
                  <IconComponent size={26} />
                </Box>
              )}
              <div className="flex flex-col gap-1">
                <Typography
                  variant="h4"
                  component="span"
                  sx={{
                    fontWeight: 600,
                    fontSize: { xs: '1.5rem', md: '2rem' },
                  }}
                >
                  {title}
                </Typography>

                {subtitle && (
                  <Typography variant="subtitle2" component="span" color="text.secondary">
                    {subtitle}
                  </Typography>
                )}
              </div>
            </div>

            {rightSlot && <Box sx={{ flexShrink: 0 }}>{rightSlot}</Box>}
          </div>
        </div>
      )}
    </Box>
  );
}
