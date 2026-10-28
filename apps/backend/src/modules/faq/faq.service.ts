import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { CurrentUser } from 'src/lib/decorators/user.decorator';
import {
  CreateFaqRequest,
  FaqsReorderItemsRequest,
  UpdateFaqRequest,
} from 'src/lib/dto/request/faq.req';
import type { PaginationQueryDto } from 'src/shared/dtos/query.dto';
import { MongoQueryBuilder } from 'src/utils/mongo-query-builder';
import { FaqAudienceEnum } from 'src/shared/enums/faq.enum';
import { PermissionsEnum } from 'src/shared/enums/permission.enum';
import { Faq, FaqModel } from 'src/schemas/public/faq.schema';

@Injectable()
export class FaqService {
  constructor(@InjectModel(Faq.name) private readonly faqModel: FaqModel) {}

  private audienceBucket(user: CurrentUser): FaqAudienceEnum[] {
    const perms = user.role?.permissions ?? [];
    if (perms.includes(PermissionsEnum.ADMIN)) {
      return [FaqAudienceEnum.PUBLIC, FaqAudienceEnum.MEMBER, FaqAudienceEnum.ADMIN];
    }
    return [FaqAudienceEnum.PUBLIC, FaqAudienceEnum.MEMBER];
  }

  private normalizeAudience(audience: FaqAudienceEnum[]): FaqAudienceEnum[] {
    if (audience.includes(FaqAudienceEnum.PUBLIC)) return [FaqAudienceEnum.PUBLIC];
    return Array.from(new Set(audience));
  }

  private readonly defaultSort = { displayOrder: 1 as const, createdAt: -1 as const };

  async list(query: PaginationQueryDto) {
    const match: Record<string, unknown> = {
      ...query.filter,
      isPublished: true,
      audience: { $in: [FaqAudienceEnum.PUBLIC] },
    };

    // `?search=` clause comes from the schema's registered search fields
    // (question/answer/category) — no hand-built $regex here.
    Object.assign(match, MongoQueryBuilder.buildSearch(query.search, Faq));

    return this.faqModel.paginate(match, {
      page: query.page,
      limit: query.limit,
      sort: this.defaultSort,
    });
  }

  async listAll(query: PaginationQueryDto) {
    const match: Record<string, unknown> = { ...query.filter };

    // `?search=` clause comes from the schema's registered search fields
    // (question/answer/category) — no hand-built $regex here.
    Object.assign(match, MongoQueryBuilder.buildSearch(query.search, Faq));

    return this.faqModel.paginate(match, {
      page: query.page,
      limit: query.limit,
      sort: this.defaultSort,
    });
  }

  async listForUser(user: CurrentUser, query: PaginationQueryDto) {
    const audience = this.audienceBucket(user);
    const match: Record<string, unknown> = {
      ...query.filter,
      isPublished: true,
      audience: { $in: audience },
    };

    // `?search=` clause comes from the schema's registered search fields
    // (question/answer/category) — no hand-built $regex here.
    Object.assign(match, MongoQueryBuilder.buildSearch(query.search, Faq));

    return this.faqModel.paginate(match, {
      page: query.page,
      limit: query.limit,
      sort: this.defaultSort,
    });
  }

  async getCategories(): Promise<string[]> {
    const categories = await this.faqModel.distinct('category');
    return categories.sort();
  }

  async create(dto: CreateFaqRequest, user: CurrentUser) {
    const row = await this.faqModel.create({
      question: dto.question,
      answer: dto.answer,
      category: dto.category ?? 'General',
      audience: this.normalizeAudience(dto.audience ?? [FaqAudienceEnum.PUBLIC]),
      isPublished: dto.isPublished ?? false,
      createdById: new Types.ObjectId(user.id),
    });
    return row;
  }

  async update(id: string, dto: UpdateFaqRequest) {
    const existing = await this.faqModel.findById(id);
    if (!existing) throw new NotFoundException('FAQ not found');

    const row = await this.faqModel.findByIdAndUpdate(
      id,
      {
        ...(dto.question !== undefined && { question: dto.question }),
        ...(dto.answer !== undefined && { answer: dto.answer }),
        ...(dto.category !== undefined && { category: dto.category }),
        ...(dto.audience !== undefined && {
          audience: this.normalizeAudience(dto.audience),
        }),
        ...(dto.isPublished !== undefined && { isPublished: dto.isPublished }),
      },
      { returnDocument: 'after' },
    );
    return row;
  }

  async remove(id: string) {
    const existing = await this.faqModel.findById(id);
    if (!existing) throw new NotFoundException('FAQ not found');
    await this.faqModel.deleteOne({ _id: id });
  }

  async reorder(dto: FaqsReorderItemsRequest) {
    if (dto.faqItems.length === 0) return;
    await this.faqModel.bulkWrite(
      dto.faqItems.map((item) => ({
        updateOne: {
          filter: { _id: item.id },
          update: { displayOrder: item.displayOrder },
        },
      })),
    );
  }
}
