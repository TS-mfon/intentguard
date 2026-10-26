# Node and pnpm are shared by both targets; the digest fixes the base image.
FROM node:24.18.0-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d AS dependencies
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.9.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/package.json
RUN pnpm install --frozen-lockfile --network-concurrency=8 --fetch-timeout=180000

FROM dependencies AS source
COPY . .

# Build with --target worker. tsx is a locked runtime dependency of this image.
# The worker reads its environment at startup; no credentials enter image layers.
FROM dependencies AS worker
COPY --chown=node:node apps/worker ./apps/worker
COPY --chown=node:node apps/web/lib ./apps/web/lib
COPY --chown=node:node packages/shared ./packages/shared
COPY --chown=node:node contracts/genlayer ./contracts/genlayer
COPY --chown=node:node contracts/evm/abi.json ./contracts/evm/abi.json
COPY --chown=node:node tsconfig.json ./tsconfig.json
COPY --chown=node:node docs/deployments ./docs/deployments
ENV NODE_ENV=production
USER node
CMD ["node", "node_modules/tsx/dist/cli.mjs", "apps/worker/main.ts"]

FROM source AS web-build
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

# The default target serves the traced Next.js standalone app as a non-root user.
FROM node:24.18.0-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d AS web
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
COPY --from=web-build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=web-build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=web-build --chown=node:node /app/apps/web/public ./apps/web/public
# Standalone Next starts in apps/web; keep repo-relative manifest paths available.
COPY --chown=node:node docs/deployments ./docs/deployments
COPY --chown=node:node docs/deployments ./apps/web/docs/deployments
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
