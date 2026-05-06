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

Neue Prospekt-App / SmartViewer V2:

```text
/smartviewer-v2/index.html?catalog=<catalog_id>
```

SmartViewer V2 ist als Publitas-aehnliche Viewer-Basis gedacht: mobile Swipe,
Pinch-Zoom, Pan im Zoom und Hotspots/Links.

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
PUT /api/customer/me
PUT /api/customer/password
GET /api/customer/billing/plans
GET /api/customer/billing/usage
POST /api/customer/billing/checkout
POST /api/customer/billing/portal
POST /api/customer/logo
GET /api/customer/catalogs
POST /api/customer/upload
POST /api/customer/catalogs
PUT /api/customer/catalogs/:id
DELETE /api/customer/catalogs/:id
POST /api/customer/catalogs/:id/editor-session
GET /api/customer/requests
POST /api/customer/requests
```

Kundenlogin:

```http
POST /api/customer-login
Content-Type: application/json
```

Login mit Kundennummer:

```json
{
  "customer_number": "0047",
  "password": "..."
}
```

Login mit E-Mail:

```json
{
  "email": "kunde@example.com",
  "password": "..."
}
```

Alternativ kann das Frontend ein allgemeines Feld `login` oder `identifier` senden:

```json
{
  "login": "0047 oder kunde@example.com",
  "password": "..."
}
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

Kundenprofil lesen:

```http
GET /api/customer/me
Authorization: Bearer <CUSTOMER_JWT>
```

Antwort:

```json
{
  "customer_number": "0047",
  "company_name": "Firma GmbH",
  "first_name": "Max",
  "last_name": "Mustermann",
  "email": "max@example.com",
  "phone": "+49 ...",
  "logo_url": "https://api.evolvetech-solutions.de/customer-assets/logo.png",
  "is_active": true
}
```

Kundenprofil aktualisieren:

```http
PUT /api/customer/me
Authorization: Bearer <CUSTOMER_JWT>
Content-Type: application/json
```

Body:

```json
{
  "company_name": "Firma GmbH",
  "first_name": "Max",
  "last_name": "Mustermann",
  "email": "max@example.com",
  "phone": "+49 ..."
}
```

Passwort aendern:

```http
PUT /api/customer/password
Authorization: Bearer <CUSTOMER_JWT>
Content-Type: application/json
```

Body:

```json
{
  "current_password": "altes-passwort",
  "new_password": "neues-sicheres-passwort"
}
```

Das neue Passwort muss mindestens 8 Zeichen lang sein.

Billing-Tarife abrufen:

```http
GET /api/customer/billing/plans
Authorization: Bearer <CUSTOMER_JWT>
```

Aktuelle Abo-Nutzung abrufen:

```http
GET /api/customer/billing/usage
Authorization: Bearer <CUSTOMER_JWT>
```

Antwort:

```json
{
  "plan": "starter",
  "plan_name": "SmartCatalog Starter",
  "subscription_status": "active",
  "subscription_active": true,
  "catalog_count": 3,
  "catalog_limit": 5,
  "catalogs_remaining": 2,
  "upload_limit_mb": 20,
  "can_create_catalog": true
}
```

Neue Kataloge koennen nur erstellt werden, wenn `subscription_active` true ist und `catalog_count` kleiner als `catalog_limit` ist. Bei ueberschrittenem Limit antwortet die API mit `CATALOG_LIMIT_REACHED`, bei fehlendem/ungueltigem Abo mit `SUBSCRIPTION_REQUIRED`.

Stripe Checkout starten:

```http
POST /api/customer/billing/checkout
Authorization: Bearer <CUSTOMER_JWT>
Content-Type: application/json
```

Body:

```json
{
  "plan": "starter"
}
```

Moegliche Werte:

- `starter`
- `business`
- `pro`

Antwort:

```json
{
  "checkout_url": "https://checkout.stripe.com/...",
  "session_id": "cs_..."
}
```

Stripe Customer Portal oeffnen:

```http
POST /api/customer/billing/portal
Authorization: Bearer <CUSTOMER_JWT>
```

Antwort:

```json
{
  "portal_url": "https://billing.stripe.com/..."
}
```

Stripe Webhook:

```http
POST /api/stripe/webhook
```

Der Webhook muss in Stripe mit `STRIPE_WEBHOOK_SECRET` konfiguriert werden. Relevante Events:

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.paid`
- `invoice.payment_failed`

```http
POST /api/customer/logo
Content-Type: multipart/form-data
Authorization: Bearer <CUSTOMER_JWT>

logo=<image file>
```

Beim Hochladen eines neuen Logos ersetzt die API das bisherige Kundenlogo und entfernt die alte Datei aus `customer-assets/`.

## SmartViewer V2

Oeffentliche Katalogdaten fuer den Viewer:

```http
GET /api/smartviewer-v2/catalogs/:catalogId
```

Antwort:

```json
{
  "catalog_id": "1777318518555",
  "id": 1777318518555,
  "title": "Katalogname",
  "customer": {
    "customer_number": "1234",
    "company_name": "Firma GmbH",
    "logo_url": "https://api.evolvetech-solutions.de/customer-assets/logo.png"
  },
  "pages": [
    {
      "page": 1,
      "image_url": "https://api.evolvetech-solutions.de/catalog-pages/1777318518555/page-1.jpg"
    }
  ],
  "hotspots": [
    {
      "id": "link-1",
      "type": "link",
      "page": 1,
      "title": "Angebot ansehen",
      "position": {
        "left": 0.12,
        "top": 0.34,
        "width": 0.2,
        "height": 0.14
      },
      "url": "https://example.com",
      "target": "_blank"
    }
  ]
}
```

Hotspots im Kundenportal lesen und speichern:

```http
GET /api/customer/catalogs/:id/hotspots
PUT /api/customer/catalogs/:id/hotspots
Authorization: Bearer <CUSTOMER_JWT>
Content-Type: application/json
```

PUT-Body:

```json
{
  "hotspots": [
    {
      "id": "angebot-1",
      "type": "product",
      "page": 2,
      "title": "Produkt",
      "position": {
        "left": 0.1,
        "top": 0.2,
        "width": 0.3,
        "height": 0.18
      },
      "product": {
        "name": "Produktname",
        "price": "9,99 EUR",
        "description": "Kurzbeschreibung",
        "image_url": "",
        "images": [],
        "url": "https://example.com/produkt",
        "sku": "ABC-123"
      }
    }
  ]
}
```

Unterstuetzte Hotspot-Typen:

- `link`: externer Link
- `product`: Produktkarte mit optionalem Produktlink
- `page`: Sprung zu einer anderen Seite
- `video`: Videolink
- `note`: reine Info

Produktbilder koennen direkt am Produkt-Hotspot hochgeladen werden. Pro Hotspot sind maximal 3 Bilder erlaubt, je Bild maximal 3 MB. Erlaubte Formate: JPG, PNG, WEBP und GIF.

```http
POST /api/customer/catalogs/:id/hotspots/:hotspotId/images
DELETE /api/customer/catalogs/:id/hotspots/:hotspotId/images
Authorization: Bearer <CUSTOMER_JWT>
```

Der Upload nutzt `multipart/form-data` mit dem Feld `images`. Der Delete-Request erwartet JSON:

```json
{
  "image_url": "https://api.evolvetech-solutions.de/customer-assets/products/datei.jpg"
}
```

Der kurzlebige Hotspot-Editor nutzt dieselbe Funktion ueber:

```http
POST /api/smartviewer-v2/editor/catalogs/:catalogId/hotspots/:hotspotId/images
DELETE /api/smartviewer-v2/editor/catalogs/:catalogId/hotspots/:hotspotId/images
Authorization: Bearer <EDIT_TOKEN>
```

Editor fuer Hostinger/Kundenportal:

```text
/smartviewer-v2/editor.html?catalog=<catalog_id>&id=<catalog_record_id>
```

Empfohlen: Das Kundenportal erzeugt vor dem Oeffnen einen kurzlebigen Editor-Link:

```http
POST /api/customer/catalogs/:id/editor-session
Authorization: Bearer <CUSTOMER_JWT>
```

Antwort:

```json
{
  "success": true,
  "catalog_id": "1777318518555",
  "id": 1777318518555,
  "editor_url": "https://api.evolvetech-solutions.de/smartviewer-v2/editor.html?catalog=1777318518555&id=1777318518555&edit_token=...",
  "expires_in_seconds": 7200
}
```

Der enthaltene `edit_token` ist nur fuer diesen Katalog und die Hotspot-Bearbeitung gueltig. Alternativ kann der Editor weiterhin einen Kunden-JWT aus `localStorage.smartcatalog_customer_token`, `localStorage.customerToken`, `localStorage.token` oder optional aus `?token=...` lesen.

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
