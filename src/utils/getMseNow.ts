/**
 * the current wall-clock time in milliseconds since epoch
 *
 * .why = one shared clock accessor, so expiry math and lock deadlines read the same source
 */
export const getMseNow = (): number => new Date().getTime();
