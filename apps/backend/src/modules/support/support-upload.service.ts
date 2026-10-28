import { randomUUID } from 'node:crypto';

import { Injectable, NotFoundException } from '@nestjs/common';
import {
  CompleteSupportUploadRequest,
  GetSupportPresignedUrlRequest,
} from 'src/lib/dto/request/support.req';
import { FileService } from '../file/file.service';

@Injectable()
export class SupportUploadService {
  constructor(private readonly fileService: FileService) {}

  async createPresignedUploadUrl(dto: GetSupportPresignedUrlRequest) {
    const sanitized = dto.fileName.replace(/[^a-zA-Z0-9._-]/g, '-');

    // TODO: record the uploader on the key and check it at attach time.
    // Until then the random prefix is what stops one user attaching another's
    // upload — `completeUpload` still answers for any existing `support/*` key.
    const key = `support/${randomUUID()}-${sanitized}`;
    const presignedUrl = await this.fileService.generateUploadPresignedUrl(key, dto.mimeType);
    return { presignedUrl, key };
  }

  async completeUpload(dto: CompleteSupportUploadRequest) {
    if (!dto.fileKey.startsWith('support/')) {
      throw new NotFoundException('File not found');
    }
    const exists = await this.fileService.verifyFileExists(dto.fileKey);
    if (!exists) {
      throw new NotFoundException('File not found');
    }
    return { fileKey: dto.fileKey, fileName: dto.fileName };
  }
}
