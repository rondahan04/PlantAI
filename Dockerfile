# PlantAI API server (TODOS A2).
#
# The server and the scraper import nothing from npm — only node: builtins — so
# there is no install step and no node_modules in the image. If that ever stops
# being true, add a `npm ci --omit=dev` layer above the source copy.
#
# Node 26 strips TypeScript types natively, which is why `node server/index.ts`
# runs a .ts entrypoint with no build step. Do not drop below Node 23.6 — type
# stripping is behind a flag before that and the container will exit on start.
FROM node:26-alpine

ENV NODE_ENV=production
WORKDIR /app

# Only what the server actually reads at runtime. src/ (React Native), assets/,
# dashboard/ and scripts/ are deliberately absent — see .dockerignore.
COPY package.json ./
COPY server ./server
COPY scraper ./scraper
COPY nurseries_scraping_testing ./nurseries_scraping_testing

# Drop root. The process only needs to read its own source and write
# scraper/learned-platforms.json, which is a cache the container regenerates.
RUN chown -R node:node /app
USER node

EXPOSE 4000
ENV PORT=4000

# No .env in the image on purpose: keys come from the host's secret store
# (`fly secrets set`). loadEnv() no-ops when the file is absent.
CMD ["node", "server/index.ts"]
