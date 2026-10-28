'use client';

import { Box, Dialog, IconButton, Typography } from '@mui/material';
import { useState } from 'react';

import { Icons } from '@/lib/icons';
import type { EvidenceImage } from '@/lib/types/traffic.types';

const ORDER = ['scene', 'closeup', 'plate', 'plate_vehicle', 'stopped'];
const rank = (kind: string) => (ORDER.includes(kind) ? ORDER.indexOf(kind) : ORDER.length);

/** The violation moment: the scene large, the other images (close-up, plate, ...) as thumbnails. Click to zoom. */
export default function EvidenceGallery({ images, height = 300 }: { images: EvidenceImage[]; height?: number }) {
  const sorted = [...images].filter((i) => i.url).sort((a, b) => rank(a.kind) - rank(b.kind));
  const [active, setActive] = useState(0);
  const [zoom, setZoom] = useState<EvidenceImage | null>(null);
  if (!sorted.length) {
    return (
      <Box sx={{ height, display: 'grid', placeItems: 'center', bgcolor: 'action.hover', borderRadius: 2 }}>
        <Typography color="text.secondary">No evidence images</Typography>
      </Box>
    );
  }
  const main = sorted[Math.min(active, sorted.length - 1)];
  return (
    <Box>
      <Box
        component="img"
        src={main.url}
        alt={main.caption || main.kind}
        onClick={() => setZoom(main)}
        sx={{
          width: '100%',
          height,
          objectFit: 'contain',
          bgcolor: '#0b0f14',
          borderRadius: 2,
          cursor: 'zoom-in',
          display: 'block',
        }}
      />
      <Box sx={{ display: 'flex', gap: 1, mt: 1, overflowX: 'auto' }}>
        {sorted.map((img, i) => (
          <Box
            key={img.key}
            onClick={() => setActive(i)}
            sx={{
              flex: '0 0 auto',
              cursor: 'pointer',
              border: 2,
              borderColor: i === active ? 'primary.main' : 'transparent',
              borderRadius: 1.5,
              overflow: 'hidden',
              textAlign: 'center',
            }}
          >
            <Box
              component="img"
              src={img.url}
              alt={img.caption || img.kind}
              sx={{ height: 64, width: 'auto', maxWidth: 140, display: 'block', bgcolor: '#0b0f14', objectFit: 'contain' }}
            />
            <Typography variant="caption" sx={{ px: 0.5 }} color="text.secondary">
              {img.caption || img.kind}
            </Typography>
          </Box>
        ))}
      </Box>
      <Dialog open={!!zoom} onClose={() => setZoom(null)} maxWidth="xl">
        {zoom && (
          <Box sx={{ position: 'relative', bgcolor: '#0b0f14' }}>
            <IconButton
              onClick={() => setZoom(null)}
              sx={{ position: 'absolute', top: 8, right: 8, color: '#fff', bgcolor: 'rgba(0,0,0,.4)' }}
              aria-label="Close"
            >
              <Icons.close />
            </IconButton>
            <Box component="img" src={zoom.url} alt={zoom.caption} sx={{ maxWidth: '92vw', maxHeight: '88vh', display: 'block' }} />
          </Box>
        )}
      </Dialog>
    </Box>
  );
}
