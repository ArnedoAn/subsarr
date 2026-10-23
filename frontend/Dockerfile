FROM node:24-alpine AS deps
WORKDIR /app
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM node:24-alpine AS prod-deps
WORKDIR /app
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile

FROM node:24-alpine AS builder
WORKDIR /app
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm run build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Keep the generated entrypoint/config, but do not depend on incomplete traced
# node_modules. The production dependency graph is installed from the lockfile.
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone/server.js ./server.js
COPY --from=builder --chown=node:node /app/.next/standalone/.next ./.next
COPY --from=builder --chown=node:node /app/.next/static ./.next/static

USER node
RUN node -e "const nextRequire = require('node:module').createRequire(require.resolve('next/package.json')); require('next/dist/server/next-server'); nextRequire('@next/env'); nextRequire('@swc/helpers/cjs/_interop_require_default.cjs')"
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --start-period=45s --retries=5 CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3000)+'/',r=>{r.resume();process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))"
CMD ["node", "server.js"]
