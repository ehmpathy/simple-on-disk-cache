import { S3 } from 'aws-sdk';

const s3 = new S3();

export const putObject = async ({
  bucket,
  key,
  data,
}: {
  bucket: string;
  key: string;
  data: string;
}) => {
  return s3.putObject({ Bucket: bucket, Key: key, Body: data }).promise();
};
