/**
 * decide whether a thrown error signals a malformed (corrupt) cache envelope
 *
 * .what = true when a JSON.parse rejected the raw bytes as unparseable json
 * .why = a corrupt envelope is a known-degraded state we treat as logically absent. we accept
 *        two signals of it (either suffices): the robust `SyntaxError` instance check, and a
 *        cross-realm `constructor.name` check (some realms — e.g. jest/swc — construct a
 *        SyntaxError whose prototype fails the instanceof yet keeps the class name). we do NOT
 *        test v8's parse-error message text: that string drifts across node versions and would
 *        silently stop to detect corruption on an upgrade. every other error is a real defect
 *        and must fail loud.
 */
export const isCorruptEnvelopeError = (error: unknown): boolean =>
  error instanceof SyntaxError ||
  (typeof error === 'object' &&
    error !== null &&
    error.constructor?.name === 'SyntaxError');
