import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

export default defineConfig({
  // Versão mostrada em "Ajuda e informações".
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [
    react(),
    tailwindcss(),
    // App instalável (RN-83). Tudo gerado no build: nenhum serviço externo, nenhum CDN.
    VitePWA({
      registerType: 'prompt', // versão nova só entra quando a pessoa escolhe "Atualizar"
      injectRegister: false, // o registro fica em src/app/pwa-status.tsx
      // O manifesto vem da API (/manifest.webmanifest → /api/branding/manifest.webmanifest), com a cor
      // e os ícones da organização; public/its.webmanifest é a reserva do nginx com a API fora do ar.
      manifest: false,
      workbox: {
        // Só a casca do app vai para o cache; dados (e arquivos baixados) vêm sempre da API.
        globPatterns: ['**/*.{js,css,html,svg,png,webp,woff2}'],
        // Fontes de outros alfabetos: o navegador só baixa se algum texto precisar delas.
        // As fontes opcionais da identidade visual também ficam fora: só a escolhida é baixada, e
        // guardada no primeiro uso (abaixo). Quem usa a Geist (padrão) não carrega nada a mais.
        globIgnores: [
          '**/*-cyrillic*',
          '**/*-vietnamese*',
          '**/*-greek*',
          '**/inter-*-wght-*.woff2',
          '**/atkinson-hyperlegible-next-*-wght-*.woff2',
          '**/ibm-plex-sans-*-wght-*.woff2',
        ],
        navigateFallback: '/index.html',
        // /ajuda/ é outro serviço (a documentação): o service worker do ITS não pode responder por ela.
        navigateFallbackDenylist: [/^\/api\//, /^\/ajuda(\/|$)/, /^\/ajuda-indisponivel\.html$/],
        runtimeCaching: [
          {
            urlPattern: ({ url }) =>
              /^\/assets\/(inter|atkinson-hyperlegible-next|ibm-plex-sans)-[a-z-]+-wght-normal-[\w-]+\.woff2$/.test(
                url.pathname,
              ),
            handler: 'CacheFirst',
            options: { cacheName: 'its-fontes', expiration: { maxEntries: 8 } },
          },
        ],
        cleanupOutdatedCaches: true,
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    // Servidor de desenvolvimento acessível somente a partir desta máquina.
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    // Mesma origem para a API em desenvolvimento (evita CORS e espelha o nginx de produção).
    proxy: {
      '/api': 'http://127.0.0.1:3000',
      // API de integração (M16): fora de /api, como no nginx.
      '/integration': 'http://127.0.0.1:3000',
      // Ajuda (its/ajuda): `pnpm dev` lá na 3100, ou o build servido por scripts/serve.mjs (AJUDA_DEV_URL).
      '/ajuda': process.env.AJUDA_DEV_URL ?? 'http://127.0.0.1:3100',
      // Manifesto do app na cor da organização (no Docker, o nginx faz o mesmo).
      '/manifest.webmanifest': {
        target: 'http://127.0.0.1:3000',
        rewrite: () => '/api/branding/manifest.webmanifest',
      },
    },
  },
});
