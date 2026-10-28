import { Collapse, List, Typography } from '@mui/material';

import NavigationItem from './NavigationItem';
import { SidebarGroup } from '@/lib/routes/index.routes';

interface NavigationListProps {
  item: SidebarGroup;
  compact?: boolean;
}

export default function NavigationList({ item, compact }: NavigationListProps) {
  return (
    <List
      disablePadding
      component="nav"
      dense
      subheader={
        item.header ? (
          <Collapse in={!compact}>
            <Typography
              variant="caption"
              sx={{
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: 1.2,
                fontSize: 11,
                ml: 1.5,
                py: 0.75,
                display: 'block',
                color: (theme) => theme.custom.sidebar.navSectionLabel,
              }}
            >
              {item.header}
            </Typography>
          </Collapse>
        ) : undefined
      }
    >
      {item.items.map((navItem) => (
        <NavigationItem key={navItem.text} item={navItem} compact={compact} />
      ))}
    </List>
  );
}
