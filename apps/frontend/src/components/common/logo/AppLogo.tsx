import { RouteUrls } from '@/lib/routes/route.config';
import { Collapse, Typography } from '@mui/material';
import Link from 'next/link';
import { BrandMarks } from '@/lib/icons';

interface AppLogoProps {
  size?: number;
  iconOnly?: boolean;
}

export default function AppLogo({ size = 28, iconOnly = false }: AppLogoProps) {
  return (
    <Link href={RouteUrls.root} className="flex items-center">
      <BrandMarks.app size={size} color="inherit" />
      <Collapse in={!iconOnly} orientation="horizontal">
        <Typography
          style={{ fontSize: size * 0.8 }}
          sx={{
            fontWeight: 'bold',
            pl: 1.5,
            color: 'text.primary',
            whiteSpace: 'nowrap',
          }}
        >
          Dhaka Traffic
        </Typography>
      </Collapse>
    </Link>
  );
}
