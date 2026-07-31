import { timingSafeEqual } from "node:crypto";

/** Constant-time bearer-token comparison for private monitoring endpoints. */
export function hasValidBearerToken(request: Request, expectedToken: string): boolean {
  if (!expectedToken) return false;

  const supplied = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${expectedToken}`;
  const suppliedBytes = Buffer.from(supplied);
  const expectedBytes = Buffer.from(expected);

  return (
    suppliedBytes.length === expectedBytes.length &&
    timingSafeEqual(suppliedBytes, expectedBytes)
  );
}
