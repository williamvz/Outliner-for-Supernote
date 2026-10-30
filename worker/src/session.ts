import {DurableObject} from 'cloudflare:workers';
import {todayIn} from './dates';
import type {Env} from './env';
import {parseNodeMarkdown} from './markdown';
import {McpClient, McpError, UnauthorizedError} from './mcp';
import {
  authorizeUrl,
  discover,
  exchangeCode,
  pkceChallenge,
  randomToken,
  ReauthRequired,
  refresh,
  registerClient,
  type RegisteredClient,
  type ServerMetadata,
  type Tokens,
} from './oauth';
import {FIELDS, taskFromNode, todayView, type Task} from './tasks';

const SNAPSHOT_MAX_AGE_MS = 10 * 60 * 1000;
const DOMAIN_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const READ_CONCURRENCY = 6;
// v2: v1 cached the first workspace with a #task tag, which can be the wrong one.
const WORKSPACE_KEY = 'tana.workspace.v2';

interface Pending {
  state: string;
  verifier: string;
  at: number;
}

interface Workspace {
  workspaceId: string;
  workspaceName: string;
  taskTagId: string;
}

interface Snapshot {
  generatedAt: string;
  today: string;
  workspaceId: string;
  tasks: Task[];
  stats: {searchMs: number; readMs: number; domainMs: number; found: number};
}

interface SearchHit {
  id: string;
  name: string;
  breadcrumb?: string[];
  docType?: string;
  inTrash?: boolean;
}

type DomainCache = Record<string, {domain: string | null; at: number}>;

/**
 * One instance ("main") owns the Tana OAuth tokens and the MCP session, so
 * token refreshes never race, plus the cached task snapshot.
 */
export class TanaSession extends DurableObject<Env> {
  private meta: ServerMetadata | null = null;
  private mcp: McpClient | null = null;
  private refreshing: Promise<string> | null = null;

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    try {
      switch (`${request.method} ${url.pathname}`) {
        case 'GET /health':
          return json(await this.health());
        case 'GET /oauth/start':
          return await this.startOAuth(url);
        case 'GET /oauth/callback':
          return await this.finishOAuth(url);
        case 'GET /tasks':
          return json(await this.tasks(url));
        case 'POST /spike/report':
          return json(await this.saveReport(request));
        case 'GET /spike/report':
          return json((await this.ctx.storage.get('spike.reports')) ?? []);
        case 'GET /spike/mcp':
          return json(await this.diagnostics());
        case 'POST /spike/import-test':
          return json(await this.importTest());
        default:
          return json({error: 'not found'}, 404);
      }
    } catch (e) {
      if (e instanceof ReauthRequired) {
        return json({error: e.message, reauth: true}, 503);
      }
      return json({error: e instanceof Error ? e.message : String(e)}, 500);
    }
  }

  // ---- Tana link (OAuth) ------------------------------------------------

  private async metadata(): Promise<ServerMetadata> {
    this.meta ??= await discover(this.env.TANA_ISSUER);
    return this.meta;
  }

  private async startOAuth(url: URL): Promise<Response> {
    const meta = await this.metadata();
    const redirectUri = `${url.origin}/oauth/callback`;
    let client = await this.ctx.storage.get<RegisteredClient>('oauth.client');
    if (!client || client.redirect_uri !== redirectUri) {
      client = await registerClient(meta, redirectUri);
      await this.ctx.storage.put('oauth.client', client);
    }
    const pending: Pending = {state: randomToken(16), verifier: randomToken(48), at: Date.now()};
    await this.ctx.storage.put('oauth.pending', pending);
    const target = authorizeUrl(
      meta,
      client,
      pending.state,
      await pkceChallenge(pending.verifier),
      this.env.TANA_MCP_URL,
    );
    return Response.redirect(target, 302);
  }

  private async finishOAuth(url: URL): Promise<Response> {
    const error = url.searchParams.get('error');
    if (error) {
      return page(`Tana said no: ${error}`, 400);
    }
    const pending = await this.ctx.storage.get<Pending>('oauth.pending');
    const client = await this.ctx.storage.get<RegisteredClient>('oauth.client');
    const code = url.searchParams.get('code');
    if (
      !pending ||
      !client ||
      !code ||
      url.searchParams.get('state') !== pending.state ||
      Date.now() - pending.at > 15 * 60 * 1000
    ) {
      return page('This link expired. Open /oauth/start again.', 400);
    }
    const tokens = await exchangeCode(
      await this.metadata(),
      client,
      code,
      pending.verifier,
      this.env.TANA_MCP_URL,
    );
    await this.ctx.storage.put('oauth.tokens', tokens);
    await this.ctx.storage.delete('oauth.pending');
    this.mcp = null;
    return page('Tana is linked. You can close this tab.');
  }

  private async accessToken(): Promise<string> {
    const tokens = await this.ctx.storage.get<Tokens>('oauth.tokens');
    if (!tokens) {
      throw new ReauthRequired('Tana is not linked yet: open /oauth/start');
    }
    if (tokens.expires_at - 60_000 > Date.now()) {
      return tokens.access_token;
    }
    this.refreshing ??= this.refreshTokens(tokens).finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async refreshTokens(tokens: Tokens): Promise<string> {
    const client = await this.ctx.storage.get<RegisteredClient>('oauth.client');
    if (!tokens.refresh_token || !client) {
      throw new ReauthRequired('Tana session expired: open /oauth/start');
    }
    const next = await refresh(await this.metadata(), client, tokens.refresh_token, this.env.TANA_MCP_URL);
    await this.ctx.storage.put('oauth.tokens', next);
    return next.access_token;
  }

  /** Runs an MCP call, refreshing the token or the session once if needed. */
  private async withMcp<T>(fn: (mcp: McpClient) => Promise<T>): Promise<T> {
    this.mcp ??= new McpClient(this.env.TANA_MCP_URL, () => this.accessToken());
    try {
      return await fn(this.mcp);
    } catch (e) {
      if (e instanceof UnauthorizedError) {
        const tokens = await this.ctx.storage.get<Tokens>('oauth.tokens');
        if (tokens) {
          await this.ctx.storage.put('oauth.tokens', {...tokens, expires_at: 0});
        }
        this.mcp.reset();
        return fn(this.mcp);
      }
      if (e instanceof McpError && e.status === 404) {
        return fn(this.mcp);
      }
      throw e;
    }
  }

  // ---- Tasks -------------------------------------------------------------

  /**
   * The workspace whose #task tag has the most open tasks, unless
   * TANA_WORKSPACE_ID pins one. Several workspaces can have a #task tag
   * (e.g. a sample workspace), so the first match is not good enough.
   */
  private async workspace(): Promise<Workspace> {
    const cached = await this.ctx.storage.get<Workspace>(WORKSPACE_KEY);
    if (cached) {
      return cached;
    }
    const wanted = this.env.TASK_TAG.toLowerCase();
    const all = await this.withMcp(m =>
      m.callTool<Array<{id: string; name: string}>>('list_workspaces', {}),
    );
    const pinned = this.env.TANA_WORKSPACE_ID;
    const candidates = pinned
      ? [all.find(w => w.id === pinned) ?? {id: pinned, name: pinned}]
      : all;

    let best: {ws: Workspace; open: number} | null = null;
    for (const candidate of candidates) {
      const tags = await this.withMcp(m =>
        m.callTool<Array<{id: string; name: string}>>('list_tags', {
          workspaceId: candidate.id,
          limit: 500,
        }),
      );
      const tag = tags.find(t => t.name.toLowerCase() === wanted);
      if (!tag) {
        continue;
      }
      const open = (await this.searchOpenTasks(candidate.id, tag.id)).length;
      if (!best || open > best.open) {
        best = {
          ws: {workspaceId: candidate.id, workspaceName: candidate.name, taskTagId: tag.id},
          open,
        };
      }
    }
    if (!best) {
      throw new Error(`no workspace has a #${this.env.TASK_TAG} tag`);
    }
    await this.ctx.storage.put(WORKSPACE_KEY, best.ws);
    return best.ws;
  }

  private async searchOpenTasks(workspaceId: string, taskTagId: string): Promise<SearchHit[]> {
    const found = await this.withMcp(m =>
      m.callTool<SearchHit[]>('search_nodes', {
        query: {and: [{hasType: taskTagId}, {not: {is: 'done'}}]},
        workspaceIds: [workspaceId],
        limit: 1000,
      }),
    );
    return found.filter(h => (h.docType ?? 'content') === 'content' && !h.inTrash);
  }

  private async tasks(url: URL) {
    const today = todayIn(this.env.TIMEZONE);
    let snapshot = await this.ctx.storage.get<Snapshot>('tasks.snapshot');
    const {workspaceId} = await this.workspace();
    const stale =
      !snapshot ||
      snapshot.workspaceId !== workspaceId ||
      snapshot.today !== today ||
      Date.now() - Date.parse(snapshot.generatedAt) > SNAPSHOT_MAX_AGE_MS;
    if (stale || url.searchParams.get('fresh') === '1') {
      snapshot = await this.buildSnapshot(today);
    }
    const view = url.searchParams.get('view') ?? 'all';
    const tasks = view === 'today' ? todayView(snapshot!.tasks, today) : snapshot!.tasks;
    return {generatedAt: snapshot!.generatedAt, today, view, count: tasks.length, tasks};
  }

  private async buildSnapshot(today: string): Promise<Snapshot> {
    const {workspaceId, taskTagId} = await this.workspace();
    const t0 = Date.now();
    const hits = await this.searchOpenTasks(workspaceId, taskTagId);
    const t1 = Date.now();
    const tasks = (
      await mapLimit(hits, READ_CONCURRENCY, async hit => {
        const node = await this.readNode(hit.id);
        return node.checked === true
          ? null
          : taskFromNode(node, hit.id, hit.breadcrumb ?? [], today, this.env.RECURRING_TAG);
      })
    ).filter((t): t is Task => t !== null);
    const t2 = Date.now();
    await this.resolveDomains(tasks);
    const snapshot: Snapshot = {
      generatedAt: new Date().toISOString(),
      today,
      workspaceId,
      tasks,
      stats: {searchMs: t1 - t0, readMs: t2 - t1, domainMs: Date.now() - t2, found: hits.length},
    };
    await this.ctx.storage.put('tasks.snapshot', snapshot);
    return snapshot;
  }

  private async readNode(nodeId: string) {
    const res = await this.withMcp(m =>
      m.callTool<{markdown: string}>('read_node', {nodeId, maxDepth: 1}),
    );
    return parseNodeMarkdown(typeof res === 'string' ? res : res.markdown);
  }

  /** task → area or project → (project's Parent Area) → area's Domain. */
  private async resolveDomains(tasks: Task[]): Promise<void> {
    const cache = (await this.ctx.storage.get<DomainCache>('domains')) ?? {};
    const fresh = (id: string) => cache[id] && Date.now() - cache[id].at < DOMAIN_MAX_AGE_MS;

    const domainOf = async (id: string, depth = 0): Promise<string | null> => {
      if (fresh(id)) {
        return cache[id].domain;
      }
      const node = await this.readNode(id);
      let domain: string | null = node.fields[FIELDS.domain]?.refs[0]?.name ?? null;
      const parentArea = node.fields[FIELDS.parentArea]?.refs[0]?.id;
      if (!domain && parentArea && depth < 2) {
        domain = await domainOf(parentArea, depth + 1);
      }
      cache[id] = {domain, at: Date.now()};
      return domain;
    };

    const parents = [...new Set(tasks.map(t => t.parentId).filter((id): id is string => !!id))];
    await mapLimit(parents, READ_CONCURRENCY, id => domainOf(id));
    for (const task of tasks) {
      task.domain = task.parentId ? cache[task.parentId]?.domain ?? null : null;
    }
    await this.ctx.storage.put('domains', cache);
  }

  // ---- Spike helpers -----------------------------------------------------

  private async health() {
    const tokens = await this.ctx.storage.get<Tokens>('oauth.tokens');
    const snapshot = await this.ctx.storage.get<Snapshot>('tasks.snapshot');
    const ws = await this.ctx.storage.get<Workspace>(WORKSPACE_KEY);
    return {
      ok: true,
      tana: tokens ? 'linked' : 'not linked',
      workspace: ws?.workspaceName ?? null,
      snapshotAgeSeconds: snapshot
        ? Math.round((Date.now() - Date.parse(snapshot.generatedAt)) / 1000)
        : null,
    };
  }

  private async saveReport(request: Request) {
    const reports = (await this.ctx.storage.get<unknown[]>('spike.reports')) ?? [];
    reports.unshift({receivedAt: new Date().toISOString(), report: await request.json()});
    await this.ctx.storage.put('spike.reports', reports.slice(0, 10));
    return {ok: true};
  }

  private async diagnostics() {
    const t0 = Date.now();
    const tools = await this.withMcp(m => m.listTools());
    const t1 = Date.now();
    const ws = await this.workspace();
    const snapshot = await this.buildSnapshot(todayIn(this.env.TIMEZONE));
    return {
      tools,
      listToolsMs: t1 - t0,
      workspace: ws.workspaceName,
      snapshot: {
        tasks: snapshot.tasks.length,
        recurring: snapshot.tasks.filter(t => t.recurring).length,
        withDeadline: snapshot.tasks.filter(t => t.deadline).length,
        withDomain: snapshot.tasks.filter(t => t.domain).length,
        today: todayView(snapshot.tasks, snapshot.today).length,
        ...snapshot.stats,
      },
    };
  }

  /** Spike Q7: what does import_tana_paste return on the hosted MCP? */
  private async importTest() {
    const today = todayIn(this.env.TIMEZONE);
    const {workspaceId} = await this.workspace();
    const day = await this.withMcp(m =>
      m.callTool<unknown>('get_or_create_calendar_node', {workspaceId, granularity: 'day', date: today}),
    );
    const dayId =
      typeof day === 'string'
        ? (/[A-Za-z0-9_-]{8,}/.exec(day)?.[0] ?? day)
        : ((day as {nodeId?: string; id?: string}).nodeId ?? (day as {id?: string}).id);
    if (!dayId) {
      return {day, error: 'could not read the day node id'};
    }
    const result = await this.withMcp(m =>
      m.callTool<unknown>('import_tana_paste', {
        parentNodeId: dayId,
        content: '- Supernote sync test (safe to delete)',
        idempotencyKey: `supernote-spike-${today}`,
      }),
    );
    return {day, dayId, importResult: result};
  }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({length: Math.min(limit, items.length)}, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {'content-type': 'application/json; charset=utf-8'},
  });
}

function page(message: string, status = 200): Response {
  const html = `<!doctype html><meta name="viewport" content="width=device-width"><title>Tana Sync</title><body style="font:20px system-ui;padding:24px">${message}</body>`;
  return new Response(html, {status, headers: {'content-type': 'text/html; charset=utf-8'}});
}
