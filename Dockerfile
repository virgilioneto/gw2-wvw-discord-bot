# Build stage
FROM node:20-alpine AS builder
WORKDIR /app
# Copy dependency files for better layer caching
COPY package.json package-lock.json ./
# Install all dependencies (including devDependencies for build)
RUN npm ci
# Copy source and config
COPY tsconfig.json ./
COPY src ./src
# Build TypeScript
RUN npm run build

# Production stage
FROM node:20-alpine
WORKDIR /app
# Copy dependency files
COPY package.json package-lock.json ./
# Install production dependencies only
RUN npm ci --omit=dev
# Copy built output from builder
COPY --from=builder /app/dist ./dist
# Run the bot
CMD ["node", "dist/index.js"]
