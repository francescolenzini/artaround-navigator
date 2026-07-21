#!/bin/sh
# Eseguito automaticamente dall'entrypoint ufficiale dell'immagine nginx (ogni
# script *.sh in /docker-entrypoint.d/ viene lanciato prima dell'avvio di nginx).
# Genera api.config.json dalle variabili d'ambiente: mai committato nel repo.
set -e

: "${BACKEND_URL:?serve BACKEND_URL}"
API_KEY="${API_KEY:-}"

printf '{"baseUrl":"%s","apiKey":"%s"}' "$BACKEND_URL" "$API_KEY" > /usr/share/nginx/html/api.config.json
