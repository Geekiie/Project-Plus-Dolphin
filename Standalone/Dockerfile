FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --omit=dev --no-audit --no-fund
COPY relay.mjs ./
ENV HOST=0.0.0.0 PORT=4318
EXPOSE 4318
USER node
CMD ["node", "relay.mjs"]
