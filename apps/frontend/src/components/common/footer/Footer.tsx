import { Box, Link, Typography } from '@mui/material';

import NextLink from 'next/link';

import { RouteUrls } from '@/lib/routes/route.config';

function Footer() {
  // Read at render, not written into the markup: a hardcoded year is wrong from the first of
  // January, on every page at once.
  const year = new Date().getFullYear();

  return (
    <footer className="mt-auto w-full">
      <Box
        className="flex flex-col justify-between gap-2 px-4 py-4 md:flex-row md:items-center md:px-6"
        sx={{
          borderTop: 1,
          borderColor: 'divider',
          bgcolor: 'background.paper',
        }}
      >
        <div className="ml-auto flex flex-col gap-2">
          <Typography variant="body2" color={'text.secondary'}>
            © {year} Dhaka Traffic Enforcement. All rights reserved.
          </Typography>

          <div className="ml-auto flex items-center gap-4">
            {/* Through the route constants: a hardcoded `/terms-and-conditions` led to a 404. */}
            <Link
              variant="body2"
              component={NextLink}
              color="text.primary"
              href={RouteUrls.privacyPolicy}
            >
              Privacy Policy
            </Link>
            <Link variant="body2" color="text.primary" component={NextLink} href={RouteUrls.terms}>
              Terms & Conditions
            </Link>
          </div>
        </div>
      </Box>
    </footer>
  );
}

export default Footer;
