import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Types } from 'mongoose';
import type {
  SupportTicketLogAttachment,
  SupportTicketLogDetails,
  SupportTicketLogDetailsMap,
} from 'src/lib/types/support.types';
import type { SupportTicketLogTypeEnum } from 'src/shared/enums/support.enum';
import {
  SupportTicketLog,
  SupportTicketLogModel,
} from 'src/schemas/public/support-ticket-log.schema';

/**
 * Aggregate row produced by `performerLookupStages()`'s `$project` — the log
 * fields plus a hydrated `performedBy` ({ id, name, role } or null). `_id`
 * survives the projection (Mongo keeps it unless explicitly excluded)
 * alongside the aliased `id`.
 */
export type SupportTicketLogWithPerformer = {
  _id: Types.ObjectId;
  id: Types.ObjectId;
  type: SupportTicketLogTypeEnum;
  message: string | null;
  details: SupportTicketLogDetails | null;
  createdAt: Date;
  attachments?: SupportTicketLogAttachment[];
  performedBy: { id: Types.ObjectId; name: string; role: string | null } | null;
};

@Injectable()
export class SupportTicketLogService {
  constructor(
    @InjectModel(SupportTicketLog.name) private readonly logModel: SupportTicketLogModel,
  ) {}

  buildLog<T extends keyof SupportTicketLogDetailsMap>({
    ticketId,
    type,
    details,
    performedById,
    message,
    attachments,
  }: {
    ticketId: string;
    type: T;
    details: SupportTicketLogDetailsMap[T];
    performedById: string;
    message?: string;
    attachments?: SupportTicketLogAttachment[];
  }) {
    return {
      ticketId: new Types.ObjectId(ticketId),
      type,
      message: message ?? null,
      details,
      performedById: new Types.ObjectId(performedById),
      attachments: attachments ?? [],
    };
  }

  async createTicketLog<T extends keyof SupportTicketLogDetailsMap>({
    session,
    ticketId,
    type,
    details,
    performedById,
    message,
    attachments,
  }: {
    session?: ClientSession;
    ticketId: string;
    type: T;
    details: SupportTicketLogDetailsMap[T];
    performedById: string;
    message?: string;
    attachments?: SupportTicketLogAttachment[];
  }): Promise<string> {
    const values = this.buildLog({
      ticketId,
      type,
      details,
      performedById,
      message,
      attachments,
    });
    const [log] = await this.logModel.create([values], { session });
    return String(log._id);
  }

  async getLogById(logId: string): Promise<SupportTicketLogWithPerformer | undefined> {
    const [log] = await this.logModel.aggregate<SupportTicketLogWithPerformer>([
      { $match: { _id: new Types.ObjectId(logId) } },
      ...this.performerLookupStages(),
    ]);
    return log;
  }

  async getLogsForTicket(ticketId: string) {
    return this.logModel.aggregate<SupportTicketLogWithPerformer>([
      { $match: { ticketId: new Types.ObjectId(ticketId) } },
      { $sort: { createdAt: -1 } },
      ...this.performerLookupStages(),
    ]);
  }

  /**
   * Hydrates `performedBy` ({ id, name, role }) from the stored `performedById`,
   * mirroring drizzle's logs-LEFT JOIN-users-LEFT JOIN-roles projection.
   */
  private performerLookupStages() {
    return [
      {
        $lookup: {
          from: 'users',
          localField: 'performedById',
          foreignField: '_id',
          as: 'performer',
        },
      },
      { $unwind: { path: '$performer', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'roles',
          localField: 'performer.roleId',
          foreignField: '_id',
          as: 'performerRole',
        },
      },
      { $unwind: { path: '$performerRole', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          id: '$_id',
          type: 1,
          message: 1,
          details: 1,
          createdAt: 1,
          attachments: 1,
          performedBy: {
            $cond: {
              if: { $ifNull: ['$performer', false] },
              then: {
                id: '$performer._id',
                name: '$performer.name',
                role: { $ifNull: ['$performerRole.name', null] },
              },
              else: null,
            },
          },
        },
      },
    ];
  }
}
