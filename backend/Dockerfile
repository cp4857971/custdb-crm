# ============================================================
# 通信客户资料库 · Docker 镜像
# 构建（在 backend 目录内执行，或使用部署包脚本）：
#   docker build -t custdb:0.0.23 .
# 运行：
#   docker run -d --name custdb -p 5001:5001 \
#     -v /你的数据目录:/data custdb:0.0.23
# ============================================================
FROM node:22-slim

WORKDIR /app

ENV NODE_ENV=production \
    PORT=5001 \
    GATEWAY_PREFIX=/app/custdb \
    DATA_DIR=/data \
    SOCKET_PATH=""

# 先装依赖（利用层缓存）
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund --registry=https://registry.npmjs.org

# 后端源码 + 前端静态产物
COPY server.js ./
COPY public ./public

# 客户数据卷（custdb.db / config.json 均存于此，升级容器不丢数据）
VOLUME ["/data"]
EXPOSE 5001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5001)+'/app/custdb/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
