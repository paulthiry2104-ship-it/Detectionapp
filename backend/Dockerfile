FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production TZ=Europe/Paris
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
# La base SQLite vit sur un volume persistant monté en /data
ENV DATABASE_PATH=/data/radar.db
EXPOSE 8080
HEALTHCHECK --interval=60s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npm", "start"]
