import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { randomUUID } from 'crypto';
import { ClientSession, Connection, Types } from 'mongoose';
import type { CurrentUser } from 'src/lib/decorators/user.decorator';
import {
  CreateMessageRequest,
  CreateTicketRequest,
  UpdateTicketRequest,
} from 'src/lib/dto/request/support.req';
import { User, UserModel } from 'src/schemas/public/user.schema';
import type { PaginationQueryDto } from 'src/shared/dtos/query.dto';
import { MongoQueryBuilder } from 'src/utils/mongo-query-builder';
import { DocumentType } from 'src/shared/enums/document-type.enum';
import { NotificationChannelEnum } from 'src/shared/enums/notification-channel.enum';
import { PermissionsEnum } from 'src/shared/enums/permission.enum';
import {
  SupportTicketLogTypeEnum,
  SupportTicketPriorityEnum,
  SupportTicketStatusEnum,
} from 'src/shared/enums/support.enum';
import { FileService } from '../file/file.service';
import { NotificationService } from '../notification/notification.service';
import { SupportAudienceHelper } from './helpers/support-audience.helper';
import { SupportTicketResponse } from 'src/lib/dto/response/support.res';
import { SupportTicket, SupportTicketModel } from 'src/schemas/public/support-ticket.schema';
import { SupportTicketLogService } from './support-ticket-log.service';

/**
 * Aggregate row produced by `senderLookupStages()` — the ticket document
 * projected with `submittedByName` / `submittedByRole` (the submitter/role
 * JOIN aliases).
 */
type SupportTicketWithSender = SupportTicket & {
  submittedByName: string;
  submittedByRole: string;
};

@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name);

  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(SupportTicket.name) private readonly ticketModel: SupportTicketModel,
    @InjectModel(User.name) private readonly userModel: UserModel,
    private readonly logService: SupportTicketLogService,
    private readonly fileService: FileService,
    private readonly notificationService: NotificationService,
    private readonly audienceHelper: SupportAudienceHelper,
  ) {}

  // ─── Role Detection ──────────────────────────────────────────────────────────

  private detectRole(currentUser: CurrentUser) {
    const permissions = currentUser.role?.permissions ?? [];
    const isAdmin = permissions.includes(PermissionsEnum.ADMIN);
    // A "manager" can triage tickets (set priority/assignee/status) and view all
    // tickets platform-wide. Admins implicitly hold every permission.
    const isManager = isAdmin || permissions.includes(PermissionsEnum.MANAGE_SUPPORT_TICKET);
    return { isAdmin, isManager };
  }

  private assertTicketScope(
    ticket: { submittedById: string },
    currentUser: CurrentUser,
    isManager: boolean,
  ): void {
    if (isManager) return;
    if (ticket.submittedById !== currentUser.id) throw new NotFoundException('Ticket not found');
  }

  private generateTicketNumber(): string {
    return `TKT-${new Date().getFullYear()}-${randomUUID().slice(0, 6).toUpperCase()}`;
  }

  /**
   * Returns a ticket projected with `submittedByName` / `submittedByRole`,
   * mirroring drizzle's tickets-JOIN-users-JOIN-roles select.
   */
  private async getTicketWithSender(
    ticketId: string,
  ): Promise<SupportTicketWithSender | undefined> {
    const [ticket] = await this.ticketModel.aggregate<SupportTicketWithSender>([
      { $match: { _id: new Types.ObjectId(ticketId) } },
      ...this.senderLookupStages(),
    ]);
    return ticket;
  }

  private senderLookupStages() {
    return [
      {
        $lookup: {
          from: 'users',
          localField: 'submittedById',
          foreignField: '_id',
          as: 'submitter',
        },
      },
      { $unwind: '$submitter' },
      {
        $lookup: {
          from: 'roles',
          localField: 'submitter.roleId',
          foreignField: '_id',
          as: 'submitterRole',
        },
      },
      { $unwind: '$submitterRole' },
      {
        $addFields: {
          submittedByName: '$submitter.name',
          submittedByRole: '$submitterRole.name',
        },
      },
      { $project: { submitter: 0, submitterRole: 0 } },
    ];
  }

  // ─── Create Ticket ───────────────────────────────────────────────────────────

  async createTicket(currentUser: CurrentUser, dto: CreateTicketRequest) {
    const { isManager } = this.detectRole(currentUser);

    const priority = isManager
      ? (dto.priority ?? SupportTicketPriorityEnum.MEDIUM)
      : SupportTicketPriorityEnum.MEDIUM;

    let insertedId = '';
    let insertedTicketNumber = '';
    let insertedSubject = '';

    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        const [ticket] = await this.ticketModel.create(
          [
            {
              ticketNumber: this.generateTicketNumber(),
              submittedById: new Types.ObjectId(currentUser.id),
              subject: dto.subject,
              description: dto.description,
              category: dto.category,
              priority,
            },
          ],
          { session },
        );

        await this.logService.createTicketLog({
          session,
          ticketId: String(ticket._id),
          type: SupportTicketLogTypeEnum.TICKET_CREATED,
          details: {
            subject: ticket.subject,
            category: ticket.category,
            priority: ticket.priority,
          },
          performedById: currentUser.id,
          attachments: dto.attachments,
        });

        insertedId = String(ticket._id);
        insertedTicketNumber = ticket.ticketNumber;
        insertedSubject = ticket.subject;
      });
    } finally {
      await session.endSession();
    }

    const adminIds = await this.audienceHelper.resolveAdminIds(currentUser.id);
    if (adminIds.length > 0) {
      try {
        await this.notificationService.publishNotification({
          channel: NotificationChannelEnum.SUPPORT_TICKET_NOTIFY,
          payload: {
            ticket: { id: insertedId },
            message: `A new ticket has been submitted: #${insertedTicketNumber} — ${insertedSubject}`,
            userIds: adminIds,
          },
        });
      } catch (err) {
        this.logger.warn(
          `Failed to notify admins for new ticket #${insertedTicketNumber}: ${String(err)}`,
        );
      }
    }

    const ticket = await this.getTicketWithSender(insertedId);
    return ticket;
  }

  // ─── List Tickets ────────────────────────────────────────────────────────────

  async listTickets(currentUser: CurrentUser, query: PaginationQueryDto) {
    const { isManager } = this.detectRole(currentUser);

    const match: Record<string, unknown> = { ...query.filter };

    if (!isManager) {
      match.submittedById = new Types.ObjectId(currentUser.id);
    }

    // `?search=` clause comes from the schema's registered search fields
    // (subject) — no hand-built $regex here.
    Object.assign(match, MongoQueryBuilder.buildSearch(query.search, SupportTicket));

    const pipeline = this.ticketModel.aggregate([
      { $match: match },
      ...this.senderLookupStages(),
      { $sort: query.sortBy ?? { createdAt: -1 } },
    ]);

    return this.ticketModel.aggregatePaginate(pipeline, {
      page: query.page,
      limit: query.limit,
    });
  }

  // ─── List My Tickets (always scoped to submittedById) ────────────────────────

  async listMyTickets(currentUser: CurrentUser, query: PaginationQueryDto) {
    const match: Record<string, unknown> = {
      ...query.filter,
      submittedById: new Types.ObjectId(currentUser.id),
    };

    // `?search=` clause comes from the schema's registered search fields
    // (subject) — no hand-built $regex here.
    Object.assign(match, MongoQueryBuilder.buildSearch(query.search, SupportTicket));

    const pipeline = this.ticketModel.aggregate([
      { $match: match },
      ...this.senderLookupStages(),
      { $sort: query.sortBy ?? { createdAt: -1 } },
    ]);

    return this.ticketModel.aggregatePaginate(pipeline, {
      page: query.page,
      limit: query.limit,
    });
  }

  // ─── Get Ticket ──────────────────────────────────────────────────────────────

  async getTicket(currentUser: CurrentUser, ticketId: string) {
    const { isManager } = this.detectRole(currentUser);

    const ticket = await this.getTicketWithSender(ticketId);

    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }

    this.assertTicketScope({ submittedById: String(ticket.submittedById) }, currentUser, isManager);

    const rawLogs = await this.logService.getLogsForTicket(ticketId);

    const logs = await Promise.all(
      rawLogs.map(async (log) => {
        const attachments = await Promise.all(
          (log.attachments ?? []).map(
            async ({ fileKey, fileName }: { fileKey: string; fileName: string }) => {
              const { url } = await this.fileService.getPresignedSignedUrl(fileKey);
              return { fileName, url };
            },
          ),
        );
        return {
          id: log.id,
          type: log.type,
          message: log.message,
          details: log.details,
          createdAt: log.createdAt,
          performedBy: log.performedBy,
          attachments,
        };
      }),
    );

    return { ...ticket, logs };
  }

  // ─── Update Ticket ────────────────────────────────────────────────────────────

  async updateTicket(
    currentUser: CurrentUser,
    ticketId: string,
    dto: UpdateTicketRequest,
  ): Promise<SupportTicketResponse> {
    const { isManager } = this.detectRole(currentUser);

    const ticket = await this.ticketModel.findById(ticketId).lean();

    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }

    this.assertTicketScope({ submittedById: String(ticket.submittedById) }, currentUser, isManager);

    const hasStatus = dto.status !== undefined;
    const hasPriority = dto.priority !== undefined;
    const hasAssignedTo = dto.assignedTo !== undefined;

    if (!hasStatus && !hasPriority && !hasAssignedTo) {
      // No-op update — return the existing row. The lean document is mapped to
      // SupportTicketResponse by the controller's ResponseSerializerInterceptor.
      return ticket as unknown as SupportTicketResponse;
    }

    // Per-field auth
    if (hasStatus && !isManager) {
      if (dto.status !== SupportTicketStatusEnum.RESOLVED) {
        throw new ForbiddenException('Employees can only close their own tickets');
      }
    }

    if ((hasPriority || hasAssignedTo) && !isManager) {
      throw new ForbiddenException('Only admins can update priority or assignee');
    }

    const updatedTicket = {
      ...ticket,
      status: dto.status,
      priority: dto.priority,
      assignedTo: dto.assignedTo,
      resolvedAt: dto.status === SupportTicketStatusEnum.RESOLVED ? new Date() : null,
    };

    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        await this.ticketModel.updateOne(
          { _id: ticketId },
          {
            status: updatedTicket.status,
            priority: updatedTicket.priority,
            assignedTo: updatedTicket.assignedTo,
            resolvedAt: updatedTicket.resolvedAt,
          },
          { session },
        );
        if (hasStatus) await this.logStatusChange({ session, ticket, updatedTicket, currentUser });
        if (hasPriority)
          await this.logPriorityChange({ session, ticket, updatedTicket, currentUser });
        if (hasAssignedTo)
          await this.logAssignedToChange({ session, ticket, updatedTicket, currentUser });
      });
    } finally {
      await session.endSession();
    }

    await this.notifyOnTicketUpdate({
      ticket: {
        id: String(ticket._id),
        ticketNumber: ticket.ticketNumber,
        subject: ticket.subject,
        submittedById: String(ticket.submittedById),
      },
      currentUser,
      isManager,
    });

    // Return the persisted row (mirrors drizzle's `.returning()`) so the
    // response reflects exactly what was written, not the hand-merged object.
    // The lean document is mapped to SupportTicketResponse by the controller's
    // ResponseSerializerInterceptor.
    const persisted = await this.ticketModel.findById(ticketId).lean();
    return (persisted ?? ticket) as unknown as SupportTicketResponse;
  }

  // ─── Add Message ─────────────────────────────────────────────────────────────

  async addMessage(currentUser: CurrentUser, ticketId: string, dto: CreateMessageRequest) {
    const { isManager } = this.detectRole(currentUser);

    const ticket = await this.ticketModel.findById(ticketId).lean();

    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }

    this.assertTicketScope({ submittedById: String(ticket.submittedById) }, currentUser, isManager);

    if (ticket.status === SupportTicketStatusEnum.RESOLVED) {
      throw new BadRequestException('Cannot reply to a resolved ticket');
    }

    if (!dto.content && (!dto.attachments || dto.attachments.length === 0)) {
      throw new BadRequestException('Message must have content or an attachment');
    }

    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        await this.logService.createTicketLog({
          session,
          ticketId,
          type: SupportTicketLogTypeEnum.MESSAGE_ADDED,
          details: { content: dto.content ?? '' },
          performedById: currentUser.id,
          attachments: dto.attachments,
        });

        await this.ticketModel.updateOne(
          { _id: ticketId },
          { lastResponseAt: new Date() },
          { session },
        );
      });
    } finally {
      await session.endSession();
    }

    const submittedById = String(ticket.submittedById);

    if (isManager) {
      if (submittedById !== currentUser.id) {
        try {
          await this.notificationService.publishNotification({
            channel: NotificationChannelEnum.SUPPORT_TICKET_NOTIFY,
            payload: {
              ticket: { id: String(ticket._id) },
              message: `An admin has replied to your ticket #${ticket.ticketNumber} — ${ticket.subject}`,
              userIds: [submittedById],
              title: 'New update on your support ticket',
            },
          });
        } catch (err) {
          this.logger.warn(
            `Failed to notify ticket creator for #${ticket.ticketNumber}: ${String(err)}`,
          );
        }
      }
    } else {
      const adminIds = await this.audienceHelper.resolveAdminIds(currentUser.id);

      if (adminIds.length > 0) {
        try {
          await this.notificationService.publishNotification({
            channel: NotificationChannelEnum.SUPPORT_TICKET_NOTIFY,
            payload: {
              ticket: { id: String(ticket._id) },
              message: `A user has replied to ticket #${ticket.ticketNumber} — ${ticket.subject}`,
              userIds: adminIds,
            },
          });
        } catch (err) {
          this.logger.warn(`Failed to notify admins for #${ticket.ticketNumber}: ${String(err)}`);
        }
      }
    }
  }

  // ─── Notification Helpers ────────────────────────────────────────────────────

  private async notifyOnTicketUpdate(opts: {
    ticket: { id: string; ticketNumber: string; subject: string; submittedById: string };
    currentUser: CurrentUser;
    isManager: boolean;
  }): Promise<void> {
    const { ticket, currentUser, isManager } = opts;
    if (!isManager) return;

    await this.notifyTicketCreator(
      ticket,
      currentUser.id,
      'Your support ticket has been updated',
      `Your ticket #${ticket.ticketNumber} — ${ticket.subject} has been updated`,
    );
  }

  private async notifyTicketCreator(
    ticket: { id: string; ticketNumber: string; subject: string; submittedById: string },
    actorId: string,
    title: string,
    message: string,
  ): Promise<void> {
    if (ticket.submittedById === actorId) return;

    try {
      await this.notificationService.publishNotification({
        channel: NotificationChannelEnum.TO_USER,
        payload: {
          userId: ticket.submittedById,
          title,
          message,
          metadata: {
            ids: [{ documentType: DocumentType.SUPPORT_TICKET, documentId: ticket.id }],
          },
        },
      });
    } catch (err) {
      this.logger.warn(
        `Failed to notify ticket creator for #${ticket.ticketNumber}: ${String(err)}`,
      );
    }
  }

  // ─── Private Log Writers ─────────────────────────────────────────────────────

  private async logStatusChange({
    session,
    ticket,
    updatedTicket,
    currentUser,
  }: {
    session: ClientSession;
    ticket: { _id: unknown; status: string };
    updatedTicket: { status?: SupportTicketStatusEnum };
    currentUser: CurrentUser;
  }) {
    await this.logService.createTicketLog({
      session,
      ticketId: String(ticket._id),
      type: SupportTicketLogTypeEnum.STATUS_CHANGED,
      details: { oldStatus: ticket.status, newStatus: updatedTicket.status! },
      performedById: currentUser.id,
    });
  }

  private async logPriorityChange({
    session,
    ticket,
    updatedTicket,
    currentUser,
  }: {
    session: ClientSession;
    ticket: { _id: unknown; priority: string };
    updatedTicket: { priority?: SupportTicketPriorityEnum };
    currentUser: CurrentUser;
  }) {
    await this.logService.createTicketLog({
      session,
      ticketId: String(ticket._id),
      type: SupportTicketLogTypeEnum.PRIORITY_CHANGED,
      details: { oldPriority: ticket.priority, newPriority: updatedTicket.priority! },
      performedById: currentUser.id,
    });
  }

  private async logAssignedToChange({
    session,
    ticket,
    updatedTicket,
    currentUser,
  }: {
    session: ClientSession;
    ticket: { _id: unknown; assignedTo: string | null };
    updatedTicket: { assignedTo?: string };
    currentUser: CurrentUser;
  }) {
    await this.logService.createTicketLog({
      session,
      ticketId: String(ticket._id),
      type: SupportTicketLogTypeEnum.ASSIGNED_TO_CHANGED,
      details: { oldAssignedTo: ticket.assignedTo, newAssignedTo: updatedTicket.assignedTo! },
      performedById: currentUser.id,
    });
  }
}
