import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { randomUUID } from 'crypto';
import { GlobalFile, GlobalFileModel } from 'src/schemas/public/global-file.schema';

@Injectable()
export class FileService {
  private readonly logger = new Logger(FileService.name);

  private readonly client: S3Client;
  private readonly bucketName: string;
  private readonly basePath: string;

  constructor(
    @InjectModel(GlobalFile.name) private globalFileModel: GlobalFileModel,
    private readonly configService: ConfigService,
  ) {
    const region = this.configService.get<string>('AWS_S3_BUCKET_REGION');

    if (!region) {
      throw new Error('AWS_S3_BUCKET_REGION is required');
    }

    // Credentials resolved by AWS SDK default provider chain — ECS task role
    // in prod, AWS SSO / aws-vault locally — unless static keys are set, as for
    // the local S3-compatible store (SeaweedFS) that AWS_S3_ENDPOINT points at.
    const endpoint = this.configService.get<string>('AWS_S3_ENDPOINT') || undefined;
    const accessKeyId = this.configService.get<string>('AWS_S3_ACCESS_KEY');
    const secretAccessKey = this.configService.get<string>('AWS_S3_SECRET_ACCESS_KEY');
    this.client = new S3Client({
      region,
      forcePathStyle: true,
      ...(endpoint ? { endpoint } : {}),
      ...(accessKeyId && secretAccessKey ? { credentials: { accessKeyId, secretAccessKey } } : {}),
    });

    const bucketName = this.configService.get<string>('AWS_S3_BUCKET_NAME');

    // Required, and checked here rather than left to fail later: the bucket name
    // is baked into every URL this service persists, so an absent value does not
    // surface as an error — it surfaces as rows of permanently dead links.
    if (!bucketName) {
      throw new Error('AWS_S3_BUCKET_NAME is required');
    }
    this.bucketName = bucketName;

    // Built in the constructor, not as a field initializer — initializers run
    // before the constructor assigns `bucketName`. Region-qualified
    // virtual-hosted style; the bare `<bucket>.s3.amazonaws.com` form resolves
    // only for us-east-1 without a redirect.
    this.basePath = endpoint
      ? `${endpoint.replace(/\/$/, '')}/${bucketName}`
      : `https://${bucketName}.s3.${region}.amazonaws.com`;
  }

  /** The S3 client, for modules that stream objects themselves (evidence images). */
  get s3(): S3Client {
    return this.client;
  }

  get bucket(): string {
    return this.bucketName;
  }

  isBase64(str: string) {
    const base64Pattern = /^data:([A-Za-z-+/]+);base64,(.+)$/;

    return base64Pattern.test(str);
  }

  isUrl(url: string) {
    const urlPattern = /^(http|https):\/\/[^ "]+$/;

    return urlPattern.test(url);
  }

  getFileBufferAndMimeType(base64String: string) {
    // Split the base64 string to extract the MIME type and data
    const parts = base64String.split(',');

    // Get MIME type from the first part of the string
    const mimeType = parts[0].match(/:(.*?);/)?.[1];

    const buffer = Buffer.from(parts[1], 'base64');

    return { buffer, mimeType };
  }

  async getPresignedSignedUrl(key: string) {
    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: key,
    });

    const url = await getSignedUrl(this.client, command, {
      expiresIn: 60 * 60 * 24, // 24 hours
    });

    return { url };
  }

  async verifyFileExists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucketName, Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  async generateUploadPresignedUrl(fileKey: string, contentType: string): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: fileKey,
      ContentType: contentType,
    });

    return getSignedUrl(this.client, command, { expiresIn: 60 * 15 }); // 15 minutes
  }

  async getFileBuffer(key: string): Promise<Buffer> {
    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: key,
    });

    const response = await this.client.send(command);

    if (!response.Body) {
      throw new Error(`S3 object body is empty for key: ${key}`);
    }

    const chunks: Buffer[] = [];
    for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  /**
   * Lists object keys directly under a prefix, paginated. `Delimiter='/'`
   * keeps the listing top-level only — sub-folders are not recursed, so any
   * future archive/staging folder under a prefix won't bloat the result set.
   */
  async listObjects(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    let continuationToken: string | undefined;

    do {
      const res = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucketName,
          Prefix: prefix,
          Delimiter: '/',
          ContinuationToken: continuationToken,
        }),
      );
      for (const obj of res.Contents ?? []) {
        // Skip the prefix itself if it appears as a 0-byte key (folder marker).
        if (obj.Key && obj.Key !== prefix) keys.push(obj.Key);
      }
      continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (continuationToken);

    return keys;
  }

  getFileUrl(key: string) {
    return { url: `${this.basePath}/${key}` };
  }

  async getKeyFromUrl(url: string) {
    const storedFile = await this.globalFileModel.findOne({ url });

    if (storedFile) return storedFile.key;

    this.logger.warn(`File with url ${url} not found in the database`);
    return url.replace(`${this.basePath}/`, '');
  }

  async deleteFileByUrl(url: string) {
    const key = await this.getKeyFromUrl(url);

    return await this.deleteFile(key);
  }

  async deleteFile(key: string) {
    const command = new DeleteObjectCommand({
      Bucket: this.bucketName,
      Key: key,
    });

    await this.client.send(command);

    await this.globalFileModel.deleteOne({ key });

    this.logger.log(`File ${key} deleted: ${key}`);

    return { key };
  }

  /**
   * `isPublic` defaults to false. A `public-read` ACL makes the object
   * world-readable by URL forever, and on a bucket with Block Public Access —
   * the AWS default — the PutObject is rejected outright. Callers that want a
   * public object ask for one.
   */
  async storeFile(
    data: Buffer | string,
    mimetype?: string,
    folder: string = 'default',
    isPublic: boolean = false,
    fileName: string = randomUUID(),
  ) {
    const key = `${folder}/${fileName}`;

    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      Body: data,
      ContentType: mimetype,
      ACL: isPublic ? 'public-read' : 'private',
    });

    await this.client.send(command);

    const url = isPublic ? `${this.basePath}/${key}` : null;

    const storedFile = await this.globalFileModel.create({
      key,
      fileName,
      mimeType: mimetype,
      size: data.length,
      isPublic,
      url,
    });

    this.logger.log(`File uploaded: ${key}`);

    return storedFile;
  }

  async uploadStringFile(data: string, folder: string = 'default', isPublic: boolean = false) {
    if (this.isUrl(data)) {
      return { url: data, key: null, isPublic };
    }

    return await this.uploadBase64File(data, folder, isPublic);
  }

  async uploadBase64File(
    base64String: string,
    folder: string = 'default',
    isPublic: boolean = false,
  ) {
    if (!this.isBase64(base64String)) {
      throw new Error('Invalid base64 string');
    }

    const { buffer, mimeType } = this.getFileBufferAndMimeType(base64String);

    return await this.storeFile(buffer, mimeType, folder, isPublic);
  }

  async uploadJson(object: object, folder: string = 'default', isPublic: boolean = false) {
    return await this.storeFile(JSON.stringify(object), 'application/json', folder, isPublic);
  }
}
