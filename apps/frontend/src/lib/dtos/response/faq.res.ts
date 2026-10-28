import { FaqAudienceEnum } from '@/lib/enums/faq.enum';

export interface FaqResponse extends BaseResponse {
  question: string;
  answer: string;
  category: string;
  audience: FaqAudienceEnum[];
  isPublished: boolean;
  displayOrder: number;
}
