/**
 * read the `.code` string from an unknown thrown value, when present (e.g. 'ENOENT', 'EEXIST')
 *
 * .what = a typed accessor for an fs-error code; an `in` guard reads the code type-safely
 * .why = thrown values are `unknown`; the guard reads the code on the type system rather than
 *        a step past it with an `as` cast (forbid-as-cast)
 */
export const asErrorCode = (error: unknown): string | undefined => {
  if (typeof error !== 'object' || error === null) return undefined;
  if (!('code' in error)) return undefined;
  const { code } = error;
  return typeof code === 'string' ? code : undefined;
};
