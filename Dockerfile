FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
WORKDIR /app
COPY src ./src
COPY tsconfig.json ./
RUN npm run build:ui

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY src ./src
COPY tsconfig.json ./
EXPOSE 5180
CMD ["node", "--import", "tsx", "src/server/index.ts"]
