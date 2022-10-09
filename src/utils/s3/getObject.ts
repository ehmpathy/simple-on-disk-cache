import { S3 } from 'aws-sdk';

const s3 = new S3();

export const getObject = async ({
  bucket,
  key,
}: {
  bucket: string;
  key: string;
}) => {
  try {
    const result = await s3.getObject({ Bucket: bucket, Key: key }).promise();
    return result.Body;
  } catch (error: any) {
    if (error.code === 'NoSuchKey') {
      throw new Error(
        `Could not find object in s3 in bucket '${bucket}' with key '${key}'`,
      ); // throw more helpful error if we can
    }
    throw error; // otherwise throw orig error
  }
};
