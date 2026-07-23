/**
 * read the class name of an unknown thrown value's constructor, when present
 *
 * .what = a typed accessor for `error.constructor.name`; a typeof guard reads it type-safely
 * .why = detects a cloud sdk's decided error class by name — no `as` cast (forbid-as-cast) and
 *        no `instanceof Error` guard (which can fail under the jest/swc realm and hide the signal)
 */
export const asErrorClassName = (error: unknown): string | undefined => {
  if (typeof error !== 'object' || error === null) return undefined;
  return error.constructor?.name;
};
