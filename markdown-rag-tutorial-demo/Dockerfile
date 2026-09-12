FROM node:22-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY rag-server.js ./

RUN mkdir -p /app/data
ENV AUTH_USERS_FILE=/app/data/auth-users.json

EXPOSE 3000
CMD ["node", "rag-server.js"]
