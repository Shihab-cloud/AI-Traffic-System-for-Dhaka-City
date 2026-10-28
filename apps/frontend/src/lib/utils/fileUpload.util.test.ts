import { beforeEach, describe, expect, it, vi } from 'vitest';

import { uploadToS3 } from './fileUpload.util';

class FakeXHR {
  static instances: FakeXHR[] = [];
  status = 0;
  responseText = '';
  upload = { onprogress: null as ((e: ProgressEvent) => void) | null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  open = vi.fn();
  setRequestHeader = vi.fn();
  send = vi.fn();
  constructor() {
    FakeXHR.instances.push(this);
  }
}

beforeEach(() => {
  FakeXHR.instances = [];
  // @ts-expect-error test stub
  global.XMLHttpRequest = FakeXHR;
});

describe('uploadToS3', () => {
  it('resolves on a 2xx status', async () => {
    const file = new File(['x'], 'a.csv', { type: 'text/csv' });
    const promise = uploadToS3('https://example.com/presigned', file);
    const xhr = FakeXHR.instances[0];
    xhr.status = 200;
    xhr.onload?.();
    await expect(promise).resolves.toBeUndefined();
  });

  it('rejects with the S3 XML error body parsed into the message', async () => {
    const file = new File(['x'], 'a.csv', { type: 'text/csv' });
    const promise = uploadToS3('https://example.com/presigned', file);
    const xhr = FakeXHR.instances[0];
    xhr.status = 403;
    xhr.responseText =
      '<Error><Code>InvalidAccessKeyId</Code><Message>The key does not exist</Message></Error>';
    xhr.onload?.();
    await expect(promise).rejects.toThrow(
      'S3 upload failed: 403 — InvalidAccessKeyId: The key does not exist',
    );
  });

  it('rejects on a network error', async () => {
    const file = new File(['x'], 'a.csv', { type: 'text/csv' });
    const promise = uploadToS3('https://example.com/presigned', file);
    FakeXHR.instances[0].onerror?.();
    await expect(promise).rejects.toThrow('S3 upload network error');
  });
});
