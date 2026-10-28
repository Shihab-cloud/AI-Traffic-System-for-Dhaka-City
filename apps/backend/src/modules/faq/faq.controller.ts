import {
  Body,
  Controller,
  Delete,
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
import { Public } from 'src/lib/decorators/auth.decorator';
import { Permissions } from 'src/lib/decorators/permissions.decorator';
import { type CurrentUser, GetUser } from 'src/lib/decorators/user.decorator';
import {
  CreateFaqRequest,
  FaqsReorderItemsRequest,
  UpdateFaqRequest,
} from 'src/lib/dto/request/faq.req';
import { FaqResponse, PaginatedFaqResponse } from 'src/lib/dto/response/faq.res';
import { ResponseSerializerInterceptor } from 'src/lib/interceptors/response-serializer.interceptor';
import { ParamIdValidationPipe } from 'src/lib/pipes/validation.pipe';
import { QueryTransformPipe } from 'src/lib/pipes/query.pipe';
import { PaginationQueryOptions, type PaginationQueryDto } from 'src/shared/dtos/query.dto';
import { PermissionsEnum } from 'src/shared/enums/permission.enum';
import { FaqService } from './faq.service';

@ApiTags('Faq')
@Controller('faqs')
export class FaqController {
  constructor(private readonly faqService: FaqService) {}

  @ApiOperation({ summary: 'List published FAQs with audience=all (guest view)' })
  @ApiResponse({ type: PaginatedFaqResponse })
  @ApiQuery({ type: PaginationQueryOptions })
  @Public()
  @UseInterceptors(new ResponseSerializerInterceptor(PaginatedFaqResponse))
  @Get()
  async list(@Query(QueryTransformPipe) query: PaginationQueryDto) {
    return this.faqService.list(query);
  }

  @ApiOperation({ summary: 'List FAQs scoped to the caller’s role audience' })
  @ApiResponse({ type: PaginatedFaqResponse })
  @ApiQuery({ type: PaginationQueryOptions })
  @UseInterceptors(new ResponseSerializerInterceptor(PaginatedFaqResponse))
  @Get('me')
  async listMe(@Query(QueryTransformPipe) query: PaginationQueryDto, @GetUser() user: CurrentUser) {
    return this.faqService.listForUser(user, query);
  }

  @ApiOperation({ summary: 'Distinct FAQ categories (shared taxonomy)' })
  @Get('categories')
  async categories() {
    return this.faqService.getCategories();
  }

  @ApiOperation({ summary: 'List all FAQs unfiltered, including drafts and every audience' })
  @ApiResponse({ type: PaginatedFaqResponse })
  @ApiQuery({ type: PaginationQueryOptions })
  @Permissions({ permissions: [PermissionsEnum.MANAGE_FAQ] })
  @UseInterceptors(new ResponseSerializerInterceptor(PaginatedFaqResponse))
  @Get('all')
  async listAll(@Query(QueryTransformPipe) query: PaginationQueryDto) {
    return this.faqService.listAll(query);
  }

  @ApiOperation({ summary: 'Reorder FAQs' })
  @Permissions({ permissions: [PermissionsEnum.MANAGE_FAQ] })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Patch('reorder')
  async reorder(@Body() dto: FaqsReorderItemsRequest) {
    return this.faqService.reorder(dto);
  }

  @ApiOperation({ summary: 'Create an FAQ' })
  @ApiResponse({ type: FaqResponse })
  @Permissions({ permissions: [PermissionsEnum.MANAGE_FAQ] })
  @UseInterceptors(new ResponseSerializerInterceptor(FaqResponse))
  @Post()
  async create(@Body() dto: CreateFaqRequest, @GetUser() user: CurrentUser) {
    return this.faqService.create(dto, user);
  }

  @ApiOperation({ summary: 'Update an FAQ' })
  @ApiResponse({ type: FaqResponse })
  @Permissions({ permissions: [PermissionsEnum.MANAGE_FAQ] })
  @UseInterceptors(new ResponseSerializerInterceptor(FaqResponse))
  @Patch(':id')
  async update(@Param('id', ParamIdValidationPipe) id: string, @Body() dto: UpdateFaqRequest) {
    return this.faqService.update(id, dto);
  }

  @ApiOperation({ summary: 'Delete an FAQ' })
  @Permissions({ permissions: [PermissionsEnum.MANAGE_FAQ] })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(':id')
  async remove(@Param('id', ParamIdValidationPipe) id: string) {
    return this.faqService.remove(id);
  }
}
