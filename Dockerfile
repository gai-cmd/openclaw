FROM node:22-alpine

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm install --production=false

# Copy source
COPY tsconfig.json ./
COPY src/ ./src/

# Copy pre-built web frontend
COPY web/dist/ ./web/dist/

# Expose API port
EXPOSE 3737

CMD ["npx", "tsx", "src/index.ts"]
