#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const [fileArg, portArg = '4200'] = process.argv.slice(2);
if (!fileArg) throw new Error('用法: node blind-server.mjs <blind-review.html> [port]');
const file = path.resolve(fileArg);
if (path.basename(file) !== 'blind-review.html' || !fs.existsSync(file)) throw new Error('只允许读取已有 blind-review.html');
const port = Number(portArg);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('无效端口');

http.createServer((request, response) => {
  if (request.method !== 'GET' || !['/', '/blind-review.html'].includes(new URL(request.url, 'http://localhost').pathname)) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end('Not found');
    return;
  }
  response.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; base-uri 'none'; form-action 'none'",
  });
  fs.createReadStream(file).pipe(response);
}).listen(port, '127.0.0.1', () => console.log(`Prototype Talk 盲评：http://127.0.0.1:${port}/blind-review.html`));
