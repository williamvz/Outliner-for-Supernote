// Stand-in for Tana's hosted MCP server, for testing the Worker locally:
// 130 tasks in a "Main" workspace and 16 in a "Demo" one, with areas,
// projects and Home/Work domains, answered in read_node's Markdown format.
//
//   node scripts/mock-mcp.mjs
//   npx wrangler dev --var TANA_MCP_URL:http://127.0.0.1:8788/mcp \
//     --var DEV_TANA_ACCESS_TOKEN:dev --var DEVICE_TOKEN_HASH:<sha256 of a test passphrase>
import http from 'node:http';

const DEADLINES = ['Today', 'Tomorrow', 'Yesterday', 'Tue, 27 Oct', 'Sun, 3 Aug 2025', null];
const PRIORITIES = ['P1 - NOW', 'P2 - Leverage', 'P3 - Neutral', 'P4 - Overhead'];
const now = new Date();
const TODAY_LABEL = `Today, ${now.toLocaleDateString('en-GB', {weekday: 'short', day: 'numeric', month: 'short'})}`;
const YEAR = String(now.getFullYear());
let requests = 0;
const toolCounts = {};

function workspaceTasks(ws) {
  const n = ws === 'ws-main' ? 130 : 16;
  return Array.from({length: n}, (_, i) => ({
    id: `${ws}-t${i}`,
    name: `Task ${i}`,
    breadcrumb: i % 5 === 0 ? ['Home', 'Daily notes', YEAR, 'Week 1', TODAY_LABEL] : ['Home', 'Projects'],
    tags: [{id: 'tag-task', name: 'task'}],
    docType: 'content',
    inTrash: false,
  }));
}

function readNode(id) {
  let m;
  if ((m = /-t(\d+)$/.exec(id))) {
    const i = +m[1];
    const tags = i % 13 === 0 ? '#recurring_task' : '#task';
    const lines = [`- [ ] Task ${i} ${tags} <!-- node-id: ${id} -->`];
    const parent = i % 3 === 0 ? `[Project ${i % 4} #project](tana:proj-${i % 4})` : `[Area ${i % 8} #area](tana:area-${i % 8})`;
    lines.push(`  - **Parent area or Project**: ${parent}`);
    const d = DEADLINES[i % DEADLINES.length];
    if (d) lines.push(`  - **Deadline Date**: ${d} <!-- node-id: d${i} -->`);
    lines.push(`  - **Priority**: [${PRIORITIES[i % 4]}](tana:p${i % 4})`);
    return lines.join('\n') + '\n';
  }
  if ((m = /^area-(\d+)$/.exec(id))) {
    const k = +m[1];
    return `- Area ${k} #area <!-- node-id: ${id} -->\n  - **Domain**: [${k % 2 ? 'Work' : 'Home'} #domain](tana:dom-${k % 2})\n`;
  }
  if ((m = /^proj-(\d+)$/.exec(id))) {
    const k = +m[1];
    return `- Project ${k} #project <!-- node-id: ${id} -->\n  - **Parent Area**: [Area ${k} #area](tana:area-${k})\n`;
  }
  return `- Unknown <!-- node-id: ${id} -->\n`;
}

function callTool(name, args) {
  toolCounts[name] = (toolCounts[name] ?? 0) + 1;
  switch (name) {
    case 'list_workspaces':
      return [{id: 'ws-demo', name: 'Demo'}, {id: 'ws-main', name: 'Main'}];
    case 'list_tags':
      return [{id: args.workspaceId === 'ws-main' ? 'tag-task' : 'tag-task-demo', name: 'task'}];
    case 'search_nodes':
      return workspaceTasks(args.workspaceIds[0]);
    case 'read_node':
      return {markdown: readNode(args.nodeId), hasAttachments: false};
    default:
      return {ok: true};
  }
}

http
  .createServer((req, res) => {
    if (req.url === '/stats') {
      res.end(JSON.stringify({requests, toolCounts}));
      return;
    }
    let body = '';
    req.on('data', c => (body += c));
    req.on('end', () => {
      requests++;
      if (req.headers.authorization !== 'Bearer dev') {
        res.writeHead(401).end();
        return;
      }
      const msg = JSON.parse(body);
      if (!('id' in msg)) {
        res.writeHead(202).end();
        return;
      }
      let result;
      if (msg.method === 'initialize') {
        result = {protocolVersion: '2025-06-18', capabilities: {tools: {}}, serverInfo: {name: 'mock', version: '0'}};
      } else if (msg.method === 'tools/list') {
        result = {tools: ['list_workspaces', 'list_tags', 'search_nodes', 'read_node'].map(name => ({name}))};
      } else {
        result = {content: [{type: 'text', text: JSON.stringify(callTool(msg.params.name, msg.params.arguments))}]};
      }
      const payload = JSON.stringify({jsonrpc: '2.0', id: msg.id, result});
      // Answer tool calls as an event stream, like a Streamable HTTP server may.
      if (msg.method === 'tools/call') {
        res.writeHead(200, {'content-type': 'text/event-stream', 'mcp-session-id': 'mock-session'});
        res.end(`event: message\ndata: ${payload}\n\n`);
      } else {
        res.writeHead(200, {'content-type': 'application/json', 'mcp-session-id': 'mock-session'});
        res.end(payload);
      }
    });
  })
  .listen(8788, '127.0.0.1', () => console.log('mock MCP on 8788'));
