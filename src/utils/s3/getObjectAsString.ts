import { getObject } from './getObject';

export const getObjectAsString = async ({
  bucket,
  key,
}: {
  bucket: string;
  key: string;
}) => {
  const body = await getObject({ bucket, key });
  const content = body instanceof Buffer ? body.toString() : body; // cast from buffer if needed
  if (typeof content !== 'string')
    throw new Error('can not get object as json, object is not string');
  return content;
};
