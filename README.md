# smartcatalog-monitor

Monitoring und API fuer das SmartCatalog / ProductDataPortal Projekt.

## Bestandteile

- `api.js`: Express API fuer Admin-Funktionen, Kundenlogin, Kataloge, Uploads und Requests
- `monitor.js`: Hintergrundprozess, der gespeicherte URLs prueft und bei Fehlern E-Mails verschickt
- `pdf-viewer/`: eigener PDF-Viewer fuer bestehende `/viewer/web/viewer.html?...` Links
- `smartviewer/`: Statischer, responsiver Blaetterkatalog mit Branding und Startanimation
- `smartviewer-v2/`: neue Prospekt-App-Basis mit eigener Swipe-/Zoom-/Hotspot-Logik

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

## Anzeigearten

Ein Katalog kann aktuell auf zwei Arten angezeigt werden:

- `viewer_url`: normale PDF-Ansicht ueber PDF.js, z. B. `/viewer/web/viewer.html?file=...`
- `flipbook_url`: Blaetterkatalog ueber den Smartviewer, z. B. `/smartviewer/index.html?catalog=...`
- `smartviewer_v2_url`: neue Prospekt-App, z. B. `/smartviewer-v2/index.html?catalog=...`

Die PDF-Ansicht nutzt intern `pdfjs-dist` aus `node_modules`. Dadurch ist der Viewer reproduzierbar installierbar und muss nicht als grosser manuell gepflegter `viewer/`-Ordner ins Repo.

Wenn beim Speichern eines Katalogs nur `pdf_url` uebergeben wird, erzeugt die API fehlende Smartviewer-Seiten automatisch und ergaenzt `catalog_id` und `flipbook_url`.

Kundenlogos koennen ueber `POST /api/customer/logo` hochgeladen werden. Der SmartViewer laedt Logo, Kundennamen und Katalogtitel ueber `GET /api/viewer-settings/:catalogId`.

Kunden koennen ihre Kontaktdaten ueber `GET/PUT /api/customer/me` pflegen. Passwortaenderungen laufen ueber `PUT /api/customer/password` und erfordern das aktuelle Passwort.

SmartViewer V2 laedt Katalogdaten, Seiten und Hotspots ueber:

```text
/api/smartviewer-v2/catalogs/:catalogId
```

Hotspots koennen fuer das Kundenportal ueber `GET/PUT /api/customer/catalogs/:id/hotspots` gepflegt werden. Positionen werden relativ zur Seite gespeichert (`left`, `top`, `width`, `height` jeweils 0 bis 1), damit sie auf Handy und Desktop gleich funktionieren.

Ein erster Editor ist unter `/smartviewer-v2/editor.html?catalog=<catalog_id>&id=<catalog_record_id>` verfuegbar. Fuer die Hostinger-Dashboard-Integration sollte das Portal vorher `POST /api/customer/catalogs/:id/editor-session` aufrufen und die zurueckgegebene `editor_url` oeffnen. Dieser Link enthaelt einen kurzlebigen, kataloggebundenen Bearbeitungs-Token.

Der alte Serverordner `/flipbook` ist nicht der offizielle Anzeigeweg. Neue Flipbook-Links sollen immer ueber `/smartviewer` laufen.

Der Smartviewer nutzt standardmaessig die gleiche Domain, von der er geladen wurde. Fuer lokale Tests oder Staging kann optional `api_base` gesetzt werden:

```text
/smartviewer/index.html?catalog=123&api_base=http://localhost:3001
```

## Private Daten

Diese Dateien und Ordner gehoeren nicht in GitHub:

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
- `catalog-hotspots.json`

JSON-Laufzeitdaten werden atomar geschrieben: Vor dem Ersetzen einer Datei wird eine Backup-Kopie unter `data-backups/` abgelegt. Das schuetzt vor halb geschriebenen JSON-Dateien bei Prozessabbruechen.

## Deployment

Siehe [DEPLOYMENT.md](DEPLOYMENT.md).
