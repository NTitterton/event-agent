FROM node:22-bookworm-slim@sha256:b1e7fcc44bd47f2d186de26c1202345369e7f1028b08956e75cfb52ad8e483f9 AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
WORKDIR /app
COPY src ./src
COPY tsconfig.json ./
RUN npm run build:ui

FROM node:22-bookworm-slim@sha256:b1e7fcc44bd47f2d186de26c1202345369e7f1028b08956e75cfb52ad8e483f9 AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY config ./config
COPY src ./src
COPY tsconfig.json ./
EXPOSE 5180
CMD ["node", "--import", "tsx", "src/server/index.ts"]
