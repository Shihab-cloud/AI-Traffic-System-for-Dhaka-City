function describeS3Error(body: string | null): string {
  if (!body) return '';
  const code = /<Code>([^<]+)<\/Code>/.exec(body)?.[1];
  const message = /<Message>([^<]+)<\/Message>/.exec(body)?.[1];
  if (!code && !message) return '';
  return ` — ${[code, message].filter(Boolean).join(': ')}`;
}

export function uploadToS3(
  presignedUrl: string,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', presignedUrl);
    xhr.setRequestHeader('Content-Type', file.type);
    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      };
    }
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`S3 upload failed: ${xhr.status}${describeS3Error(xhr.responseText)}`));
    xhr.onerror = () => reject(new Error('S3 upload network error'));
    xhr.send(file);
  });
}
