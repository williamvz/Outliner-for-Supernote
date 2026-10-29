import {describe, expect, it} from 'vitest';
import {isAuthorized, sha256Hex} from '../src/auth';
import {McpError, parseRpcBody, toolResult} from '../src/mcp';

describe('parseRpcBody', () => {
  it('reads plain JSON responses', () => {
    expect(parseRpcBody('application/json', '{"jsonrpc":"2.0","id":3,"result":{"a":1}}', 3).result).toEqual({a: 1});
  });

  it('picks the matching response out of an event stream', () => {
    const sse = [
      'event: message',
      'data: {"jsonrpc":"2.0","method":"notifications/progress","params":{}}',
      '',
      'event: message',
      'data: {"jsonrpc":"2.0","id":7,"result":{"ok":true}}',
      '',
    ].join('\n');
    expect(parseRpcBody('text/event-stream', sse, 7).result).toEqual({ok: true});
  });
});

describe('toolResult', () => {
  it('prefers structured content, then JSON text, then raw text', () => {
    expect(toolResult({structuredContent: {x: 1}, content: []})).toEqual({x: 1});
    expect(toolResult({content: [{type: 'text', text: '[{"id":"a"}]'}]})).toEqual([{id: 'a'}]);
    expect(toolResult({content: [{type: 'text', text: 'Imported 1 node'}]})).toBe('Imported 1 node');
  });

  it('throws on tool errors', () => {
    expect(() => toolResult({isError: true, content: [{type: 'text', text: 'nope'}]})).toThrow(McpError);
  });
});

describe('isAuthorized', () => {
  it('accepts the bearer passphrase whose hash is configured', async () => {
    const hash = await sha256Hex('correct horse battery staple');
    const ok = new Request('https://w.example/tasks', {headers: {authorization: 'Bearer correct horse battery staple'}});
    const bad = new Request('https://w.example/tasks', {headers: {authorization: 'Bearer wrong'}});
    const query = new Request(`https://w.example/oauth/start?token=${encodeURIComponent('correct horse battery staple')}`);
    expect(await isAuthorized(ok, hash)).toBe(true);
    expect(await isAuthorized(bad, hash)).toBe(false);
    expect(await isAuthorized(query, hash)).toBe(true);
    expect(await isAuthorized(ok, '')).toBe(false);
  });
});
