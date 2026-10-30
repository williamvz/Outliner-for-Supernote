/**
 * Minimal MCP client over Streamable HTTP: initialize once per session, then
 * tools/call. Responses may be plain JSON or a short SSE stream.
 */

export class McpError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

export class UnauthorizedError extends McpError {}

const PROTOCOL_VERSION = '2025-06-18';

interface RpcResponse {
  jsonrpc: '2.0';
  id?: number;
  result?: any;
  error?: {code: number; message: string};
}

export class McpClient {
  private sessionId: string | null = null;
  private initialized = false;
  private nextId = 1;
  /** HTTP requests sent so far; the Worker budgets these per invocation. */
  requests = 0;

  constructor(
    private readonly url: string,
    private readonly accessToken: () => Promise<string>,
  ) {}

  async callTool<T = unknown>(name: string, args: Record<string, unknown>): Promise<T> {
    await this.ensureInitialized();
    const result = await this.rpc('tools/call', {name, arguments: args});
    return toolResult(result) as T;
  }

  async listTools(): Promise<string[]> {
    await this.ensureInitialized();
    const result = await this.rpc('tools/list', {});
    return (result?.tools ?? []).map((t: {name: string}) => t.name);
  }

  reset(): void {
    this.sessionId = null;
    this.initialized = false;
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) {
      return;
    }
    await this.rpc('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: {name: 'tana-supernote', version: '0.1.0'},
    });
    await this.send({jsonrpc: '2.0', method: 'notifications/initialized'});
    this.initialized = true;
  }

  private async rpc(method: string, params: unknown): Promise<any> {
    const id = this.nextId++;
    const res = await this.send({jsonrpc: '2.0', id, method, params});
    const body = parseRpcBody(res.headers.get('content-type') ?? '', await res.text(), id);
    if (body.error) {
      throw new McpError(`${method}: ${body.error.message} (${body.error.code})`);
    }
    return body.result;
  }

  private async send(message: object): Promise<Response> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${await this.accessToken()}`,
      'mcp-protocol-version': PROTOCOL_VERSION,
    };
    if (this.sessionId) {
      headers['mcp-session-id'] = this.sessionId;
    }
    this.requests++;
    const res = await fetch(this.url, {method: 'POST', headers, body: JSON.stringify(message)});
    if (res.status === 401) {
      throw new UnauthorizedError('Tana rejected the access token', 401);
    }
    if (res.status === 404 && this.sessionId) {
      this.reset();
      throw new McpError('MCP session expired', 404);
    }
    if (!res.ok && res.status !== 202) {
      throw new McpError(`MCP HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`, res.status);
    }
    const session = res.headers.get('mcp-session-id');
    if (session) {
      this.sessionId = session;
    }
    return res;
  }
}

export function parseRpcBody(contentType: string, text: string, id: number): RpcResponse {
  if (contentType.includes('text/event-stream')) {
    const messages = text
      .split(/\r?\n/)
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trim())
      .filter(Boolean)
      .map(data => JSON.parse(data) as RpcResponse);
    const match = messages.find(m => m.id === id);
    if (!match) {
      throw new McpError(`no response for request ${id} in event stream`);
    }
    return match;
  }
  return JSON.parse(text) as RpcResponse;
}

/** Prefer structured content; otherwise parse the first text block as JSON if possible. */
export function toolResult(result: any): unknown {
  if (result?.isError) {
    const message = result.content?.map((c: any) => c.text).join(' ') ?? 'tool error';
    throw new McpError(message);
  }
  if (result?.structuredContent !== undefined) {
    return result.structuredContent;
  }
  const text = result?.content?.find((c: any) => c.type === 'text')?.text;
  if (typeof text !== 'string') {
    return result;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
