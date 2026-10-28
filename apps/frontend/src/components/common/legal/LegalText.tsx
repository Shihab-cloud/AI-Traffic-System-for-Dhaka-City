import { Box, Typography } from '@mui/material';
import type { ReactNode } from 'react';

/*
 * The building blocks of a legal page's text. Deliberately not a client module: the pages are
 * server components, and a list mapped here gets its keys on the server — handed to a client
 * component as an array of elements instead, React would warn that the list has no keys.
 */

/** A paragraph of legal text, at a line height made for reading at length. */
export function LegalParagraph({ children }: { children: ReactNode }) {
  return (
    <Typography variant="body1" sx={{ lineHeight: 1.75, color: 'text.primary' }}>
      {children}
    </Typography>
  );
}

/** A bulleted list inside a section. */
export function LegalList({ items }: { items: ReactNode[] }) {
  return (
    // `listStyle` restated: the CSS reset strips bullets, and without them items read as paragraphs.
    <Box component="ul" sx={{ pl: 3, m: 0, display: 'grid', gap: 1, listStyle: 'disc' }}>
      {items.map((item, index) => (
        <Typography key={index} component="li" variant="body1" sx={{ lineHeight: 1.75 }}>
          {item}
        </Typography>
      ))}
    </Box>
  );
}
