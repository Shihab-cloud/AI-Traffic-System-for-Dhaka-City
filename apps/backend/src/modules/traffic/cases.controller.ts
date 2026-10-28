import { Body, Controller, Get, HttpCode, Param, Post, Query, Res, StreamableFile } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeController, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from 'src/lib/decorators/auth.decorator';
import { Permissions } from 'src/lib/decorators/permissions.decorator';
import { type CurrentUser, GetUser } from 'src/lib/decorators/user.decorator';
import { ParamIdValidationPipe } from 'src/lib/pipes/validation.pipe';
import { PermissionsEnum } from 'src/shared/enums/permission.enum';
import { AuditService } from './audit.service';
import { CasesService } from './cases.service';
import { ListQuery, PayRequest, ReviewDecisionRequest, ReviewRequest } from './dto/traffic.req';
import { type OnlineOutcome, PaymentsService } from './payments.service';
import { RegistryService } from './registry.service';
import { ReportsService } from './reports.service';

const pdf = (file: { name: string; pdf: Buffer }) =>
  new StreamableFile(file.pdf, { type: 'application/pdf', disposition: `attachment; filename="${file.name}"` });

@ApiTags('Traffic - cases (staff)')
@Controller('cases')
export class CasesController {
  constructor(private readonly cases: CasesService) {}

  @Permissions({ permissions: [PermissionsEnum.READ_VIOLATION] })
  @Get()
  list(@Query() q: ListQuery) {
    return this.cases.list(q);
  }

  @Permissions({ permissions: [PermissionsEnum.READ_VIOLATION] })
  @Get(':id')
  get(@Param('id', ParamIdValidationPipe) id: string) {
    return this.cases.detail(id);
  }

  @ApiOperation({ summary: 'Email the ticket to the owner again' })
  @Permissions({ permissions: [PermissionsEnum.ISSUE_TICKET] })
  @Post(':id/resend')
  resend(@Param('id', ParamIdValidationPipe) id: string, @GetUser() user: CurrentUser) {
    return this.cases.resendTicket(id, user);
  }
}

@ApiTags('Traffic - reviews (staff)')
@Controller('reviews')
export class ReviewsController {
  constructor(private readonly cases: CasesService) {}

  @Permissions({ permissions: [PermissionsEnum.DECIDE_REVIEW] })
  @Get()
  list(@Query() q: ListQuery) {
    return this.cases.listReviews(q);
  }

  @ApiOperation({ summary: 'Accept (ticket cancelled) or reject (fine due) a review request' })
  @Permissions({ permissions: [PermissionsEnum.DECIDE_REVIEW] })
  @Post(':id/decide')
  decide(
    @Param('id', ParamIdValidationPipe) id: string,
    @Body() dto: ReviewDecisionRequest,
    @GetUser() user: CurrentUser,
  ) {
    return this.cases.decideReview(id, dto.decision, dto.note ?? '', user);
  }
}

@ApiTags('Traffic - payments (staff)')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Permissions({ permissions: [PermissionsEnum.READ_REPORT] })
  @Get()
  list(@Query() q: ListQuery) {
    return this.payments.list(q);
  }

  @Permissions({ permissions: [PermissionsEnum.READ_REPORT] })
  @Get(':id/invoice')
  async invoice(@Param('id', ParamIdValidationPipe) id: string) {
    return pdf(await this.payments.invoicePdf(id, null));
  }
}

/**
 * Where SSLCommerz sends the payer's browser back (a form POST from its page, so no sign-in token: public) and its
 * server-to-server IPN. Nothing in these posts is trusted: the payment is confirmed with SSLCommerz's validation API
 * (PaymentsService.completeOnline). The browser then lands on the owner's case page with the outcome.
 */
@ApiExcludeController()
@Public()
@Controller('payments/sslcommerz')
export class SslcommerzController {
  private readonly frontendUrl: string;

  constructor(
    private readonly payments: PaymentsService,
    config: ConfigService,
  ) {
    this.frontendUrl = (config.get<string>('FRONTEND_URL') ?? 'http://localhost:3000').replace(/\/$/, '');
  }

  private back(res: Response, r: OnlineOutcome) {
    const q = new URLSearchParams({ payment: r.outcome, ...(r.caseId ? { case: r.caseId } : {}) });
    res.redirect(303, `${this.frontendUrl}/my-cases?${q}`);
  }

  @Post('success')
  async success(@Body() body: Record<string, unknown>, @Res() res: Response) {
    this.back(res, await this.payments.completeOnline(body));
  }

  @Post('fail')
  async fail(@Body() body: Record<string, unknown>, @Res() res: Response) {
    this.back(res, await this.payments.endOnline(body, 'failed'));
  }

  @Post('cancel')
  async cancel(@Body() body: Record<string, unknown>, @Res() res: Response) {
    this.back(res, await this.payments.endOnline(body, 'cancelled'));
  }

  @HttpCode(200)
  @Post('ipn')
  async ipn(@Body() body: Record<string, unknown>) {
    const r = str(body.status) === 'VALID' || str(body.status) === 'VALIDATED'
      ? await this.payments.completeOnline(body)
      : await this.payments.endOnline(body, str(body.status) === 'CANCELLED' ? 'cancelled' : 'failed');
    return { received: true, outcome: r.outcome };
  }
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** The vehicle owner's portal: only their own cases (by account or by the email the ticket was sent to). */
@ApiTags('Traffic - vehicle owner')
@Controller('citizen')
export class CitizenController {
  constructor(
    private readonly cases: CasesService,
    private readonly payments: PaymentsService,
    private readonly registry: RegistryService,
  ) {}

  @Get('cases')
  mine(@GetUser() user: CurrentUser) {
    return this.cases.mine(user);
  }

  @Get('vehicles')
  vehicles(@GetUser() user: CurrentUser) {
    return this.registry.myVehicles(user);
  }

  @Get('cases/:id')
  get(@Param('id', ParamIdValidationPipe) id: string, @GetUser() user: CurrentUser) {
    return this.cases.mineDetail(user, id);
  }

  @ApiOperation({ summary: 'Apply for review (appeal)' })
  @Post('cases/:id/review')
  review(@Param('id', ParamIdValidationPipe) id: string, @Body() dto: ReviewRequest, @GetUser() user: CurrentUser) {
    return this.cases.requestReview(user, id, dto);
  }

  @ApiOperation({ summary: 'Which online gateway the payment pop-up offers' })
  @Get('payment-gateway')
  gateway() {
    return this.payments.gateway();
  }

  @ApiOperation({ summary: 'Pay the fine online: opens an SSLCommerz checkout and returns its page' })
  @Post('cases/:id/pay/online')
  payOnline(@Param('id', ParamIdValidationPipe) id: string, @GetUser() user: CurrentUser) {
    return this.payments.startOnline(user, id);
  }

  @ApiOperation({ summary: 'Pay the fine through the built-in test gateway (no money); the invoice is emailed' })
  @Post('cases/:id/pay')
  pay(@Param('id', ParamIdValidationPipe) id: string, @Body() dto: PayRequest, @GetUser() user: CurrentUser) {
    return this.payments.pay(user, id, dto);
  }

  @Get('payments/:id/invoice')
  async invoice(@Param('id', ParamIdValidationPipe) id: string, @GetUser() user: CurrentUser) {
    return pdf(await this.payments.invoicePdf(id, user));
  }
}

@ApiTags('Traffic - reports')
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly audit: AuditService,
  ) {}

  @Permissions({ permissions: [PermissionsEnum.READ_REPORT] })
  @Get('overview')
  overview(@Query('days') days?: string) {
    const n = Math.min(365, Math.max(1, Number(days) || 30));
    return this.reports.overview(n);
  }

  @Permissions({ permissions: [PermissionsEnum.READ_AUDIT] })
  @Get('audit')
  auditLog(@Query() q: ListQuery) {
    return this.audit.list({ page: q.page ?? 1, limit: q.limit ?? 30, search: q.search, filter: {}, sortBy: {} });
  }
}
