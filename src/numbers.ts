/**
 * SignUpGenius's APIs (both the key API's `myqty` and the public sheet
 * endpoint's `qty`/`qtyTaken`) have been observed returning a genuine number
 * when a count is non-zero, but the empty string `""` — not `0` — when it's
 * zero. Using such a value raw silently turns `+=` into string concatenation
 * ("0" + "2" = "02") instead of addition. Always coerce with this first.
 */
export function toCount(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}
