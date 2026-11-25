FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY accounts.mjs cloud-config.mjs cloud-enrollment-authority.mjs current-pass-snapshot.mjs hosted-pass-service.mjs hosted-runtime.mjs http.mjs node-http.mjs phone-box.mjs postgres-auth-store.mjs postgres-enrollment-loader.mjs remote-otp.mjs server.mjs solapi-code.mjs solapi-http.mjs ./
USER node
ENV NODE_ENV=production
CMD ["node", "server.mjs"]
