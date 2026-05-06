# Deployment

Diese Notizen beschreiben den aktuellen VPS-Stand fuer das Projekt.

## Server

- Betriebssystem: Ubuntu 24.04 LTS
- Projektpfad: `/root/smartcatalog-monitor`
- API-Domain: `https://api.evolvetech-solutions.de`
- Interner API-Port: `3001`
- Reverse Proxy: Nginx
- Prozessmanager: PM2

## Laufende Prozesse

```bash
pm2 list
```

Erwartete Prozesse:

- `smartcatalog-api` -> `/root/smartcatalog-monitor/api.js`
- `smartcatalog-monitor` -> `/root/smartcatalog-monitor/monitor.js`

## Deployment-Schritte

Auf dem VPS:

```bash
cd /root/smartcatalog-monitor
git pull
npm install
pm2 restart smartcatalog-api
pm2 restart smartcatalog-monitor
pm2 status
```

Danach pruefen:

```bash
curl https://api.evolvetech-solutions.de/health
```

Erwartete Antwort:

```json
{"ok":true}
```

## Nginx

Nginx leitet die API-Domain intern an die Node-App weiter:

```text
https://api.evolvetech-solutions.de -> http://localhost:3001
```

Konfiguration:

```bash
cat /etc/nginx/sites-enabled/api
```

Nach Nginx-Aenderungen:

```bash
nginx -t
systemctl reload nginx
```

## Geheimnisse und Laufzeitdaten

Nicht committen:

- `.env`
- `uploads/`
- `catalog-pages/`
- `customer-assets/`
- `data-backups/`
- `customers.json`
- `requests.json`
- `history.json`
- `state.json`
- `urls.json`

## Stripe Live-Schaltung

In `.env` muessen fuer Stripe gesetzt sein:

```env
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_STARTER=price_...
STRIPE_PRICE_BUSINESS=price_...
STRIPE_PRICE_PRO=price_...
STRIPE_CHECKOUT_SUCCESS_URL=https://<frontend-domain>/billing/success?session_id={CHECKOUT_SESSION_ID}
STRIPE_CHECKOUT_CANCEL_URL=https://<frontend-domain>/billing/cancelled
STRIPE_PORTAL_RETURN_URL=https://<frontend-domain>/dashboard
STRIPE_AUTOMATIC_TAX=false
STRIPE_ALLOW_PROMOTION_CODES=false
```

Stripe Webhook-URL:

```text
https://api.evolvetech-solutions.de/api/stripe/webhook
```

Relevante Events:

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `customer.subscription.paused`
- `customer.subscription.resumed`
- `customer.deleted`
- `invoice.paid`
- `invoice.payment_succeeded`
- `invoice.payment_failed`

Die JSON-Dateien werden atomar geschrieben. Vor jedem erfolgreichen Ersetzen wird eine Backup-Kopie unter `data-backups/` angelegt.

Vor groesseren Aenderungen ein Server-Backup erstellen:

```bash
mkdir -p /root/backups
tar --exclude='/root/smartcatalog-monitor/node_modules' \
  -czf /root/backups/smartcatalog-monitor-backup-$(date +%F-%H%M).tar.gz \
  /root/smartcatalog-monitor
```

## Viewer

Die App bedient zwei offizielle Anzeigewege:

- PDF-Ansicht: `/viewer/web/viewer.html?file=...`
- Blaetterkatalog: `/smartviewer/index.html?catalog=...`

Die PDF-Ansicht wird vom eigenen `pdf-viewer/` bedient und nutzt `pdfjs-dist` aus `node_modules`. Deshalb ist `npm install` beim Deployment wichtig.
`pdfjs-dist` bleibt bewusst auf der Node-18-kompatiblen 4er-Version, damit der Viewer stabil bleibt und keine PDF.js-5-Breaking-Changes ins Produkt kommen.

Der alte manuell hochgeladene VPS-Ordner `/root/smartcatalog-monitor/viewer` wird fuer den neuen PDF-Viewer nicht mehr als Quelle gebraucht. Er kann nach erfolgreichem Live-Test separat archiviert werden.
