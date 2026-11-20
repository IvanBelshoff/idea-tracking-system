# syntax=docker/dockerfile:1
# Ajuda do ITS (its/ajuda): exportação estática do Next.js servida por nginx em /ajuda/.
# Contexto do build: a RAIZ do repositório (a ajuda usa tokens e componentes do frontend do ITS).
# O ajuda/Dockerfile.dockerignore deixa de fora node_modules, builds e segredos.

FROM node:24-alpine AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo/ajuda
COPY ajuda/package.json ajuda/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
WORKDIR /repo
# Só o que a ajuda usa do ITS: tokens, tema, componentes e o mapa de tópicos de ajuda.
COPY frontend/src/tokens.css frontend/src/theme.css frontend/src/
COPY frontend/src/components frontend/src/components
COPY frontend/src/app/help-topics.ts frontend/src/app/help-topics.ts
COPY ajuda ./ajuda
WORKDIR /repo/ajuda
RUN pnpm check:content && pnpm build

# nginx sem privilégios de root, escutando na 8080 (o "web" do ITS repassa /ajuda/ para cá).
FROM nginxinc/nginx-unprivileged:alpine AS runtime
COPY ajuda/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/ajuda/out /usr/share/nginx/html/ajuda
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD wget -q -O /dev/null http://127.0.0.1:8080/ajuda/ || exit 1
