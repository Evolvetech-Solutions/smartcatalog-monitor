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
- `customers.json`
- `requests.json`
- `history.json`
- `state.json`
- `urls.json`

Vor groesseren Aenderungen ein Server-Backup erstellen:

```bash
mkdir -p /root/backups
tar --exclude='/root/smartcatalog-monitor/node_modules' \
  -czf /root/backups/smartcatalog-monitor-backup-$(date +%F-%H%M).tar.gz \
  /root/smartcatalog-monitor
```
