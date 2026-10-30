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
const SNAPSHOT_KEY = 'tasks.snapshot.v2';
const JOB_KEY = 'tasks.job';
const LAST_ERROR_KEY = 'tasks.lastError';
// Cloudflare's free plan allows 50 outbound requests per invocation. A
// snapshot needs one read per task and per area, so it is built over several
// alarm invocations. The margin covers a token refresh or MCP re-initialise.
const CALLS_PER_STEP = 35;
const JOB_STALE_MS = 5 * 60 * 1000;
const MAX_STEP_FAILURES = 3;

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
  stats: {found: number; steps: number; buildMs: number};
}

/** A snapshot being built, one batch of MCP calls per alarm. */
interface Job {
  today: string;
  workspaceId: string;
  startedAt: number;
  found: number;
  pending: SearchHit[];
  tasks: Task[];
  steps: number;
  lastStepRequests: number;
  failures: number;
  lastError: string | null;
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
    if (this.env.DEV_TANA_ACCESS_TOKEN) {
      return this.env.DEV_TANA_ACCESS_TOKEN;
    }
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

  /**
   * Serves the last complete snapshot right away and starts a background
   * refresh when it is missing, stale or ?fresh=1. Until the first snapshot
   * exists the list is empty and `refreshing` shows the progress.
   */
  private async tasks(url: URL) {
    const today = todayIn(this.env.TIMEZONE);
    const ws = await this.workspace();
    const stored = await this.ctx.storage.get<Snapshot>(SNAPSHOT_KEY);
    const snapshot = stored?.workspaceId === ws.workspaceId ? stored : null;
    const stale =
      !snapshot ||
      snapshot.today !== today ||
      Date.now() - Date.parse(snapshot.generatedAt) > SNAPSHOT_MAX_AGE_MS;
    if (stale || url.searchParams.get('fresh') === '1') {
      await this.startRefresh(today, ws);
    }
    const job = await this.ctx.storage.get<Job>(JOB_KEY);
    const view = url.searchParams.get('view') ?? 'all';
    const list = snapshot ? (view === 'today' ? todayView(snapshot.tasks, today) : snapshot.tasks) : [];
    return {
      generatedAt: snapshot?.generatedAt ?? null,
      today,
      view,
      refreshing: job ? progress(job) : null,
      count: list.length,
      tasks: list,
    };
  }

  private async startRefresh(today: string, ws: Workspace): Promise<void> {
    const running = await this.ctx.storage.get<Job>(JOB_KEY);
    if (running && Date.now() - running.startedAt < JOB_STALE_MS) {
      return;
    }
    const pending = await this.searchOpenTasks(ws.workspaceId, ws.taskTagId);
    const job: Job = {
      today,
      workspaceId: ws.workspaceId,
      startedAt: Date.now(),
      found: pending.length,
      pending,
      tasks: [],
      steps: 0,
      lastStepRequests: 0,
      failures: 0,
      lastError: null,
    };
    await this.ctx.storage.put(JOB_KEY, job);
    await this.ctx.storage.setAlarm(Date.now());
  }

  /** Each alarm is a fresh invocation with its own outbound-request budget. */
  async alarm(): Promise<void> {
    const job = await this.ctx.storage.get<Job>(JOB_KEY);
    if (!job) {
      return;
    }
    this.mcp ??= new McpClient(this.env.TANA_MCP_URL, () => this.accessToken());
    const before = this.mcp.requests;
    try {
      const done = await this.step(job);
      job.steps++;
      job.lastStepRequests = this.mcp.requests - before;
      if (done) {
        const snapshot: Snapshot = {
          generatedAt: new Date().toISOString(),
          today: job.today,
          workspaceId: job.workspaceId,
          tasks: job.tasks,
          stats: {found: job.found, steps: job.steps, buildMs: Date.now() - job.startedAt},
        };
        await this.ctx.storage.put(SNAPSHOT_KEY, snapshot);
        await this.ctx.storage.delete([JOB_KEY, LAST_ERROR_KEY]);
        return;
      }
      await this.ctx.storage.put(JOB_KEY, job);
      await this.ctx.storage.setAlarm(Date.now());
    } catch (e) {
      job.failures++;
      job.lastError = e instanceof Error ? e.message : String(e);
      if (e instanceof ReauthRequired || job.failures >= MAX_STEP_FAILURES) {
        await this.ctx.storage.put(LAST_ERROR_KEY, {at: new Date().toISOString(), error: job.lastError});
        await this.ctx.storage.delete(JOB_KEY);
        return;
      }
      await this.ctx.storage.put(JOB_KEY, job);
      await this.ctx.storage.setAlarm(Date.now() + 30_000);
    }
  }

  /** Reads up to CALLS_PER_STEP task nodes, then resolves domains. True when finished. */
  private async step(job: Job): Promise<boolean> {
    let budget = CALLS_PER_STEP;
    if (job.pending.length) {
      const batch = job.pending.slice(0, budget);
      const read = await mapLimit(batch, READ_CONCURRENCY, async hit => {
        const node = await this.readNode(hit.id);
        return node.checked === true
          ? null
          : taskFromNode(node, hit.id, hit.breadcrumb ?? [], job.today, this.env.RECURRING_TAG);
      });
      job.pending = job.pending.slice(batch.length);
      job.tasks.push(...read.filter((t): t is Task => t !== null));
      budget -= batch.length;
      if (job.pending.length) {
        return false;
      }
    }
    return this.resolveDomains(job.tasks, budget);
  }

  private async readNode(nodeId: string) {
    const res = await this.withMcp(m =>
      m.callTool<{markdown: string}>('read_node', {nodeId, maxDepth: 1}),
    );
    return parseNodeMarkdown(typeof res === 'string' ? res : res.markdown);
  }

  /**
   * task → area or project → (project's Parent Area) → area's Domain, cached
   * for a day. Reads at most `budget` nodes; returns false when some parents
   * still need reading.
   */
  private async resolveDomains(tasks: Task[], budget: number): Promise<boolean> {
    const cache = (await this.ctx.storage.get<DomainCache>('domains')) ?? {};
    const fresh = (id: string) => cache[id] && Date.now() - cache[id].at < DOMAIN_MAX_AGE_MS;
    let reads = 0;
    let complete = true;

    // undefined = not resolved within the budget
    const domainOf = async (id: string, depth = 0): Promise<string | null | undefined> => {
      if (fresh(id)) {
        return cache[id].domain;
      }
      if (reads >= budget) {
        complete = false;
        return undefined;
      }
      reads++;
      const node = await this.readNode(id);
      let domain: string | null | undefined = node.fields[FIELDS.domain]?.refs[0]?.name ?? null;
      const parentArea = node.fields[FIELDS.parentArea]?.refs[0]?.id;
      if (!domain && parentArea && depth < 2) {
        domain = await domainOf(parentArea, depth + 1);
        if (domain === undefined) {
          return undefined;
        }
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
    return complete;
  }

  // ---- Spike helpers -----------------------------------------------------

  private async health() {
    const tokens = await this.ctx.storage.get<Tokens>('oauth.tokens');
    const snapshot = await this.ctx.storage.get<Snapshot>(SNAPSHOT_KEY);
    const ws = await this.ctx.storage.get<Workspace>(WORKSPACE_KEY);
    const job = await this.ctx.storage.get<Job>(JOB_KEY);
    return {
      ok: true,
      tana: tokens ? 'linked' : 'not linked',
      workspace: ws?.workspaceName ?? null,
      snapshotAgeSeconds: snapshot
        ? Math.round((Date.now() - Date.parse(snapshot.generatedAt)) / 1000)
        : null,
      refreshing: job ? progress(job) : null,
      lastError: (await this.ctx.storage.get(LAST_ERROR_KEY)) ?? null,
    };
  }

  private async saveReport(request: Request) {
    const reports = (await this.ctx.storage.get<unknown[]>('spike.reports')) ?? [];
    reports.unshift({receivedAt: new Date().toISOString(), report: await request.json()});
    await this.ctx.storage.put('spike.reports', reports.slice(0, 10));
    return {ok: true};
  }

  /** Summary of the current snapshot; GET /tasks?fresh=1 starts a rebuild. */
  private async diagnostics() {
    const t0 = Date.now();
    const tools = await this.withMcp(m => m.listTools());
    const t1 = Date.now();
    const ws = await this.workspace();
    const snapshot = await this.ctx.storage.get<Snapshot>(SNAPSHOT_KEY);
    const job = await this.ctx.storage.get<Job>(JOB_KEY);
    const today = todayIn(this.env.TIMEZONE);
    return {
      tools: tools.length,
      listToolsMs: t1 - t0,
      workspace: ws.workspaceName,
      refreshing: job ? progress(job) : null,
      lastError: (await this.ctx.storage.get(LAST_ERROR_KEY)) ?? null,
      snapshot: snapshot
        ? {
            generatedAt: snapshot.generatedAt,
            tasks: snapshot.tasks.length,
            recurring: snapshot.tasks.filter(t => t.recurring).length,
            withDeadline: snapshot.tasks.filter(t => t.deadline).length,
            withPriority: snapshot.tasks.filter(t => t.priority).length,
            someday: snapshot.tasks.filter(t => t.someday).length,
            home: snapshot.tasks.filter(t => t.domain === 'Home').length,
            work: snapshot.tasks.filter(t => t.domain === 'Work').length,
            noDomain: snapshot.tasks.filter(t => !t.domain).length,
            onDayNode: snapshot.tasks.filter(t => t.onDayNode).length,
            today: todayView(snapshot.tasks, today).length,
            ...snapshot.stats,
          }
        : null,
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

function progress(job: Job) {
  return {
    read: job.found - job.pending.length,
    of: job.found,
    steps: job.steps,
    lastStepRequests: job.lastStepRequests,
    failures: job.failures,
    lastError: job.lastError,
  };
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
