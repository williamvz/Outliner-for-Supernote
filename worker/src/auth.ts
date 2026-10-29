export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The device sends its passphrase as a bearer token. The one-time Tana link
 * page is opened in a browser, so it may carry the passphrase as ?token=.
 */
export async function isAuthorized(request: Request, expectedHash: string): Promise<boolean> {
  if (!expectedHash) {
    return false;
  }
  const header = request.headers.get('authorization') ?? '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
  const token = bearer || new URL(request.url).searchParams.get('token') || '';
  if (!token) {
    return false;
  }
  const actual = new TextEncoder().encode(await sha256Hex(token));
  const expected = new TextEncoder().encode(expectedHash.toLowerCase());
  return actual.byteLength === expected.byteLength && timingSafeEqual(actual, expected);
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}
