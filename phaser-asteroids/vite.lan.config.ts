import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import { defineConfig, mergeConfig, type Plugin } from 'vite';
import base from './vite.config.ts';

// Opt-in LAN development only. The browser calls its own origin; only this server talks to workerd.
// Keep the ordinary config, production API selection and Worker CORS rules unchanged.
export default defineConfig(({ command, isPreview }) => {
  if (command !== 'serve' || isPreview) throw new Error('LAN config is for npm run dev:lan only.');
  let authority: string;
  const guard: Plugin = {
    name: 'lan-player-api-only',
    configResolved(config) {
      const host = config.server.host;
      const local = Object.values(networkInterfaces()).flat().some((nic) => nic?.address === host && !nic.internal);
      const privateV4 = typeof host === 'string' && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
      if (!local || !privateV4) throw new Error('Pass --host <this PC\'s private LAN IPv4 address>; wildcard/public binds are refused.');
      authority = `${host}:${config.server.port}`;
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const refuse = (status: number) => {
          res.writeHead(status, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
          res.end(status === 403 ? 'Forbidden' : 'Not found');
        };
        // Check BEFORE replacing Origin for the loopback upstream. Never grant a foreign site access.
        if (req.headers.host !== authority ||
            (req.headers.origin && req.headers.origin !== `http://${authority}`) ||
            req.headers['sec-fetch-site'] === 'cross-site') return refuse(403);
        let path: string;
        try { path = decodeURIComponent(new URL(req.url ?? '/', `http://${authority}`).pathname); }
        catch { return refuse(403); }
        // Defense in depth alongside fs.deny (including raw/@fs requests). Never serve backend code/state/secrets.
        if (/(^|[/\\])(server|\.git|\.wrangler)([/\\]|$)|(^|[/\\])\.(dev\.vars|env)/.test(path.toLowerCase())) return refuse(403);
        if (path.startsWith('/cdn-cgi') || path.startsWith('/__')) return refuse(404);
        if (path.startsWith('/api')) {
          const publicRoute = /^\/api\/v1\/(health|runs|runs\/[0-9a-f-]+\/submit|leaderboard\/(all-time|weekly)|scores\/[0-9a-f-]+)\/?$/.test(path);
          if (!publicRoute) return refuse(404);
        }
        next();
      });
    },
  };
  return mergeConfig(base, {
    plugins: [guard],
    // Explicitly overrides any .env build URL in this dev process only; ?api remains ignored on LAN hosts.
    define: { 'import.meta.env.VITE_LEADERBOARD_API_URL': 'window.location.origin' },
    server: {
      host: '127.0.0.1', // fails closed unless the operator supplies a specific private interface
      port: 5173,
      strictPort: true,
      cors: false,
      fs: {
        strict: true,
        allow: [fileURLToPath(new URL('.', import.meta.url))],
        deny: ['.env', '.env.*', '*.{crt,pem,key}', '**/.git/**', '**/server/**', '**/.wrangler/**', '**/.dev.vars*'],
      },
      proxy: {
        '^/api/v1/': {
          target: 'http://127.0.0.1:8788',
          changeOrigin: true,
          // The guard has already verified same-origin. Use an existing allowed loopback origin upstream.
          headers: { Origin: 'http://127.0.0.1:5173' },
        },
      },
    },
  });
});
