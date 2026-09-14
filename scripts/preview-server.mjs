import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const html = readFileSync(fileURLToPath(new URL('../preview/index.html', import.meta.url)));
const port = Number(process.env.PORT ?? 4173);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error('PORT must be an integer from 1024 to 65535.');
const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  if (request.method !== 'GET' || !['/', '/index.html'].includes(url.pathname)) {
    response.writeHead(404);
    response.end('Not found');
    return;
  }
  response.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy':
      "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  });
  response.end(html);
});
server.on('error', (error) => {
  console.error(
    `Preview could not start: ${error.code ?? 'unknown error'}. Choose another PORT if it is already in use.`,
  );
  process.exit(1);
});
server.listen(port, '127.0.0.1', () =>
  console.log(
    `Outpost HTML design preview: http://127.0.0.1:${port}\nIllustrative fixtures only. This is not the native app and accepts no Riot credentials.`,
  ),
);
