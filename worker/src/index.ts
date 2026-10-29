import {isAuthorized} from './auth';
import type {Env} from './env';

export {TanaSession} from './session';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/') {
      return new Response('Tana Sync for Supernote\n');
    }
    // Tana redirects the browser here; the OAuth state check protects it.
    const open = url.pathname === '/oauth/callback';
    if (!open && !(await isAuthorized(request, env.DEVICE_TOKEN_HASH))) {
      return new Response(JSON.stringify({error: 'unauthorized'}), {
        status: 401,
        headers: {'content-type': 'application/json'},
      });
    }
    return env.SESSION.get(env.SESSION.idFromName('main')).fetch(request);
  },
} satisfies ExportedHandler<Env>;
