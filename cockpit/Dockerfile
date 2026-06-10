FROM node:22-slim AS base
WORKDIR /app
RUN apt-get update && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*

FROM base AS deps
# .npmrc carries legacy-peer-deps (the ajv@8 pin needs it); npm ci installs the
# exact committed lockfile identically on every teammate's machine.
COPY package.json package-lock.json .npmrc ./
RUN npm ci

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM base AS run
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/next.config.mjs ./next.config.mjs
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
# Belt-and-suspenders for Windows checkouts that predate .gitattributes: a CRLF
# entrypoint fails as "/bin/sh^M: bad interpreter" inside the container.
RUN sed -i 's/\r$//' /usr/local/bin/docker-entrypoint.sh && chmod +x /usr/local/bin/docker-entrypoint.sh
EXPOSE 3000
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["npm", "start"]
