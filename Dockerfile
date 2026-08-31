# syntax=docker/dockerfile:1
# Mehrstufiger Build für die Next.js-App. Die Standalone-Ausgabe bringt einen
# eigenen Server samt der wirklich benötigten Abhängigkeiten mit, das Laufzeit-
# Abbild braucht deshalb kein `npm install`.

# ---- Abhängigkeiten ------------------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- Build ---------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Die App holt ihre Daten erst zur Laufzeit (alle Seiten sind dynamisch),
# der Build braucht also keinen Netzzugang zu den Quellen.
RUN npm run build

# ---- Laufzeit ------------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    TZ=Europe/Berlin

# Ohne tzdata kennt Alpine nur UTC und die TZ-Angabe oben bliebe wirkungslos.
# (Die Anzeige der App rechnet ohnehin über Intl, aber Logs sollen stimmen.)
RUN apk add --no-cache tzdata \
 && addgroup -g 1001 -S nodejs \
 && adduser -S nextjs -u 1001 -G nodejs

COPY --from=build /app/public ./public
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static

# Zwischenspeicher für Termine und Favicons. Liegt auf einem Volume, damit ein
# Neustart nicht mit leerem Kalender beginnt und die Quellen schont.
RUN mkdir -p /app/.cache && chown -R nextjs:nodejs /app/.cache
VOLUME ["/app/.cache"]

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
