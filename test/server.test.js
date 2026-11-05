import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { once } from 'node:events';
import { createServer, readConfig } from '../server.js';

let server;
let port;

before(async () => {
  server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  port = server.address().port;
});

after(async () => {
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

// Send a raw request path so dot segments are not normalized by fetch/URL.
function get(path, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path, method }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
      response.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}

test('serves the game and browser assets with correct content types', async () => {
  const home = await get('/');
  assert.equal(home.status, 200);
  assert.match(home.headers['content-type'], /^text\/html/);
  assert.match(home.body, /<canvas\b/i);
  for (const [path, type] of [
    ['/app.js', /^text\/javascript/],
    ['/engine.js', /^text\/javascript/],
    ['/styles.css', /^text\/css/],
    ['/favicon.svg', /^image\/svg\+xml/],
  ]) {
    const asset = await get(path);
    assert.equal(asset.status, 200, path);
    assert.match(asset.headers['content-type'], type, path);
    assert.ok(asset.body.length > 0, path);
  }
  assert.equal((await get('/index.html?version=1')).body, home.body);
});

test('HEAD returns the same headers without a response body', async () => {
  const normal = await get('/');
  const head = await get('/', 'HEAD');
  assert.equal(head.status, 200);
  assert.equal(head.body, '');
  assert.equal(head.headers['content-length'], normal.headers['content-length']);
  assert.equal(head.headers['content-type'], normal.headers['content-type']);
});

test('rejects private files, project source, and path traversal', async () => {
  for (const path of [
    '/.env', '/.env.local', '/.git/config', '/server.js', '/package.json',
    '/README.md', '/test/server.test.js', '/../', '/%2e%2e/',
    '/%2e%2e/server.js', '/..%5cserver.js', '/%252e%252e/.env',
    '/index.html%00', '//index.html', '/public/index.html',
  ]) {
    const response = await get(path);
    assert.equal(response.status, 404, path);
    assert.equal(response.body, 'Not found\n', path);
  }
});

test('rejects unsupported methods and advertises allowed ones', async () => {
  const response = await get('/', 'POST');
  assert.equal(response.status, 405);
  assert.equal(response.headers.allow, 'GET, HEAD');
});

test('malformed encoding does not crash the server', async () => {
  for (const path of ['/%', '/%ZZ', '/%E0%A4%A']) {
    const response = await get(path);
    assert.equal(response.status, 400);
    assert.equal(response.body, 'Bad request\n');
  }
  assert.equal((await get('/')).status, 200);
});

test('security headers apply to both successful and rejected requests', async () => {
  for (const path of ['/', '/.env']) {
    const { headers } = await get(path);
    assert.equal(headers['x-content-type-options'], 'nosniff');
    assert.equal(headers['referrer-policy'], 'no-referrer');
    assert.equal(headers['x-frame-options'], 'DENY');
    assert.match(headers['content-security-policy'], /script-src 'self'/);
    assert.match(headers['content-security-policy'], /connect-src 'none'/);
    assert.doesNotMatch(headers['content-security-policy'], /unsafe-inline|unsafe-eval/);
  }
});

test('configuration binds to loopback by default and validates port and host', () => {
  assert.deepEqual(readConfig({}), { port: 3000, host: '127.0.0.1' });
  assert.deepEqual(readConfig({ HOST: '0.0.0.0', PORT: '8080' }), { port: 8080, host: '0.0.0.0' });
  assert.deepEqual(readConfig({ HOST: '::1', PORT: '3001' }), { port: 3001, host: '::1' });
  for (const port of ['0', '-1', '65536', '3000oops', '3e3', '']) {
    assert.throws(() => readConfig({ PORT: port }), /PORT/);
  }
  for (const host of ['', 'http://localhost', '127.0.0.1:3000', '../private', 'some host']) {
    assert.throws(() => readConfig({ HOST: host }), /HOST/);
  }
});
