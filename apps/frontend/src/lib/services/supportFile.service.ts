import { APIUrl } from '@/lib/constants/url.config';
import {
  CompleteSupportUploadRequest,
  GetSupportPresignedUrlRequest,
} from '@/lib/dtos/request/support.req';
import {
  SupportFileUploadUrlResponse,
  SupportUploadConfirmResponse,
} from '@/lib/dtos/response/support.res';
import { uploadToS3 } from '@/lib/utils/fileUpload.util';
import httpClient from '@/lib/utils/httpClient';

class SupportFileService {
  async getPresignedUrl(dto: GetSupportPresignedUrlRequest): Promise<SupportFileUploadUrlResponse> {
    const res = await httpClient.post<SupportFileUploadUrlResponse>(
      APIUrl.support.getPresignedUrl(),
      dto,
    );
    return res.data;
  }

  async completeUpload(dto: CompleteSupportUploadRequest): Promise<SupportUploadConfirmResponse> {
    const res = await httpClient.post<SupportUploadConfirmResponse>(
      APIUrl.support.completeUpload(),
      dto,
    );
    return res.data;
  }

  uploadToS3({
    presignedUrl,
    file,
    onProgress,
  }: {
    presignedUrl: string;
    file: File;
    onProgress: (pct: number) => void;
  }): Promise<void> {
    return uploadToS3(presignedUrl, file, onProgress);
  }
}

const supportFileService = new SupportFileService();
export default supportFileService;
