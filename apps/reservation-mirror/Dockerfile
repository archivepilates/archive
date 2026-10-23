FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY server.mjs safety.mjs auth.mjs repository.mjs view-model.mjs check-isolation.mjs ./
COPY dist ./dist
USER node
ENV NODE_ENV=production
CMD ["node", "server.mjs"]
