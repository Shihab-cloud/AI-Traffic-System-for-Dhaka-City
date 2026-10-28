'use client';

import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogContent,
  IconButton,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { Icons } from '@/lib/icons';
import trafficService, { type PayRequest, type PayResult } from '@/lib/services/traffic.service';
import type { TrafficCase } from '@/lib/types/traffic.types';
import { apiErrorMessage } from '@/lib/utils/common.util';
import { money } from './format';

type Method = PayRequest['method'];
const WALLETS: Record<Exclude<Method, 'card'>, { name: string; color: string }> = {
  bkash: { name: 'bKash', color: '#e2136e' },
  nagad: { name: 'Nagad', color: '#f6921e' },
  rocket: { name: 'Rocket', color: '#8c3494' },
};

/** "4242424242424242" -> "4242 4242 4242 4242" */
const groupCard = (v: string) =>
  v
    .replace(/\D/g, '')
    .slice(0, 19)
    .replace(/(\d{4})(?=\d)/g, '$1 ');
const formatExpiry = (v: string) => {
  const d = v.replace(/\D/g, '').slice(0, 4);
  return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
};

/** SSLCommerz's colours, for its tab. */
const SSL_COLOR = '#0b5ea8';

/**
 * The payment pop-up. Online: SSLCommerz, Bangladesh's gateway (card, bKash, Nagad, Rocket, internet banking on its
 * own page; the browser comes back to the case page). Test: the built-in gateway (test card / wallet details, no money).
 */
export default function PaymentDialog({
  trafficCase,
  open,
  onClose,
  onPaid,
}: {
  trafficCase: TrafficCase;
  open: boolean;
  onClose: () => void;
  onPaid: (r: PayResult) => void;
}) {
  const gateway = useQuery({
    queryKey: ['traffic.payGateway'],
    queryFn: () => trafficService.paymentGateway(),
    staleTime: 60_000,
  });
  const [modeChoice, setMode] = useState<'online' | 'test' | null>(null);
  // Online when the backend has SSLCommerz set up, until the payer picks the test gateway.
  const mode = modeChoice ?? (gateway.data?.online ? 'online' : 'test');
  const online = useMutation({
    mutationFn: () => trafficService.payOnline(trafficCase.id),
    onSuccess: (r) => window.location.assign(r.url), // SSLCommerz's page; it sends the browser back to this case
  });
  const [method, setMethod] = useState<Method>('card');
  const [card, setCard] = useState({ number: '', expiry: '', cvc: '', name: '' });
  const [wallet, setWallet] = useState({ number: '', pin: '' });
  const [result, setResult] = useState<PayResult | null>(null);

  const pay = useMutation({
    mutationFn: () =>
      trafficService.pay(
        trafficCase.id,
        method === 'card'
          ? {
              method,
              cardNumber: card.number,
              cardExpiry: card.expiry,
              cardCvc: card.cvc,
              cardName: card.name,
            }
          : { method, walletNumber: wallet.number, walletPin: wallet.pin },
      ),
    onSuccess: (r) => {
      setResult(r);
      if (r.status === 'succeeded') onPaid(r);
    },
  });
  const failed = pay.isError
    ? apiErrorMessage(pay.error, 'Payment failed')
    : result?.status === 'failed'
      ? result.reason
      : null;
  const brand =
    mode === 'online'
      ? { name: 'SSLCommerz', color: SSL_COLOR }
      : method === 'card'
        ? { name: 'Card', color: '#1a3a6b' }
        : WALLETS[method];
  const busy = pay.isPending || online.isPending || online.isSuccess;
  const ready =
    method === 'card'
      ? card.number.replace(/\D/g, '').length >= 12 &&
        card.expiry.length >= 4 &&
        card.cvc.length >= 3
      : wallet.number.replace(/\D/g, '').length === 11 && wallet.pin.length >= 4;

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="xs" fullWidth>
      <Box
        sx={{
          bgcolor: brand.color,
          color: '#fff',
          px: 3,
          py: 2,
          position: 'relative',
          transition: 'background-color .2s',
        }}
      >
        <Typography variant="overline" sx={{ opacity: 0.85 }}>
          {mode === 'online'
            ? `Secure payment · SSLCommerz${gateway.data?.sandbox ? ' sandbox' : ''}`
            : 'Test payment · no money moves'}
        </Typography>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>
          {money(trafficCase.amount, trafficCase.currency)}
        </Typography>
        <Typography variant="body2" sx={{ opacity: 0.9 }}>
          Fine for case {trafficCase.caseNumber} · {trafficCase.registration}
        </Typography>
        {!busy && (
          <IconButton
            onClick={onClose}
            sx={{ position: 'absolute', top: 8, right: 8, color: '#fff' }}
            aria-label="Close"
          >
            <Icons.close />
          </IconButton>
        )}
      </Box>
      <DialogContent>
        {result?.status === 'succeeded' ? (
          <Stack spacing={2} sx={{ alignItems: 'center', textAlign: 'center', py: 2 }}>
            <Box
              sx={{
                width: 64,
                height: 64,
                borderRadius: '50%',
                bgcolor: 'success.main',
                color: '#fff',
                display: 'grid',
                placeItems: 'center',
                fontSize: 34,
              }}
            >
              <Icons.check />
            </Box>
            <Typography variant="h6">Payment successful</Typography>
            <Typography variant="body2" color="text.secondary">
              Invoice <b>{result.invoiceNumber}</b> · transaction {result.transactionId}
            </Typography>
            <Typography variant="body2">
              {result.emailedTo
                ? `The invoice was emailed to ${result.emailedTo}.`
                : 'The invoice email could not be sent; download it below.'}
            </Typography>
            <Stack direction="row" spacing={1}>
              {result.paymentId && (
                <Button
                  variant="outlined"
                  startIcon={<Icons.download />}
                  onClick={() => trafficService.myInvoice(result.paymentId!)}
                >
                  Download invoice
                </Button>
              )}
              <Button variant="contained" onClick={onClose}>
                Done
              </Button>
            </Stack>
          </Stack>
        ) : (
          <Stack spacing={2} sx={{ pt: 1 }}>
            {gateway.data?.online && (
              <Tabs value={mode} onChange={(_, v) => setMode(v)} variant="fullWidth">
                <Tab value="online" label="Online (SSLCommerz)" />
                <Tab value="test" label="Test payment" />
              </Tabs>
            )}
            {mode === 'online' ? (
              <Stack spacing={2}>
                <Typography variant="body2">
                  You pay on SSLCommerz&apos;s secure page: card (Visa, Mastercard, Amex), bKash,
                  Nagad, Rocket or internet banking. When it is done you come back here, and the
                  invoice is emailed to you.
                </Typography>
                {gateway.data?.sandbox && (
                  <Alert severity="info">
                    SSLCommerz sandbox: no real money. Use the test card or test mobile-banking
                    details shown on its page.
                  </Alert>
                )}
                {online.isError && (
                  <Alert severity="error">
                    {apiErrorMessage(online.error, 'Could not open SSLCommerz')}
                  </Alert>
                )}
                <Button
                  variant="contained"
                  size="large"
                  disabled={busy}
                  onClick={() => online.mutate()}
                  sx={{
                    bgcolor: SSL_COLOR,
                    '&:hover': { bgcolor: SSL_COLOR, filter: 'brightness(.92)' },
                  }}
                  startIcon={busy ? <CircularProgress size={18} color="inherit" /> : <Icons.lock />}
                >
                  {busy
                    ? 'Opening SSLCommerz...'
                    : `Pay ${money(trafficCase.amount, trafficCase.currency)} with SSLCommerz`}
                </Button>
              </Stack>
            ) : (
              <>
                <Tabs value={method} onChange={(_, v) => setMethod(v)} variant="fullWidth">
                  <Tab value="card" label="Card" />
                  {Object.entries(WALLETS).map(([k, w]) => (
                    <Tab key={k} value={k} label={w.name} />
                  ))}
                </Tabs>
                {method === 'card' ? (
                  <Stack spacing={1.5}>
                    <TextField
                      label="Card number"
                      value={card.number}
                      onChange={(e) => setCard({ ...card, number: groupCard(e.target.value) })}
                      inputMode="numeric"
                      autoComplete="cc-number"
                      placeholder="4242 4242 4242 4242"
                    />
                    <Stack direction="row" spacing={1.5}>
                      <TextField
                        label="Expiry (MM/YY)"
                        value={card.expiry}
                        onChange={(e) => setCard({ ...card, expiry: formatExpiry(e.target.value) })}
                        autoComplete="cc-exp"
                        placeholder="12/29"
                        fullWidth
                      />
                      <TextField
                        label="CVC"
                        value={card.cvc}
                        onChange={(e) =>
                          setCard({ ...card, cvc: e.target.value.replace(/\D/g, '').slice(0, 4) })
                        }
                        autoComplete="cc-csc"
                        fullWidth
                      />
                    </Stack>
                    <TextField
                      label="Name on card"
                      value={card.name}
                      onChange={(e) => setCard({ ...card, name: e.target.value })}
                      autoComplete="cc-name"
                    />
                  </Stack>
                ) : (
                  <Stack spacing={1.5}>
                    <TextField
                      label={`${WALLETS[method].name} account number`}
                      value={wallet.number}
                      onChange={(e) =>
                        setWallet({
                          ...wallet,
                          number: e.target.value.replace(/\D/g, '').slice(0, 11),
                        })
                      }
                      placeholder="01XXXXXXXXX"
                      inputMode="numeric"
                    />
                    <TextField
                      label="PIN"
                      type="password"
                      value={wallet.pin}
                      onChange={(e) =>
                        setWallet({ ...wallet, pin: e.target.value.replace(/\D/g, '').slice(0, 5) })
                      }
                      inputMode="numeric"
                    />
                  </Stack>
                )}
                {failed && <Alert severity="error">{failed}</Alert>}
                <Button
                  variant="contained"
                  size="large"
                  disabled={!ready || pay.isPending}
                  onClick={() => pay.mutate()}
                  sx={{
                    bgcolor: brand.color,
                    '&:hover': { bgcolor: brand.color, filter: 'brightness(.92)' },
                  }}
                  startIcon={
                    pay.isPending ? <CircularProgress size={18} color="inherit" /> : <Icons.lock />
                  }
                >
                  {pay.isPending
                    ? 'Processing...'
                    : `Pay ${money(trafficCase.amount, trafficCase.currency)}`}
                </Button>
                <Typography variant="caption" color="text.secondary">
                  Test gateway: no money moves. Cards: any valid number (e.g. 4242 4242 4242 4242)
                  succeeds; 4000 0000 0000 0002 is declined. Wallets: any 01XXXXXXXXX number with a
                  4-5 digit PIN (0000 is a wrong PIN).
                </Typography>
              </>
            )}
          </Stack>
        )}
      </DialogContent>
    </Dialog>
  );
}
