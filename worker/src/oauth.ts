/**
 * OAuth 2.1 for Tana's hosted MCP: discovery, dynamic client registration,
 * PKCE authorization code flow and refresh. Tana registers public clients
 * (token_endpoint_auth_method "none"), so there is no client secret.
 */

export interface ServerMetadata {
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
}

export interface RegisteredClient {
  client_id: string;
  redirect_uri: string;
}

export interface Tokens {
  access_token: string;
  refresh_token: string | null;
  expires_at: number;
}

export class ReauthRequired extends Error {}

export async function discover(issuer: string): Promise<ServerMetadata> {
  const res = await fetch(`${issuer}/.well-known/oauth-authorization-server`);
  if (!res.ok) {
    throw new Error(`OAuth discovery failed: HTTP ${res.status}`);
  }
  return res.json();
}

export async function registerClient(
  meta: ServerMetadata,
  redirectUri: string,
): Promise<RegisteredClient> {
  if (!meta.registration_endpoint) {
    throw new Error('Tana does not offer dynamic client registration');
  }
  const res = await fetch(meta.registration_endpoint, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({
      client_name: 'Tana Sync for Supernote',
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }),
  });
  if (!res.ok) {
    throw new Error(`client registration failed: HTTP ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as {client_id: string};
  return {client_id: body.client_id, redirect_uri: redirectUri};
}

export function randomToken(bytes = 32): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

export function authorizeUrl(
  meta: ServerMetadata,
  client: RegisteredClient,
  state: string,
  challenge: string,
  resource: string,
): string {
  const url = new URL(meta.authorization_endpoint);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: client.client_id,
    redirect_uri: client.redirect_uri,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    resource,
  }).toString();
  return url.toString();
}

export async function exchangeCode(
  meta: ServerMetadata,
  client: RegisteredClient,
  code: string,
  verifier: string,
  resource: string,
): Promise<Tokens> {
  return tokenRequest(meta, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: client.redirect_uri,
    client_id: client.client_id,
    code_verifier: verifier,
    resource,
  });
}

export async function refresh(
  meta: ServerMetadata,
  client: RegisteredClient,
  refreshToken: string,
  resource: string,
): Promise<Tokens> {
  const tokens = await tokenRequest(meta, {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: client.client_id,
    resource,
  });
  return {...tokens, refresh_token: tokens.refresh_token ?? refreshToken};
}

async function tokenRequest(
  meta: ServerMetadata,
  params: Record<string, string>,
): Promise<Tokens> {
  const res = await fetch(meta.token_endpoint, {
    method: 'POST',
    headers: {'content-type': 'application/x-www-form-urlencoded'},
    body: new URLSearchParams(params).toString(),
  });
  if (res.status === 400 || res.status === 401) {
    throw new ReauthRequired(`token request rejected: ${await res.text()}`);
  }
  if (!res.ok) {
    throw new Error(`token request failed: HTTP ${res.status}`);
  }
  const body = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };
  return {
    access_token: body.access_token,
    refresh_token: body.refresh_token ?? null,
    expires_at: Date.now() + (body.expires_in ?? 3600) * 1000,
  };
}

function base64url(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach(b => (binary += String.fromCharCode(b)));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
