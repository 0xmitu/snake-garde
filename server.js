import { createServer as createHttpServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Deliberately expose only the game's assets, never the project directory.
const publicDirectory = new URL('./public/', import.meta.url);
const routes = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/engine.js', ['engine.js', 'text/javascript; charset=utf-8']],
  ['/favicon.svg', ['favicon.svg', 'image/svg+xml']],
]);

const securityHeaders = {
  'Content-Security-Policy': [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self'",
    "font-src 'self'",
    "connect-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Cache-Control': 'no-cache',
};

function reply(request, response, status, content, type = 'text/plain; charset=utf-8', extraHeaders = {}) {
  response.writeHead(status, {
    ...securityHeaders,
    'Content-Type': type,
    'Content-Length': Buffer.byteLength(content),
    ...extraHeaders,
  });
  response.end(request.method === 'HEAD' ? undefined : content);
}

async function handleRequest(request, response) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    reply(request, response, 405, 'Method not allowed\n', undefined, { Allow: 'GET, HEAD' });
    return;
  }

  let pathname;
  try {
    // Do not normalize dot segments: a traversal request must not resolve to a
    // permitted route. Queries are harmless and never become filesystem paths.
    pathname = decodeURIComponent((request.url ?? '').split('?')[0]);
  } catch {
    reply(request, response, 400, 'Bad request\n');
    return;
  }

  const asset = routes.get(pathname);
  if (!asset) {
    reply(request, response, 404, 'Not found\n');
    return;
  }

  try {
    const content = await readFile(new URL(asset[0], publicDirectory));
    reply(request, response, 200, content, asset[1]);
  } catch (error) {
    // Never include filesystem paths or raw errors in HTTP responses.
    const missing = error.code === 'ENOENT';
    reply(request, response, missing ? 404 : 500, missing ? 'Not found\n' : 'Internal server error\n');
  }
}

/** Create the server without opening a port, for embedding and tests. */
export function createServer() {
  const server = createHttpServer((request, response) => {
    void handleRequest(request, response);
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  server.keepAliveTimeout = 5_000;
  return server;
}

export function readConfig(environment = process.env) {
  const portText = environment.PORT ?? '3000';
  const host = environment.HOST ?? '127.0.0.1';
  if (!/^\d+$/.test(portText) || Number(portText) < 1 || Number(portText) > 65535) {
    throw new Error('PORT 必须是 1 到 65535 之间的整数。');
  }
  const hostnamePattern = /^(?=.{1,253}$)[a-z\d](?:[a-z\d-]*[a-z\d])?(?:\.[a-z\d](?:[a-z\d-]*[a-z\d])?)*$/i;
  if (!isIP(host) && !hostnamePattern.test(host)) {
    throw new Error('HOST 必须是有效的 IP 地址或主机名。');
  }
  return { port: Number(portText), host };
}

function start() {
  let config;
  try {
    config = readConfig();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }

  const server = createServer();
  server.on('error', (error) => {
    const messages = {
      EADDRINUSE: '启动失败：端口已被占用，请更改 PORT 后重试。',
      EACCES: '启动失败：没有权限使用这个地址或端口。',
      EADDRNOTAVAIL: '启动失败：HOST 指定的地址在本机不可用。',
      ENOTFOUND: '启动失败：无法解析 HOST 指定的主机名。',
    };
    console.error(messages[error.code] ?? '启动失败：请检查 HOST、PORT 和网络设置。');
    process.exitCode = 1;
  });

  server.listen(config.port, config.host, () => {
    const displayHost = isIP(config.host) === 6 ? `[${config.host}]` : config.host;
    console.log(`Snake Garden 已启动：http://${displayHost}:${config.port}`);
    console.log('按 Ctrl+C 停止服务。');
  });

  const stop = () => {
    server.close();
    server.closeAllConnections();
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

const invokedDirectly = process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invokedDirectly) start();
