import { getMseNow } from '../../utils/getMseNow';

/**
 * a utility function to decide whether a record is valid
 */
export const isRecordExpired = ({
  expiresAtMse,
}: {
  expiresAtMse: number | null;
}) => {
  // if expiresAtMse = null, then it never expires
  if (expiresAtMse === null) return false;

  // otherwise, check whether its expired
  return expiresAtMse < getMseNow();
};
