import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseInterceptors,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { GetUser, type CurrentUser } from 'src/lib/decorators/user.decorator';
import {
  CompleteSupportUploadRequest,
  CreateMessageRequest,
  CreateTicketRequest,
  GetSupportPresignedUrlRequest,
  UpdateTicketRequest,
} from 'src/lib/dto/request/support.req';
import {
  PaginatedSupportTicketResponse,
  SupportFileUploadUrlResponse,
  SupportTicketDetailResponse,
  SupportTicketResponse,
  SupportUploadConfirmResponse,
} from 'src/lib/dto/response/support.res';
import { ResponseSerializerInterceptor } from 'src/lib/interceptors/response-serializer.interceptor';
import { ParamIdValidationPipe } from 'src/lib/pipes/validation.pipe';
import { QueryTransformPipe } from 'src/lib/pipes/query.pipe';
import { PaginationQueryOptions, type PaginationQueryDto } from 'src/shared/dtos/query.dto';
import { SupportUploadService } from './support-upload.service';
import { SupportService } from './support.service';

@ApiTags('Support')
@Controller('support')
export class SupportController {
  constructor(
    private readonly supportService: SupportService,
    private readonly supportUploadService: SupportUploadService,
  ) {}

  @ApiOperation({ summary: 'Submit a new support ticket' })
  @ApiResponse({ type: SupportTicketResponse })
  @UseInterceptors(new ResponseSerializerInterceptor(SupportTicketResponse))
  @Post()
  async createTicket(@Body() dto: CreateTicketRequest, @GetUser() user: CurrentUser) {
    return this.supportService.createTicket(user, dto);
  }

  @ApiOperation({ summary: 'List support tickets (role-filtered)' })
  @ApiResponse({ type: PaginatedSupportTicketResponse })
  @ApiQuery({ type: PaginationQueryOptions })
  @UseInterceptors(new ResponseSerializerInterceptor(PaginatedSupportTicketResponse))
  @Get()
  async listTickets(
    @Query(QueryTransformPipe) query: PaginationQueryDto,
    @GetUser() user: CurrentUser,
  ) {
    return this.supportService.listTickets(user, query);
  }

  @ApiOperation({ summary: 'List tickets submitted by the current user (ignores role)' })
  @ApiResponse({ type: PaginatedSupportTicketResponse })
  @ApiQuery({ type: PaginationQueryOptions })
  @UseInterceptors(new ResponseSerializerInterceptor(PaginatedSupportTicketResponse))
  @Get('mine')
  async listMyTickets(
    @Query(QueryTransformPipe) query: PaginationQueryDto,
    @GetUser() user: CurrentUser,
  ) {
    return this.supportService.listMyTickets(user, query);
  }

  @ApiOperation({ summary: 'Get a support ticket with messages' })
  @ApiResponse({ type: SupportTicketDetailResponse })
  @UseInterceptors(new ResponseSerializerInterceptor(SupportTicketDetailResponse))
  @Get(':id')
  async getTicket(@Param('id', ParamIdValidationPipe) id: string, @GetUser() user: CurrentUser) {
    return this.supportService.getTicket(user, id);
  }

  @ApiOperation({ summary: 'Update a ticket (status, priority, or assignee)' })
  @ApiResponse({ type: SupportTicketResponse })
  @UseInterceptors(new ResponseSerializerInterceptor(SupportTicketResponse))
  @Patch(':id')
  async updateTicket(
    @Param('id', ParamIdValidationPipe) id: string,
    @Body() dto: UpdateTicketRequest,
    @GetUser() user: CurrentUser,
  ) {
    return this.supportService.updateTicket(user, id, dto);
  }

  @ApiOperation({ summary: 'Add a reply message to a ticket' })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post(':id/messages')
  async addMessage(
    @Param('id', ParamIdValidationPipe) id: string,
    @Body() dto: CreateMessageRequest,
    @GetUser() user: CurrentUser,
  ) {
    return this.supportService.addMessage(user, id, dto);
  }

  @ApiOperation({ summary: 'Get a presigned S3 URL for direct browser upload' })
  @ApiResponse({ type: SupportFileUploadUrlResponse })
  @UseInterceptors(new ResponseSerializerInterceptor(SupportFileUploadUrlResponse))
  @Post('upload/presigned-url')
  async createPresignedUploadUrl(@Body() dto: GetSupportPresignedUrlRequest) {
    return this.supportUploadService.createPresignedUploadUrl(dto);
  }

  @ApiOperation({ summary: 'Confirm a file was successfully uploaded to S3' })
  @ApiResponse({ type: SupportUploadConfirmResponse })
  @UseInterceptors(new ResponseSerializerInterceptor(SupportUploadConfirmResponse))
  @Post('upload/complete')
  async completeUpload(@Body() dto: CompleteSupportUploadRequest) {
    return this.supportUploadService.completeUpload(dto);
  }
}
