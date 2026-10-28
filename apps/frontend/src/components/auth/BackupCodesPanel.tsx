'use client';

import { Alert, Box, Button, Paper, Stack, Typography } from '@mui/material';

import toast from 'react-hot-toast';
import { Icons } from '@/lib/icons';

interface Props {
  codes: string[];
  /** Title at top of panel. Defaults to "Save your backup codes". */
  title?: string;
}

/**
 * Displays a generated backup-code set ONCE. Codes are not refetchable; the
 * user must copy or download. Renders a strong "save now" warning.
 */
export default function BackupCodesPanel({ codes, title = 'Save your backup codes' }: Props) {
  const copyAll = async () => {
    await navigator.clipboard.writeText(codes.join('\n'));
    toast.success('Codes copied to clipboard');
  };

  const downloadTxt = () => {
    const blob = new Blob([codes.join('\n') + '\n'], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'backup-codes.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <Paper variant="outlined" sx={{ p: 3 }}>
      <Stack spacing={2}>
        <Typography variant="h6">{title}</Typography>
        <Alert severity="warning">
          These codes are shown <b>only once</b>. Store them somewhere safe — a password manager or
          printed offline. Each code can be used a single time to sign in if you lose access to your
          authenticator.
        </Alert>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr 1fr', sm: '1fr 1fr 1fr' },
            gap: 1,
            fontFamily: 'monospace',
            backgroundColor: 'background.default',
            padding: 2,
            borderRadius: 1,
          }}
        >
          {codes.map((code) => (
            <Typography key={code} variant="body2" sx={{ fontFamily: 'monospace' }}>
              {code}
            </Typography>
          ))}
        </Box>
        <Stack direction="row" spacing={1}>
          <Button startIcon={<Icons.copy />} variant="outlined" onClick={copyAll}>
            Copy all
          </Button>
          <Button startIcon={<Icons.download />} variant="outlined" onClick={downloadTxt}>
            Download
          </Button>
        </Stack>
      </Stack>
    </Paper>
  );
}
