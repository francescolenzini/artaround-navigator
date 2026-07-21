# -----------------------------------------------------------------------------
# ArtAround Navigator — immagine di SVILUPPO (progetto autonomo)
# App React 19 + Vite + TanStack Router, sorgente sotto app/. Vite dev server
# con HMR; il sorgente è bind-mounted (vedi docker-compose.yml), node_modules
# vive in un volume dedicato.
#
# app/public/api.config.json (contiene la apiKey) NON viene committato: viene
# generato a ogni avvio del container dalle variabili d'ambiente (API_KEY,
# BACKEND_URL) passate dal docker-compose — stesso principio già adottato per
# il Marketplace.
#
# Contesto di build: la RADICE del repo. Il container ricalca la struttura del
# repo (WORKDIR /app contiene una sottocartella app/ con il vero progetto Vite).
# -----------------------------------------------------------------------------
FROM node:20-alpine

ENV NODE_ENV=development
WORKDIR /app

# Pre-installa le dipendenze copiando solo i manifest, per un primo avvio veloce
# anche a volume node_modules vuoto.
COPY app/package*.json ./app/
RUN cd app && (if [ -f package-lock.json ]; then npm ci; else npm install; fi)

COPY . .

EXPOSE 5173

CMD ["sh", "-c", "printf '{\"baseUrl\":\"%s\",\"apiKey\":\"%s\"}' \"${BACKEND_URL:-http://localhost:3002}\" \"$API_KEY\" > app/public/api.config.json && cd app && npm run dev -- --host 0.0.0.0 --port 5173"]
