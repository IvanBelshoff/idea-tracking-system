// Serve o build estático (out/) em /ajuda/, como o nginx faz no Docker. Só para testes locais.
// Uso: node scripts/serve.mjs [porta]   (padrão 3200; escuta só em 127.0.0.1)
// Build público: AJUDA_BASE_PATH=/idea-tracking-system node scripts/serve.mjs (mostra o 404.html, como o Pages).
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../out', import.meta.url));
const port = Number(process.argv[2] ?? 3200);
const prefix = process.env.AJUDA_BASE_PATH || '/ajuda';
const notFound = existsSync(join(root, '404.html')) ? '404.html' : 'nao-encontrada.html';
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.webm': 'video/webm',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.pf_meta': 'application/octet-stream',
  '.pf_index': 'application/octet-stream',
  '.pf_fragment': 'application/octet-stream',
};

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (!url.pathname.startsWith(prefix)) {
    res.writeHead(404).end();
    return;
  }
  let rel = decodeURIComponent(url.pathname.slice(prefix.length)) || '/';
  if (rel.endsWith('/')) rel += 'index.html';
  const file = normalize(join(root, rel));
  if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    createReadStream(join(root, notFound)).pipe(res);
    return;
  }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
}).listen(port, '127.0.0.1', () => console.log(`ajuda em http://127.0.0.1:${port}${prefix}/`));
