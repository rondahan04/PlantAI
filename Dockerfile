# PlantAI API server (TODOS A2).
#
# The server and the scraper used to import nothing from npm, so the image had
# no install step and no node_modules. That stopped being true when structured
# price extraction landed: scraper/structuredPrice.ts parses the shop's own HTML
# with parse5, because reading a product grid with regexes is exactly the
# fragility that was losing us prices. Hence the `npm ci --omit=dev` layer this
# file's earlier note anticipated.
#
# Node 26 strips TypeScript types natively, which is why `node server/index.ts`
# runs a .ts entrypoint with no build step. Do not drop below Node 23.6 - type
# stripping is behind a flag before that and the container will exit on start.
FROM node:26-alpine

ENV NODE_ENV=production
WORKDIR /app

# Dependencies first, and on their own layer: the manifests change far less
# often than the source, so an ordinary code push reuses the cached install.
# --omit=dev keeps the React Native/test toolchain out of a server image.
# --ignore-scripts because no runtime dependency here needs a build step, and a
# postinstall script is not something a production image should be running.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

# Only what the server actually reads at runtime. src/ (React Native), assets/,
# dashboard/ and scripts/ are deliberately absent - see .dockerignore.
COPY server ./server
COPY scraper ./scraper
COPY nurseries-fallback.txt ./nurseries-fallback.txt

# Drop root. The process only needs to read its own source and write
# scraper/learned-platforms.json, which is a cache the container regenerates.
RUN chown -R node:node /app
USER node

EXPOSE 4000
ENV PORT=4000

# No .env in the image on purpose: keys come from the host's secret store
# (`fly secrets set`). loadEnv() no-ops when the file is absent.
CMD ["node", "server/index.ts"]
