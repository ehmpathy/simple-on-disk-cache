/**
 * the physical source entry for a key, as read from the source store in ONE read
 *
 * .what = the opaque version of the entry (undefined when the version was not requested), the physical
 *         expiry (null = never expires, i.e. Infinity round-tripped through json), and the stored value
 *         (undefined for a tombstone or a corrupt envelope).
 * .why = a shared shape for the tier readers (getLocalSourceEntry / getCloudSourceEntry) and their
 *        dispatcher (getSourceEntry), so the three cannot drift on the read result shape.
 */
export type SourceEntry = {
  version: string | undefined;
  expiresAtMse: number | null;
  value: string | undefined;
};
