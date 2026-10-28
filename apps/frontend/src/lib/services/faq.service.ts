import { APIUrl } from '@/lib/constants/url.config';
import {
  CreateFaqRequest,
  FaqsReorderItemsRequest,
  UpdateFaqRequest,
} from '@/lib/dtos/request/faq.req';
import { FaqResponse } from '@/lib/dtos/response/faq.res';
import httpClient from '@/lib/utils/httpClient';

class FaqService {
  async listFaqs(params?: QueryParams): Promise<PaginatedResponse<FaqResponse>> {
    const res = await httpClient.get<PaginatedResponse<FaqResponse>>(APIUrl.faq.list(), {
      params,
    });
    return res.data;
  }

  async listMyFaqs(params?: QueryParams): Promise<PaginatedResponse<FaqResponse>> {
    const res = await httpClient.get<PaginatedResponse<FaqResponse>>(APIUrl.faq.listMe(), {
      params,
    });
    return res.data;
  }

  async listAllFaqs(params?: QueryParams): Promise<PaginatedResponse<FaqResponse>> {
    const res = await httpClient.get<PaginatedResponse<FaqResponse>>(APIUrl.faq.listAll(), {
      params,
    });
    return res.data;
  }

  async getFaqCategories(): Promise<string[]> {
    const res = await httpClient.get<string[]>(APIUrl.faq.categories());
    return res.data;
  }

  async createFaq(data: CreateFaqRequest): Promise<FaqResponse> {
    const res = await httpClient.post<FaqResponse>(APIUrl.faq.create(), data);
    return res.data;
  }

  async updateFaq(id: ID, data: UpdateFaqRequest): Promise<FaqResponse> {
    const res = await httpClient.patch<FaqResponse>(APIUrl.faq.update(id), data);
    return res.data;
  }

  async deleteFaq(id: ID): Promise<void> {
    await httpClient.delete(APIUrl.faq.remove(id));
  }

  async reorderFaqs(data: FaqsReorderItemsRequest): Promise<void> {
    await httpClient.patch(APIUrl.faq.reorder(), data);
  }
}

const faqService = new FaqService();
export default faqService;
