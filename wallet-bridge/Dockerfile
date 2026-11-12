FROM node:22.22.2-bookworm-slim@sha256:9f6d5975c7dca860947d3915877f85607946403fc55349f39b4bc3688448bb6e
RUN npm install --global pnpm@10.28.1
WORKDIR /bridge
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile --ignore-scripts
COPY bridge.mjs protocol.mjs server.mjs upstream-config.mjs policy.mjs index.mjs index.d.mts ./
ENV NODE_ENV=production BITBUDGET_BRIDGE_POLICY_FILE=/bridge-policy/policy.json
USER node
EXPOSE 50004
ENTRYPOINT ["node", "/bridge/server.mjs"]
