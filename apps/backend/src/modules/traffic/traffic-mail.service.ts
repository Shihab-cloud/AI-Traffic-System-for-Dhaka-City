import { MailerService } from '@nestjs-modules/mailer';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Payment } from 'src/schemas/traffic/payment.schema';
import type { Review } from 'src/schemas/traffic/review.schema';
import type { TrafficCase } from 'src/schemas/traffic/traffic-case.schema';
import type { Violation } from 'src/schemas/traffic/violation.schema';
import { dhakaTime, escapeHtml, money } from './traffic.util';

/** Emails to vehicle owners: the ticket, the review decision and the paid invoice (PDF attached). */
@Injectable()
export class TrafficMailService {
  private readonly appName: string;
  private readonly portalUrl: string;

  constructor(
    private readonly mailer: MailerService,
    config: ConfigService,
  ) {
    this.appName = config.get<string>('APP_NAME') ?? 'Dhaka Traffic Enforcement';
    this.portalUrl = `${(config.get<string>('FRONTEND_URL') ?? 'http://localhost:3000').replace(/\/$/, '')}/my-cases`;
  }

  private layout(title: string, body: string) {
    const e = escapeHtml;
    return `<!doctype html><html><body style="margin:0;background:#f4f6f8;font-family:Segoe UI,Arial,sans-serif;color:#1f2933">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:8px;overflow:hidden">
<tr><td style="background:#0b5394;color:#fff;padding:18px 24px;font-size:18px;font-weight:600">${e(this.appName)}</td></tr>
<tr><td style="padding:24px"><h2 style="margin:0 0 16px;font-size:20px">${e(title)}</h2>${body}</td></tr>
<tr><td style="padding:16px 24px;background:#f9fafb;font-size:12px;color:#6b7280">This message was sent automatically. Do not reply to it.</td></tr>
</table></td></tr></table></body></html>`;
  }

  private rows(rows: [string, string][]) {
    return `<table cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%;font-size:14px">${rows
      .map(
        ([k, v]) =>
          `<tr><td style="color:#6b7280;border-bottom:1px solid #eef0f2;width:40%">${escapeHtml(k)}</td><td style="border-bottom:1px solid #eef0f2">${escapeHtml(v)}</td></tr>`,
      )
      .join('')}</table>`;
  }

  private button(label: string) {
    return `<p style="margin:24px 0"><a href="${this.portalUrl}" style="background:#0b5394;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;display:inline-block">${escapeHtml(label)}</a></p>`;
  }

  async ticket(c: TrafficCase, v: Violation) {
    const body =
      `<p>Dear ${escapeHtml(c.ownerName || 'vehicle owner')},</p>` +
      `<p>A traffic violation was recorded for your vehicle <b>${escapeHtml(c.registration)}</b>. ` +
      `You can see the evidence, pay the fine or ask for a review on the website.</p>` +
      this.rows([
        ['Case number', c.caseNumber],
        ['Violation', `${c.code} ${c.title}`],
        ['When', `${dhakaTime(v.occurredAt)} (Dhaka)`],
        ['Where', v.cameraName || '-'],
        ...(v.kph != null && v.limitKph != null
          ? ([['Measured speed', `${v.avgKph ?? v.kph} km/h (limit ${v.limitKph} km/h)`]] as [string, string][])
          : []),
        ['Fine', money(c.amount, c.currency)],
        ['Pay or ask for a review by', dhakaTime(c.dueDate).slice(0, 10)],
      ]) +
      this.button('See the case') +
      `<p style="font-size:13px;color:#6b7280">Sign in (or register) with this email address to see the case.</p>`;
    await this.mailer.sendMail({
      to: c.ownerEmail,
      subject: `Traffic violation ${c.caseNumber}: ${c.registration}`,
      html: this.layout('Traffic violation notice', body),
    });
  }

  async reviewDecision(c: TrafficCase, r: Review) {
    const accepted = r.status === 'accepted';
    const body =
      `<p>Your review request for case <b>${escapeHtml(c.caseNumber)}</b> (${escapeHtml(c.registration)}) was ` +
      `<b>${accepted ? 'accepted: the ticket is cancelled and nothing is due' : 'rejected'}</b>.</p>` +
      (r.decisionNote ? `<p><i>${escapeHtml(r.decisionNote)}</i></p>` : '') +
      (accepted
        ? ''
        : this.rows([
            ['Fine', money(c.amount, c.currency)],
            ['Pay by', dhakaTime(c.dueDate).slice(0, 10)],
          ])) +
      this.button('See the case');
    await this.mailer.sendMail({
      to: r.userEmail || c.ownerEmail,
      subject: `Review ${accepted ? 'accepted' : 'rejected'}: case ${c.caseNumber}`,
      html: this.layout('Review decision', body),
    });
  }

  async invoice(c: TrafficCase, p: Payment, pdf: Buffer) {
    const body =
      `<p>Thank you. We received your payment for case <b>${escapeHtml(c.caseNumber)}</b>. ` +
      `The invoice is attached.</p>` +
      this.rows([
        ['Invoice number', p.invoiceNumber ?? ''],
        ['Vehicle', c.registration],
        ['Violation', `${c.code} ${c.title}`],
        ['Amount paid', money(p.amount, p.currency)],
        ['Paid with', `${p.method.toUpperCase()} ${p.account}`],
        ['Transaction', p.transactionId],
        ['Paid at', `${dhakaTime(p.paidAt)} (Dhaka)`],
      ]) +
      this.button('See the case');
    await this.mailer.sendMail({
      to: p.payerEmail || c.ownerEmail,
      subject: `Invoice ${p.invoiceNumber}: fine paid for case ${c.caseNumber}`,
      html: this.layout('Payment received', body),
      attachments: [{ filename: `${p.invoiceNumber}.pdf`, content: pdf, contentType: 'application/pdf' }],
    });
  }
}
