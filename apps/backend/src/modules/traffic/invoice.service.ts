import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import PDFDocument from 'pdfkit';
import type { Payment } from 'src/schemas/traffic/payment.schema';
import type { TrafficCase } from 'src/schemas/traffic/traffic-case.schema';
import type { Violation } from 'src/schemas/traffic/violation.schema';
import { dhakaTime, money } from './traffic.util';

/** Invoice / receipt PDF for a paid fine (A4, built-in Helvetica: registration numbers are in Latin script). */
@Injectable()
export class InvoiceService {
  private readonly appName: string;

  constructor(config: ConfigService) {
    this.appName = config.get<string>('APP_NAME') ?? 'Dhaka Traffic Enforcement';
  }

  render(c: TrafficCase, p: Payment, v: Violation | null): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: `Invoice ${p.invoiceNumber}` } });
      const chunks: Buffer[] = [];
      doc.on('data', (b: Buffer) => chunks.push(b));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const blue = '#0b5394';
      const grey = '#6b7280';
      doc.rect(0, 0, doc.page.width, 90).fill(blue);
      doc.fillColor('#ffffff').fontSize(20).font('Helvetica-Bold').text(this.appName, 50, 30);
      doc.fontSize(11).font('Helvetica').text('Traffic fine - invoice and payment receipt', 50, 58);

      doc.fillColor('#111827').fontSize(18).font('Helvetica-Bold').text('INVOICE', 50, 120);
      doc.fontSize(10).font('Helvetica').fillColor(grey);
      doc.text(`Invoice number: ${p.invoiceNumber}`, 50, 148);
      doc.text(`Issued: ${dhakaTime(p.paidAt)} (Dhaka time)`, 50, 163);
      doc.text(`Case number: ${c.caseNumber}`, 50, 178);

      doc.roundedRect(380, 118, 165, 60, 6).fill('#e7f6ec');
      doc.fillColor('#137333').fontSize(18).font('Helvetica-Bold').text('PAID', 380, 128, { width: 165, align: 'center' });
      doc.fontSize(10).font('Helvetica').text(money(p.amount, p.currency), 380, 154, { width: 165, align: 'center' });

      let y = 215;
      const section = (title: string) => {
        doc.fillColor(blue).fontSize(12).font('Helvetica-Bold').text(title, 50, y);
        y += 20;
      };
      const row = (k: string, val: string) => {
        doc.fillColor(grey).fontSize(10).font('Helvetica').text(k, 50, y, { width: 160 });
        doc.fillColor('#111827').text(val || '-', 215, y, { width: 330 });
        y += Math.max(16, doc.heightOfString(val || '-', { width: 330 }) + 4);
      };

      section('Billed to');
      row('Name', p.payerName || c.ownerName);
      row('Email', p.payerEmail || c.ownerEmail || '');
      row('Vehicle registration', c.registration);
      y += 10;

      section('Violation');
      row('Type', `${c.code} ${c.title}`);
      if (v) {
        row('Date and time', `${dhakaTime(v.occurredAt)} (Dhaka)`);
        row('Location / camera', v.cameraName || '-');
        if (v.kph != null && v.limitKph != null) row('Measured speed', `${v.avgKph ?? v.kph} km/h (limit ${v.limitKph} km/h)`);
      }
      if (c.legalReference) row('Legal reference', c.legalReference);
      row('Ticket issued', `${dhakaTime(c.issuedAt)}${c.issuedByName ? ` by ${c.issuedByName}` : ''}`);
      y += 10;

      section('Payment');
      row('Method', `${p.method.toUpperCase()} ${p.account}`.trim());
      row('Transaction ID', p.transactionId);
      row('Gateway', p.provider === 'sandbox' ? 'Sandbox (test payment, no money moved)' : p.provider);
      y += 6;

      doc.moveTo(50, y).lineTo(545, y).strokeColor('#e5e7eb').stroke();
      y += 10;
      doc.fillColor('#111827').fontSize(10).font('Helvetica').text('Fine', 50, y);
      doc.text(money(c.amount, c.currency), 380, y, { width: 165, align: 'right' });
      y += 18;
      doc.font('Helvetica-Bold').fontSize(12).text('Total paid', 50, y);
      doc.text(money(p.amount, p.currency), 380, y, { width: 165, align: 'right' });

      doc.fillColor(grey).fontSize(8).font('Helvetica').text(
        'This invoice was generated automatically and is valid without a signature. Keep it as proof of payment.',
        50,
        doc.page.height - 80,
        { width: 495, align: 'center' },
      );
      doc.end();
    });
  }
}
