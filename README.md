# smartcatalog-monitor

Monitoring und API fuer das SmartCatalog / ProductDataPortal Projekt.

## Bestandteile

- `api.js`: Express API fuer Admin-Funktionen, Kundenlogin, Kataloge, Uploads und Requests
- `monitor.js`: Hintergrundprozess, der gespeicherte URLs prueft und bei Fehlern E-Mails verschickt
- `smartviewer/`: Statischer Viewer, der von der API ausgeliefert wird

## Lokale Entwicklung

Voraussetzungen:

- Node.js 18 oder neuer
- npm
- Optional fuer PDF-Uploads: `pdftoppm` aus Poppler

Einrichtung:

```bash
npm install
```

Unter Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Unter Linux/macOS:

```bash
cp .env.example .env
```

In `.env` mindestens eigene lokale Werte setzen:

```env
API_PORT=3001
API_BASE_URL=http://localhost:3001
API_TOKEN=change-this-admin-token
CUSTOMER_JWT_SECRET=change-this-customer-secret
```

API starten:

```bash
npm run start:api
```

Healthcheck:

```bash
curl http://localhost:3001/health
```

Syntax pruefen:

```bash
npm run check
```

## Wichtige API-Basis

Lokal nutzt die App standardmaessig:

```text
http://localhost:3001
```

Auf dem VPS sollte `API_BASE_URL` auf die echte API-Domain zeigen:

```text
https://api.evolvetech-solutions.de
```

## Private Daten

Diese Dateien und Ordner gehoeren nicht in GitHub:

- `.env`
- `uploads/`
- `catalog-pages/`
- `customers.json`
- `requests.json`
- `history.json`
- `state.json`
- `urls.json`

## Deployment

Siehe [DEPLOYMENT.md](DEPLOYMENT.md).
