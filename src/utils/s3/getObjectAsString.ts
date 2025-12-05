import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';

const s3 = new S3Client();

export const getObjectAsString = async ({
  bucket,
  key,
}: {
  bucket: string;
  key: string;
}): Promise<string | null> => {
  try {
    const { Body } = await s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
    );
    if (!Body) return null;
    return await Body.transformToString('utf-8'); // sdk adds this at runtime on both node (Readable) and browser (ReadableStream)
  } catch (err: any) {
    if (err?.name === 'NoSuchKey' || err?.$metadata?.httpStatusCode === 404)
      throw new Error(
        `could not find object in s3 in bucket '${bucket}' with key '${key}'`,
      );

    throw err;
  }
};
