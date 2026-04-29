# API Uebersicht

Basis-URL Produktion:

```text
https://api.evolvetech-solutions.de
```

Basis-URL lokal:

```text
http://localhost:3001
```

## Authentifizierung

Admin-Endpunkte erwarten:

```http
Authorization: Bearer <API_TOKEN>
```

Kunden-Endpunkte erwarten nach dem Login:

```http
Authorization: Bearer <CUSTOMER_JWT>
```

## Anzeigearten

Jeder Katalog kann zwei relevante Links haben:

- `viewer_url`: normale PDF-Anzeige ueber PDF.js
- `flipbook_url`: Blaetterkatalog ueber `smartviewer`

Wenn `POST /api/urls` oder `POST /api/customer/catalogs` nur eine `pdf_url` bekommt, erzeugt die API fehlende Smartviewer-Seiten automatisch und setzt `catalog_id` sowie `flipbook_url`.

Aktueller Standard fuer den Blaetterkatalog:

```text
/smartviewer/index.html?catalog=<catalog_id>
```

Der alte Pfad `/flipbook` ist kein offizieller Anzeigeweg mehr.

Normale PDF-Ansicht:

```text
/viewer/web/viewer.html?file=<encoded_pdf_url>
```

Dieser Pfad wird von der App selbst bedient und nutzt `pdfjs-dist` aus `node_modules`.

## Allgemein

```http
GET /health
```

Antwort:

```json
{"ok":true}
```

## Admin

```http
GET /api/status
GET /api/tags
POST /api/upload
POST /api/urls
PUT /api/urls/:id
DELETE /api/urls/:id
GET /api/customers
POST /api/customers
PUT /api/customers/:id
DELETE /api/customers/:id
GET /api/requests
```

## Kundenportal

```http
POST /api/customer-login
GET /api/customer/me
POST /api/customer/logo
GET /api/customer/catalogs
POST /api/customer/upload
POST /api/customer/catalogs
PUT /api/customer/catalogs/:id
DELETE /api/customer/catalogs/:id
GET /api/customer/requests
POST /api/customer/requests
```

## SmartViewer-Einstellungen

```http
GET /api/viewer-settings/:catalogId
```

Liefert oeffentliche Viewer-Metadaten fuer den SmartViewer:

```json
{
  "catalog_id": "1777318518555",
  "title": "Katalogname",
  "customer": {
    "customer_number": "1234",
    "company_name": "Firma GmbH",
    "logo_url": "https://api.evolvetech-solutions.de/customer-assets/logo.png"
  }
}
```

Kundenlogo hochladen:

```http
POST /api/customer/logo
Content-Type: multipart/form-data
Authorization: Bearer <CUSTOMER_JWT>

logo=<image file>
```

## Wichtige Datenfelder

Katalog:

```json
{
  "id": 1777318518555,
  "name": "Katalogname",
  "customer_number": "1234",
  "url": "https://api.evolvetech-solutions.de/smartviewer/index.html?catalog=1777318518555",
  "pdf_url": "https://api.evolvetech-solutions.de/uploads/datei.pdf",
  "viewer_url": "https://api.evolvetech-solutions.de/viewer/web/viewer.html?file=...",
  "catalog_id": "1777318518555",
  "flipbook_url": "https://api.evolvetech-solutions.de/smartviewer/index.html?catalog=1777318518555",
  "tags": [],
  "is_active": true
}
```

Kunde:

```json
{
  "id": 1,
  "customer_number": "1234",
  "company_name": "Firma GmbH",
  "logo_url": "https://api.evolvetech-solutions.de/customer-assets/logo.png",
  "is_active": true
}
```
