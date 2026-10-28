'use client';

import { useMemo } from 'react';
import { Reorder, useDragControls } from 'motion/react';
import { Box, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import FaqItem from '@/components/common/help/FaqItem';
import { FaqResponse } from '@/lib/dtos/response/faq.res';
import { Icons } from '@/lib/icons';

interface FaqSectionsListProps {
  /** Current order to render — controlled by the page (server data when clean, local when dirty) */
  items: FaqResponse[];
  canManage: boolean;
  /** Fired with the new flat order whenever the admin drags. Page decides what to do with it. */
  onItemsChange?: (next: FaqResponse[]) => void;
  onEdit?: (faq: FaqResponse) => void;
  onDelete?: (faq: FaqResponse) => void;
}

interface Section {
  name: string;
  items: FaqResponse[];
}

function groupByCategory(flat: FaqResponse[]): Section[] {
  const map = new Map<string, FaqResponse[]>();
  for (const faq of flat) {
    const key = faq.category || 'General';
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(faq);
  }
  return Array.from(map.entries()).map(([name, items]) => ({ name, items }));
}

export default function FaqSectionsList({
  items,
  canManage,
  onItemsChange,
  onEdit,
  onDelete,
}: FaqSectionsListProps) {
  const sections = useMemo(() => groupByCategory(items), [items]);

  const handleCategoryReorder = (newCategoryNames: string[]) => {
    const bySection = new Map(sections.map((s) => [s.name, s.items]));
    const next = newCategoryNames.flatMap((name) => bySection.get(name) ?? []);
    onItemsChange?.(next);
  };

  const handleItemsReorder = (categoryName: string, newItems: FaqResponse[]) => {
    const next = sections.flatMap((s) => (s.name === categoryName ? newItems : s.items));
    onItemsChange?.(next);
  };

  if (!canManage) {
    return (
      <Stack spacing={{ xs: 6, md: 10 }}>
        {sections.map((section) => (
          <SectionRow key={section.name} name={section.name}>
            {section.items.map((faq) => (
              <FaqItem key={faq.id} faq={faq} canManage={false} />
            ))}
          </SectionRow>
        ))}
      </Stack>
    );
  }

  const categoryNames = sections.map((s) => s.name);

  return (
    <Reorder.Group
      axis="y"
      values={categoryNames}
      onReorder={handleCategoryReorder}
      style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', rowGap: 80 }}
    >
      {sections.map((section) => (
        <CategoryReorderItem
          key={section.name}
          section={section}
          onItemsReorder={(newItems) => handleItemsReorder(section.name, newItems)}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      ))}
    </Reorder.Group>
  );
}

interface SectionRowProps {
  name: string;
  dragHandle?: React.ReactNode;
  children: React.ReactNode;
}

function SectionRow({ name, dragHandle, children }: SectionRowProps) {
  return (
    <Box>
      <Stack
        direction="row"
        spacing={1}
        sx={{
          alignItems: 'center',
          mb: 2,
        }}
      >
        {dragHandle}
        <Typography
          variant="h4"
          component="h2"
          sx={{
            fontWeight: 700,
            fontSize: { xs: '1.5rem', md: '1.75rem' },
            letterSpacing: '-0.02em',
            lineHeight: 1.2,
          }}
        >
          {name}
        </Typography>
      </Stack>

      <Box sx={{ minWidth: 0, pl: { xs: 2, md: 5 } }}>{children}</Box>
    </Box>
  );
}

interface CategoryReorderItemProps {
  section: Section;
  onItemsReorder: (newItems: FaqResponse[]) => void;
  onEdit?: (faq: FaqResponse) => void;
  onDelete?: (faq: FaqResponse) => void;
}

function CategoryReorderItem({
  section,
  onItemsReorder,
  onEdit,
  onDelete,
}: CategoryReorderItemProps) {
  const controls = useDragControls();

  const dragHandle = (
    <Tooltip title="Drag category" placement="left">
      <IconButton
        size="small"
        onPointerDown={(e) => controls.start(e)}
        sx={{
          cursor: 'grab',
          touchAction: 'none',
          color: 'text.secondary',
          '&:active': { cursor: 'grabbing' },
        }}
      >
        <Icons.dragHandle />
      </IconButton>
    </Tooltip>
  );

  return (
    <Reorder.Item
      value={section.name}
      dragListener={false}
      dragControls={controls}
      style={{ listStyle: 'none' }}
    >
      <SectionRow name={section.name} dragHandle={dragHandle}>
        <Reorder.Group
          axis="y"
          values={section.items}
          onReorder={onItemsReorder}
          style={{ listStyle: 'none', padding: 0, margin: 0 }}
        >
          {section.items.map((faq) => (
            <ItemReorderRow key={faq.id} faq={faq} onEdit={onEdit} onDelete={onDelete} />
          ))}
        </Reorder.Group>
      </SectionRow>
    </Reorder.Item>
  );
}

interface ItemReorderRowProps {
  faq: FaqResponse;
  onEdit?: (faq: FaqResponse) => void;
  onDelete?: (faq: FaqResponse) => void;
}

function ItemReorderRow({ faq, onEdit, onDelete }: ItemReorderRowProps) {
  const controls = useDragControls();

  return (
    <Reorder.Item
      value={faq}
      dragListener={false}
      dragControls={controls}
      style={{ listStyle: 'none' }}
    >
      <Box sx={{ position: 'relative' }}>
        <Tooltip title="Drag question" placement="left">
          <IconButton
            size="small"
            onPointerDown={(e) => controls.start(e)}
            sx={{
              position: 'absolute',
              left: -36,
              top: '50%',
              transform: 'translateY(-50%)',
              cursor: 'grab',
              touchAction: 'none',
              color: 'text.secondary',
              '&:active': { cursor: 'grabbing' },
              display: { xs: 'none', md: 'inline-flex' },
            }}
          >
            <Icons.dragHandle />
          </IconButton>
        </Tooltip>
        <FaqItem faq={faq} canManage onEdit={onEdit} onDelete={onDelete} />
      </Box>
    </Reorder.Item>
  );
}
