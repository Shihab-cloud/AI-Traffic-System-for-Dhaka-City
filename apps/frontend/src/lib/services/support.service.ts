import { APIUrl } from '@/lib/constants/url.config';
import {
  SupportTicketDetailResponse,
  SupportTicketResponse,
} from '@/lib/dtos/response/support.res';
import {
  CreateMessageRequest,
  CreateTicketRequest,
  UpdateTicketRequest,
} from '@/lib/dtos/request/support.req';
import httpClient from '@/lib/utils/httpClient';

class SupportService {
  async listTickets(params?: QueryParams): Promise<PaginatedResponse<SupportTicketResponse>> {
    const res = await httpClient.get<PaginatedResponse<SupportTicketResponse>>(
      APIUrl.support.getAll(),
      {
        params,
      },
    );
    return res.data;
  }

  async listMyTickets(params?: QueryParams): Promise<PaginatedResponse<SupportTicketResponse>> {
    const res = await httpClient.get<PaginatedResponse<SupportTicketResponse>>(
      APIUrl.support.getMine(),
      {
        params,
      },
    );
    return res.data;
  }

  async getTicket(id: ID): Promise<SupportTicketDetailResponse> {
    const res = await httpClient.get<SupportTicketDetailResponse>(APIUrl.support.getOne(id));
    return res.data;
  }

  async createTicket(data: CreateTicketRequest): Promise<SupportTicketResponse> {
    const res = await httpClient.post<SupportTicketResponse>(APIUrl.support.create(), data);
    return res.data;
  }

  async updateTicket(id: ID, data: UpdateTicketRequest): Promise<SupportTicketResponse> {
    const res = await httpClient.patch<SupportTicketResponse>(APIUrl.support.update(id), data);
    return res.data;
  }

  async addMessage(id: ID, data: CreateMessageRequest): Promise<void> {
    await httpClient.post(APIUrl.support.addMessage(id), data);
  }
}

const supportService = new SupportService();
export default supportService;
