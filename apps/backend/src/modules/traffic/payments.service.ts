import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { randomBytes } from 'crypto';
import { HydratedDocument, Types } from 'mongoose';
import type { CurrentUser } from 'src/lib/decorators/user.decorator';
import { User, UserModel } from 'src/schemas/public/user.schema';
import { Payment, PaymentModel, PaymentStatusEnum } from 'src/schemas/traffic/payment.schema';
import { CaseStatusEnum, TrafficCase, TrafficCaseModel } from 'src/schemas/traffic/traffic-case.schema';
import { Vehicle, VehicleModel } from 'src/schemas/traffic/vehicle.schema';
import { Violation, ViolationModel } from 'src/schemas/traffic/violation.schema';
import { AuditService } from './audit.service';
import { CasesService } from './cases.service';
import type { ListQuery, PayRequest } from './dto/traffic.req';
import { EvidenceService } from './evidence.service';
import { InvoiceService } from './invoice.service';
import { SslcommerzService, type SslValidation } from './sslcommerz.service';
import { TrafficMailService } from './traffic-mail.service';
import { makeNumber, money, toPlain } from './traffic.util';

/** Test cards of the sandbox gateway (any other valid card number succeeds). */
const DECLINED_CARDS: Record<string, string> = {
  '4000000000000002': 'Card declined by the issuer',
  '4000000000009995': 'Insufficient funds',
};

function luhn(digits: string) {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) d = d * 2 > 9 ? d * 2 - 9 : d * 2;
    sum += d;
  }
  return sum % 10 === 0;
}

type GatewayResult = { ok: true; account: string } | { ok: false; account: string; reason: string };
/** How an SSLCommerz checkout ended, for the page the payer returns to. */
export type OnlineOutcome = { caseId: string | null; outcome: 'success' | 'failed' | 'cancelled' };

const str = (v: unknown) => (typeof v === 'string' ? v : '');

/**
 * Fine payments. Online through SSLCommerz (sslcommerz.service.ts: the payer pays on its page, we confirm the payment
 * with its validation API), or through the built-in test gateway (no money: validates card / mobile-wallet details
 * the way a gateway would). A successful payment marks the case paid, renders the invoice PDF, stores it in S3 and
 * emails it to the payer (`settle`).
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly backendUrl: string;

  constructor(
    @InjectModel(Payment.name) private readonly payments: PaymentModel,
    @InjectModel(TrafficCase.name) private readonly cases: TrafficCaseModel,
    @InjectModel(Violation.name) private readonly violations: ViolationModel,
    @InjectModel(Vehicle.name) private readonly vehicles: VehicleModel,
    @InjectModel(User.name) private readonly users: UserModel,
    private readonly casesService: CasesService,
    private readonly invoices: InvoiceService,
    private readonly evidence: EvidenceService,
    private readonly mail: TrafficMailService,
    private readonly audit: AuditService,
    private readonly sslcommerz: SslcommerzService,
    config: ConfigService,
  ) {
    this.backendUrl = (config.get<string>('BACKEND_URL') ?? 'http://localhost:5001').replace(/\/$/, '');
  }

  /** What the payment pop-up offers. */
  gateway() {
    return { online: this.sslcommerz.enabled, provider: 'SSLCommerz', sandbox: !this.sslcommerz.live };
  }

  private sandbox(dto: PayRequest): GatewayResult {
    if (dto.method === 'card') {
      const digits = (dto.cardNumber ?? '').replace(/\D/g, '');
      const account = digits ? `**** ${digits.slice(-4)}` : '';
      if (digits.length < 12 || digits.length > 19 || !luhn(digits)) return { ok: false, account, reason: 'Invalid card number' };
      const m = (dto.cardExpiry ?? '').match(/^(\d{2})\s*\/\s*(\d{2}|\d{4})$/);
      if (!m) return { ok: false, account, reason: 'Expiry must look like MM/YY' };
      const month = Number(m[1]);
      const year = Number(m[2].length === 2 ? `20${m[2]}` : m[2]);
      if (month < 1 || month > 12 || new Date(year, month, 1).getTime() <= Date.now()) {
        return { ok: false, account, reason: 'Card expired' };
      }
      if (!/^\d{3,4}$/.test(dto.cardCvc ?? '')) return { ok: false, account, reason: 'Invalid security code' };
      if (DECLINED_CARDS[digits]) return { ok: false, account, reason: DECLINED_CARDS[digits] };
      return { ok: true, account };
    }
    const wallet = (dto.walletNumber ?? '').replace(/\D/g, '');
    const account = wallet.length >= 6 ? `${wallet.slice(0, 3)}*****${wallet.slice(-3)}` : '';
    if (!/^01[3-9]\d{8}$/.test(wallet)) return { ok: false, account, reason: 'Enter an 11-digit mobile number (01XXXXXXXXX)' };
    if (!/^\d{4,5}$/.test(dto.walletPin ?? '')) return { ok: false, account, reason: 'PIN must be 4 or 5 digits' };
    if (dto.walletPin === '0000') return { ok: false, account, reason: 'Wrong PIN' };
    return { ok: true, account };
  }

  private async payable(user: CurrentUser, caseId: string) {
    const c = await this.casesService.assertOwner(user, caseId);
    if (c.status !== CaseStatusEnum.UNPAID) {
      throw new ConflictException(
        c.status === CaseStatusEnum.UNDER_REVIEW ? 'The case is under review: wait for the decision' : `The case is ${c.status}`,
      );
    }
    return c;
  }

  /** The built-in test gateway. */
  async pay(user: CurrentUser, caseId: string, dto: PayRequest) {
    const c = await this.payable(user, caseId);
    const me = await this.users.findById(user.id).lean();
    const result = this.sandbox(dto);
    const transactionId = `SBX${Date.now().toString(36).toUpperCase()}${randomBytes(3).toString('hex').toUpperCase()}`;
    const payment = await this.payments.create({
      caseId: c._id,
      caseNumber: c.caseNumber,
      userId: new Types.ObjectId(user.id),
      amount: c.amount,
      currency: c.currency,
      provider: 'sandbox',
      method: dto.method,
      account: result.account,
      transactionId,
      payerName: dto.payerName || dto.cardName || me?.name || c.ownerName,
      payerEmail: user.email ?? c.ownerEmail ?? '',
      status: result.ok ? PaymentStatusEnum.PENDING : PaymentStatusEnum.FAILED,
      failureReason: result.ok ? '' : result.reason,
    });
    if (!result.ok) return { status: 'failed', reason: result.reason, transactionId };
    const settled = await this.settle(String(c._id), payment, user);
    if (!settled) throw new ConflictException('The case was paid or changed meanwhile');
    return {
      status: 'succeeded',
      transactionId,
      invoiceNumber: settled.invoiceNumber,
      paymentId: String(payment._id),
      emailedTo: settled.emailed ? payment.payerEmail : null,
    };
  }

  /** SSLCommerz: opens a checkout session for the case; the payer's browser goes to the returned page. */
  async startOnline(user: CurrentUser, caseId: string) {
    const c = await this.payable(user, caseId);
    const [me, vehicle] = await Promise.all([
      this.users.findById(user.id).lean(),
      c.vehicleId ? this.vehicles.findById(c.vehicleId).lean() : null,
    ]);
    const transactionId = `DTE${Date.now().toString(36).toUpperCase()}${randomBytes(3).toString('hex').toUpperCase()}`;
    const payment = await this.payments.create({
      caseId: c._id,
      caseNumber: c.caseNumber,
      userId: new Types.ObjectId(user.id),
      amount: c.amount,
      currency: c.currency,
      provider: 'sslcommerz',
      method: 'online',
      transactionId,
      payerName: me?.name || c.ownerName,
      payerEmail: user.email ?? c.ownerEmail ?? '',
      status: PaymentStatusEnum.PENDING,
    });
    const back = `${this.backendUrl}/api/payments/sslcommerz`;
    try {
      const url = await this.sslcommerz.start({
        total_amount: c.amount.toFixed(2),
        currency: c.currency,
        tran_id: transactionId,
        success_url: `${back}/success`,
        fail_url: `${back}/fail`,
        cancel_url: `${back}/cancel`,
        ipn_url: `${back}/ipn`,
        cus_name: payment.payerName || 'Vehicle owner',
        cus_email: payment.payerEmail || 'owner@example.com',
        cus_add1: vehicle?.ownerAddress || 'Dhaka',
        cus_city: 'Dhaka',
        cus_postcode: '1000',
        cus_country: 'Bangladesh',
        // required by SSLCommerz; the registry's number when there is one
        cus_phone: vehicle?.ownerPhone || '01700000000',
        shipping_method: 'NO',
        product_name: `Traffic fine ${c.caseNumber}`,
        product_category: 'Traffic fine',
        product_profile: 'general',
        value_a: String(c._id),
      });
      await this.audit.record(user, 'payment.started', 'case', String(c._id),
        `${c.caseNumber}: SSLCommerz checkout opened (${money(c.amount, c.currency)})`, { transactionId });
      return { url, transactionId };
    } catch (err) {
      payment.status = PaymentStatusEnum.FAILED;
      payment.failureReason = (err as Error).message;
      await payment.save();
      throw err;
    }
  }

  /** SSLCommerz posted back "success" (the payer's browser) or an IPN: confirm with its validation API, then settle. */
  async completeOnline(body: Record<string, unknown>): Promise<OnlineOutcome> {
    const payment = await this.payments.findOne({ transactionId: str(body.tran_id), provider: 'sslcommerz' });
    if (!payment) return { caseId: null, outcome: 'failed' };
    const caseId = String(payment.caseId);
    if (payment.status === PaymentStatusEnum.SUCCEEDED) return { caseId, outcome: 'success' };   // IPN after success
    const valId = str(body.val_id);
    const v: SslValidation | null = valId
      ? await this.sslcommerz.validate(valId).catch((err: Error) => ({ status: 'UNREACHABLE', error: err.message }))
      : null;
    const ok =
      !!v &&
      (v.status === 'VALID' || v.status === 'VALIDATED') &&
      v.tran_id === payment.transactionId &&
      Math.abs(Number(v.amount) - payment.amount) < 0.01 &&
      (!v.currency || v.currency === payment.currency);
    if (!ok) {
      payment.status = PaymentStatusEnum.FAILED;
      payment.failureReason = `SSLCommerz did not confirm the payment (${v ? v.status : 'no validation id'})`;
      await payment.save();
      return { caseId, outcome: 'failed' };
    }
    payment.method = v.card_type || 'online';
    payment.account = v.card_no ?? '';
    payment.validationId = valId;
    payment.bankTransactionId = v.bank_tran_id;
    const payer = { id: String(payment.userId), email: payment.payerEmail, role: null, aal: 1, amr: [] } as CurrentUser;
    const settled = await this.settle(caseId, payment, payer);
    if (!settled) {
      // Money was taken but the case was no longer unpaid (paid another way meanwhile): needs a refund by hand.
      payment.status = PaymentStatusEnum.FAILED;
      payment.failureReason = 'Paid at SSLCommerz, but the case was no longer unpaid: refund this payment';
      await payment.save();
      this.logger.warn(`SSLCommerz ${payment.transactionId}: case ${payment.caseNumber} was not unpaid; refund needed`);
      return { caseId, outcome: 'failed' };
    }
    return { caseId, outcome: 'success' };
  }

  /** SSLCommerz posted back "fail" or "cancel". */
  async endOnline(body: Record<string, unknown>, outcome: 'failed' | 'cancelled'): Promise<OnlineOutcome> {
    const payment = await this.payments.findOne({ transactionId: str(body.tran_id), provider: 'sslcommerz' });
    if (!payment) return { caseId: null, outcome };
    if (payment.status === PaymentStatusEnum.PENDING) {
      payment.status = PaymentStatusEnum.FAILED;
      payment.failureReason = outcome === 'cancelled' ? 'Cancelled by the payer' : str(body.error) || 'The payment failed at SSLCommerz';
      payment.method = str(body.card_type) || payment.method;
      await payment.save();
    }
    return { caseId: String(payment.caseId), outcome };
  }

  /**
   * A successful payment: the case is marked paid (only if still unpaid: a second click or callback cannot pay
   * twice), then the payment, and the invoice is rendered, stored and emailed. Null if the case was not unpaid.
   */
  private async settle(caseId: string, payment: HydratedDocument<Payment>, actor: CurrentUser) {
    const paidAt = new Date();
    const invoiceNumber = makeNumber('INV', paidAt);
    const claimed = await this.cases.findOneAndUpdate(
      { _id: caseId, status: CaseStatusEnum.UNPAID },
      { $set: { status: CaseStatusEnum.PAID, paidAt, invoiceNumber, paymentId: payment._id } },
      { returnDocument: 'after' },
    );
    if (!claimed) return null;
    payment.status = PaymentStatusEnum.SUCCEEDED;
    payment.paidAt = paidAt;
    payment.invoiceNumber = invoiceNumber;
    payment.failureReason = '';
    await payment.save();

    const v = await this.violations.findById(claimed.violationId).lean();
    const pdf = await this.invoices.render(claimed, payment, v as Violation | null);
    const invoiceKey = `invoices/${paidAt.getUTCFullYear()}/${invoiceNumber}.pdf`;
    try {
      await this.evidence.put(invoiceKey, pdf, 'application/pdf');
      payment.invoiceKey = invoiceKey;
    } catch (err) {
      this.logger.error(`Invoice upload failed: ${(err as Error).message}`);
    }
    let emailed = false;
    try {
      await this.mail.invoice(claimed, payment, pdf);
      payment.invoiceEmailedAt = new Date();
      emailed = true;
    } catch (err) {
      this.logger.error(`Invoice email failed: ${(err as Error).message}`);
    }
    await payment.save();
    await this.casesService.notify(String(payment.userId), `Fine paid: ${claimed.caseNumber}`,
      `${money(payment.amount, payment.currency)} received. Invoice ${invoiceNumber}.`, { caseId: String(claimed._id) });
    await this.audit.record(actor, 'payment.succeeded', 'case', String(claimed._id),
      `${claimed.caseNumber} paid (${money(payment.amount, payment.currency)}, ${payment.provider} ${payment.method})`,
      { invoiceNumber, transactionId: payment.transactionId });
    return { invoiceNumber, emailed };
  }

  /** Invoice PDF for the payer (or staff): from S3, regenerated if the stored copy is missing. */
  async invoicePdf(paymentId: string, user: CurrentUser | null) {
    const p = await this.payments.findById(paymentId);
    if (!p || p.status !== PaymentStatusEnum.SUCCEEDED) throw new NotFoundException('Invoice not found');
    if (user) await this.casesService.assertOwner(user, String(p.caseId));
    if (p.invoiceKey) {
      try {
        return { name: `${p.invoiceNumber}.pdf`, pdf: await this.evidence.read(p.invoiceKey) };
      } catch {
        this.logger.warn(`Invoice ${p.invoiceKey} missing in S3, regenerating`);
      }
    }
    const c = await this.cases.findById(p.caseId);
    if (!c) throw new NotFoundException('Case not found');
    const v = await this.violations.findById(c.violationId).lean();
    return { name: `${p.invoiceNumber}.pdf`, pdf: await this.invoices.render(c, p, v as Violation | null) };
  }

  async list(q: ListQuery) {
    const match = q.status && q.status !== 'all' ? { status: q.status } : {};
    const page = await this.payments.paginate(match, {
      page: q.page ?? 1,
      limit: q.limit ?? 20,
      sort: { createdAt: -1 },
      lean: true,
    });
    return { ...page, docs: page.docs.map((d) => toPlain(d)) };
  }
}
