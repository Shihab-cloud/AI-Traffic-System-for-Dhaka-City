// One-time / idempotent setup after start-infra.ps1: initiate the MongoDB replica set and create the S3 bucket.
// Uses the drivers the backend already installed (hoisted node_modules at the repo root).
import { CreateBucketCommand, HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { MongoClient } from 'mongodb';

const MONGO = 'mongodb://127.0.0.1:27017/?directConnection=true';
const S3 = { endpoint: 'http://127.0.0.1:8333', bucket: 'traffic-evidence', key: 'local-dev-access-key', secret: 'local-dev-secret-key' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const client = new MongoClient(MONGO);
await client.connect();
const admin = client.db('admin');
try {
  const status = await admin.command({ replSetGetStatus: 1 });
  console.log(`MongoDB replica set "${status.set}" is up`);
} catch (e) {
  if (e.codeName !== 'NotYetInitialized') throw e;
  await admin.command({ replSetInitiate: { _id: 'rs0', members: [{ _id: 0, host: '127.0.0.1:27017' }] } });
  for (let i = 0; i < 60; i++) {
    if ((await admin.command({ hello: 1 })).isWritablePrimary) break;
    await sleep(500);
  }
  console.log('MongoDB replica set "rs0" initiated');
}
await client.close();

const s3 = new S3Client({
  region: 'us-east-1',
  endpoint: S3.endpoint,
  forcePathStyle: true,
  credentials: { accessKeyId: S3.key, secretAccessKey: S3.secret },
});
for (let i = 0; i < 30; i++) {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: S3.bucket }));
    console.log(`S3 bucket "${S3.bucket}" exists`);
    break;
  } catch (e) {
    if (e?.$metadata?.httpStatusCode === 404 || e?.name === 'NotFound' || e?.name === 'NoSuchBucket') {
      await s3.send(new CreateBucketCommand({ Bucket: S3.bucket }));
      console.log(`S3 bucket "${S3.bucket}" created`);
      break;
    }
    await sleep(1000); // the S3 gateway needs a few seconds after the filer starts
  }
}
