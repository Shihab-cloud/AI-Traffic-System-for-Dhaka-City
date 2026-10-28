import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permissions } from 'src/lib/decorators/permissions.decorator';
import { type CurrentUser, GetUser } from 'src/lib/decorators/user.decorator';
import { ParamIdValidationPipe } from 'src/lib/pipes/validation.pipe';
import { PermissionsEnum } from 'src/shared/enums/permission.enum';
import { CasesService } from './cases.service';
import {
  DismissRequest,
  IssueTicketRequest,
  UpdatePlateRequest,
  ViolationListQuery,
} from './dto/traffic.req';
import { ViolationsService } from './violations.service';

@ApiTags('Traffic - violations')
@Controller('violations')
export class ViolationsController {
  constructor(
    private readonly violations: ViolationsService,
    private readonly cases: CasesService,
  ) {}

  @ApiOperation({ summary: 'Detected violations, newest first (the officer dashboard table)' })
  @Permissions({ permissions: [PermissionsEnum.READ_VIOLATION] })
  @Get()
  list(@Query() q: ViolationListQuery) {
    return this.violations.list(q);
  }

  @ApiOperation({ summary: 'Counts by status, last 24 h, new by code' })
  @Permissions({ permissions: [PermissionsEnum.READ_VIOLATION] })
  @Get('summary')
  summary() {
    return this.violations.summary();
  }

  @ApiOperation({ summary: 'One violation with signed evidence image URLs, fine, case and registry matches' })
  @Permissions({ permissions: [PermissionsEnum.READ_VIOLATION] })
  @Get(':id')
  get(@Param('id', ParamIdValidationPipe) id: string) {
    return this.violations.get(id);
  }

  @ApiOperation({ summary: 'Start (or return) the VLM explanation; ?force=true regenerates it' })
  @Permissions({ permissions: [PermissionsEnum.READ_VIOLATION] })
  @Post(':id/explain')
  explain(@Param('id', ParamIdValidationPipe) id: string, @Query('force') force?: string) {
    return this.violations.explain(id, force === 'true');
  }

  @ApiOperation({ summary: 'Correct the registration read from the plate' })
  @Permissions({ permissions: [PermissionsEnum.ISSUE_TICKET] })
  @Post(':id/plate')
  setPlate(
    @Param('id', ParamIdValidationPipe) id: string,
    @Body() dto: UpdatePlateRequest,
    @GetUser() user: CurrentUser,
  ) {
    return this.violations.setPlate(id, dto.registration, user);
  }

  @ApiOperation({ summary: 'Dismiss (no ticket) with a reason' })
  @Permissions({ permissions: [PermissionsEnum.ISSUE_TICKET] })
  @Post(':id/dismiss')
  dismiss(@Param('id', ParamIdValidationPipe) id: string, @Body() dto: DismissRequest, @GetUser() user: CurrentUser) {
    return this.violations.dismiss(id, dto.reason, user);
  }

  @ApiOperation({ summary: 'Reopen a dismissed violation' })
  @Permissions({ permissions: [PermissionsEnum.ISSUE_TICKET] })
  @Post(':id/reopen')
  reopen(@Param('id', ParamIdValidationPipe) id: string, @GetUser() user: CurrentUser) {
    return this.violations.reopen(id, user);
  }

  @ApiOperation({ summary: 'Send a ticket to the vehicle owner (creates the case, emails the owner)' })
  @Permissions({ permissions: [PermissionsEnum.ISSUE_TICKET] })
  @Post(':id/ticket')
  ticket(
    @Param('id', ParamIdValidationPipe) id: string,
    @Body() dto: IssueTicketRequest,
    @GetUser() user: CurrentUser,
  ) {
    return this.cases.issue(id, dto, user);
  }
}
