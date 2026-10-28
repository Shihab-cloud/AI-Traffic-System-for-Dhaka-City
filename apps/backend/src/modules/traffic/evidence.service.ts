import { PutObjectCommand } from '@aws-sdk/client-s3';
import { Injectable, Logger } from '@nestjs/common';
import { FileService } from '../file/file.service';
import type { EvidenceImage } from 'src/schemas/traffic/violation.schema';

export type SignedImage = EvidenceImage & { url: string };

/** Evidence images live in a private bucket; responses carry short-lived presigned URLs. */
@Injectable()
export class EvidenceService {
  private readonly logger = new Logger(EvidenceService.name);

  constructor(private readonly files: FileService) {}

  async sign(images: EvidenceImage[] = []): Promise<SignedImage[]> {
    return Promise.all(
      images.map(async (img) => {
        try {
          return { ...img, url: (await this.files.getPresignedSignedUrl(img.key)).url };
        } catch (err) {
          this.logger.warn(`Could not sign ${img.key}: ${(err as Error).message}`);
          return { ...img, url: '' };
        }
      }),
    );
  }

  async read(key: string): Promise<Buffer> {
    return this.files.getFileBuffer(key);
  }

  async put(key: string, data: Buffer, contentType: string) {
    await this.files.s3.send(
      new PutObjectCommand({ Bucket: this.files.bucket, Key: key, Body: data, ContentType: contentType }),
    );
  }
}
