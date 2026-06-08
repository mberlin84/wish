# Imagen para el backend Express que además sirve la PWA (archivos estáticos de la raíz).
FROM node:20-alpine

WORKDIR /app

# Instala dependencias primero para aprovechar la caché de capas.
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev

# Copia el resto del proyecto (servidor + frontend de la PWA).
COPY . .

WORKDIR /app/server

EXPOSE 3000

# Aplica el esquema (idempotente, usa IF NOT EXISTS) y arranca el servidor.
CMD ["sh", "-c", "npm run migrate && npm start"]
