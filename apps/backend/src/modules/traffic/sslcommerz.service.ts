import { BadGatewayException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** What SSLCommerz's validation API says about a payment (the fields used here). */
export type SslValidation = {
  status: string;
  tran_id?: string;
  amount?: string;
  currency?: string;
  card_type?: string;
  card_no?: string;
  bank_tran_id?: string;
  error?: string;
};

/**
 * SSLCommerz, Bangladesh's payment gateway (cards, bKash, Nagad, Rocket, internet banking in one checkout page).
 * `start` opens a checkout session (Initiate Payment API v4); the payer pays on SSLCommerz's page, which then posts
 * back to our success / fail / cancel URLs; `validate` asks SSLCommerz (Order Validation API) whether a payment is
 * real before a case is marked paid. Sandbox unless SSLCOMMERZ_LIVE=true. apps/backend/.env: SSLCOMMERZ_STORE_ID,
 * SSLCOMMERZ_STORE_PASSWORD (a sandbox store from https://developer.sslcommerz.com/registration/).
 */
@Injectable()
export class SslcommerzService {
  private readonly storeId: string;
  private readonly storePassword: string;
  readonly live: boolean;
  private readonly host: string;

  constructor(config: ConfigService) {
    this.storeId = config.get<string>('SSLCOMMERZ_STORE_ID') ?? '';
    this.storePassword = config.get<string>('SSLCOMMERZ_STORE_PASSWORD') ?? '';
    this.live = config.get<string>('SSLCOMMERZ_LIVE') === 'true';
    this.host = this.live ? 'https://securepay.sslcommerz.com' : 'https://sandbox.sslcommerz.com';
  }

  get enabled() {
    return !!(this.storeId && this.storePassword);
  }

  /** Opens a checkout session; returns the page to send the payer to. */
  async start(fields: Record<string, string | number>): Promise<string> {
    if (!this.enabled) throw new ServiceUnavailableException('Online payment is not set up (SSLCOMMERZ_STORE_ID)');
    const body = new URLSearchParams({ store_id: this.storeId, store_passwd: this.storePassword });
    for (const [k, v] of Object.entries(fields)) body.set(k, String(v));
    const res = await fetch(`${this.host}/gwprocess/v4/api.php`, { method: 'POST', body, signal: AbortSignal.timeout(30_000) })
      .catch(() => {
        throw new BadGatewayException('SSLCommerz could not be reached: try again in a minute');
      });
    const r = (await res.json().catch(() => ({}))) as { status?: string; failedreason?: string; GatewayPageURL?: string };
    if (r.status !== 'SUCCESS' || !r.GatewayPageURL) {
      throw new BadGatewayException(`SSLCommerz did not open the payment: ${r.failedreason || r.status || res.status}`);
    }
    return r.GatewayPageURL;
  }

  /** SSLCommerz's own word on a payment (status VALID or VALIDATED = paid). */
  async validate(valId: string): Promise<SslValidation> {
    const q = new URLSearchParams({ val_id: valId, store_id: this.storeId, store_passwd: this.storePassword, format: 'json' });
    const res = await fetch(`${this.host}/validator/api/validationserverAPI.php?${q}`, { signal: AbortSignal.timeout(30_000) });
    return (await res.json()) as SslValidation;
  }
}
