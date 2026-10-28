import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { CurrentUser } from 'src/lib/decorators/user.decorator';
import { AuditLog, AuditLogModel } from 'src/schemas/traffic/audit-log.schema';
import type { PaginationQueryDto } from 'src/shared/dtos/query.dto';
import { MongoQueryBuilder } from 'src/utils/mongo-query-builder';
import { toPlain } from './traffic.util';

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(@InjectModel(AuditLog.name) private readonly auditModel: AuditLogModel) {}

  /** Never throws: a failed audit write must not undo the action it records. */
  async record(
    actor: CurrentUser | null,
    action: string,
    entity: string,
    entityId: string,
    summary: string,
    details: Record<string, unknown> = {},
  ) {
    try {
      await this.auditModel.create({
        actorId: actor?.id ? new Types.ObjectId(actor.id) : undefined,
        actorEmail: actor?.email ?? (actor ? '' : 'system'),
        actorRole: actor?.role?.name ?? '',
        action,
        entity,
        entityId,
        summary,
        details,
      });
    } catch (err) {
      this.logger.error(`Audit write failed for ${action} ${entity}:${entityId}`, err as Error);
    }
  }

  async list(query: PaginationQueryDto) {
    const match = { ...query.filter, ...MongoQueryBuilder.buildSearch(query.search, AuditLog) };
    const page = await this.auditModel.paginate(match, {
      page: query.page,
      limit: query.limit,
      sort: { createdAt: -1 },
      lean: true,
    });
    return { ...page, docs: page.docs.map((d) => toPlain(d)) };
  }
}
