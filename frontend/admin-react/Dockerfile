FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.25-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
# SSL template stored outside nginx auto-processing dir.
# Activated only when using docker-compose.ssl.yml overlay.
COPY nginx-ssl.conf /etc/nginx/ssl.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
