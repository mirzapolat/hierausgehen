# syntax=docker/dockerfile:1
# Mehrstufiger Build für die Next.js-App. Die Standalone-Ausgabe bringt einen
# eigenen Server samt der wirklich benötigten Abhängigkeiten mit, das Laufzeit-
# Abbild braucht deshalb kein `npm install`.
#
# Debian (slim) statt Alpine, in allen Stufen: das Embedding-Modell der Suche
# läuft über onnxruntime-node, dessen fertige Bibliotheken glibc brauchen –
# unter Alpines musl laden sie nicht. Alle Stufen gleich, weil auch `sharp`
# beim Installieren die Bibliothek für genau diese libc holt.

# ---- Abhängigkeiten ------------------------------------------------------
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- Build ---------------------------------------------------------------
FROM node:22-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Die App holt ihre Daten erst zur Laufzeit (alle Seiten sind dynamisch),
# der Build braucht also keinen Netzzugang zu den Quellen.
RUN npm run build
# Das Embedding-Modell (multilingual-e5-small, 8 Bit, gut 100 MB) gehört ins
# Abbild: der Container lädt zur Laufzeit nichts nach und startet auch ohne
# Verbindung zu Hugging Face.
RUN EMBEDDING_CACHE_DIR=/app/models node --experimental-strip-types scripts/fetch-model.ts

# ---- Laufzeit ------------------------------------------------------------
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    TZ=Europe/Berlin \
    EMBEDDING_CACHE_DIR=/app/models \
    EMBEDDING_OFFLINE=1

# Ohne tzdata gilt nur UTC und die TZ-Angabe oben bliebe wirkungslos.
# (Die Anzeige der App rechnet ohnehin über Intl, aber Logs sollen stimmen.)
RUN apt-get update \
 && apt-get install -y --no-install-recommends tzdata ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs --no-create-home nextjs

COPY --from=build /app/public ./public
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/models ./models

# Zwischenspeicher für Termine, Favicons und die Vektoren der Suche. Liegt auf
# einem Volume, damit ein Neustart nicht mit leerem Kalender beginnt, die
# Quellen schont und die Suche nicht alles neu einbetten muss.
RUN mkdir -p /app/.cache && chown -R nextjs:nodejs /app/.cache
VOLUME ["/app/.cache"]

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
