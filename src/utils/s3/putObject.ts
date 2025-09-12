import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const s3 = new S3Client({});

export const putObject = async ({
  bucket,
  key,
  data,
}: {
  bucket: string;
  key: string;
  data: string;
}) => {
  try {
    const result = await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: data, // string | Buffer | Uint8Array | Blob — works in node + browser
      }),
    );
    return result; // contains ETag, versionId, etc.
  } catch (err) {
    throw new Error(
      `failed to put object in bucket '${bucket}' with key '${key}': ${err}`,
    );
  }
};
