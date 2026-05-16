# Build from the repo root: docker build -f backend/Dockerfile .
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
RUN npm ci --workspace backend --include-workspace-root
COPY backend ./backend
RUN npm run build --workspace backend

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
RUN npm ci --workspace backend --omit=dev --include-workspace-root
COPY --from=build /app/backend/dist ./backend/dist
USER node
WORKDIR /app/backend
EXPOSE 8091
CMD ["node", "dist/index.js"]
