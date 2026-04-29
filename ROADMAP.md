# Product Roadmap

Diese Roadmap haelt den aktuellen Produktstand und die naechsten sinnvollen Schritte fest.

## Live-Stand

- VPS laeuft auf Ubuntu 24.04 mit PM2 und Nginx.
- API-Domain: `https://api.evolvetech-solutions.de`
- `smartcatalog-api` bedient `api.js`.
- `smartcatalog-monitor` bedient `monitor.js`.
- Healthcheck: `GET /health` gibt `{"ok":true}` zurueck.
- GitHub `main` ist die Quelle fuer Deployments.

## Produktfunktionen

- Kunden koennen sich einloggen.
- Kunden koennen Kataloge sehen, anlegen, bearbeiten und loeschen.
- PDFs koennen hochgeladen werden.
- Jeder Katalog kann zwei Anzeigewege haben:
  - PDF-Viewer: `/viewer/web/viewer.html?file=...`
  - SmartViewer: `/smartviewer/index.html?catalog=...`
- Das Backend ergaenzt fehlende SmartViewer-Felder aus `pdf_url`, wenn das Frontend sie nicht mitsendet.
- Monitoring prueft gespeicherte URLs regelmaessig und kann E-Mails versenden.

## Technischer Stand

- Lokale Entwicklung ist dokumentiert.
- Deployment ist dokumentiert.
- JSON-Dateien werden atomar geschrieben.
- Runtime-Backups entstehen unter `data-backups/`.
- PDF.js wird reproduzierbar ueber `pdfjs-dist` bereitgestellt.
- Production-Audit ist auf dem VPS sauber: `npm audit --omit=dev` meldet keine Schwachstellen.
- Dependencies sind fuer Node 18 auf dem VPS kompatibel.

## Bekannte Altlasten

- Auf dem VPS liegen noch alte Ordner:
  - `/root/smartcatalog-monitor/viewer`
  - `/root/smartcatalog-monitor/flipbook`
- Der neue PDF-Viewer braucht den alten `viewer/`-Ordner nicht mehr.
- Der alte `flipbook/`-Pfad ist kein offizieller Anzeigeweg mehr.
- Diese Ordner erst nach einem separaten Backup/Archivierungsschritt entfernen.

## Naechste Prioritaeten

1. Admin- und Kundenportal fachlich testen
   - Katalog erstellen
   - PDF oeffnen
   - SmartViewer oeffnen
   - Katalog bearbeiten
   - Katalog loeschen
   - Kundenlogin pruefen

2. Datenhaltung weiter stabilisieren
   - Kurzfristig: JSON-Backup-Rotation einbauen
   - Mittelfristig: SQLite oder PostgreSQL bewerten

3. Monitoring produktreifer machen
   - Konfigurierbare Check-Intervalle wirklich verwenden
   - Fehlerstatus und Historie im Frontend besser darstellen
   - Mail-Testfunktion fuer Admins ergaenzen

4. Sicherheit und Betrieb
   - Regelmaessige Server-Backups dokumentieren
   - PM2 Startup/Save pruefen
   - Nginx-Konfiguration dokumentiert halten
   - Zugangsdaten und Tokens regelmaessig rotieren

5. Produkt-UX
   - Hostinger-Frontend gegen `API.md` abgleichen
   - Fehlermeldungen beim Upload verbessern
   - Ladezustand fuer SmartViewer-Erzeugung anzeigen
   - Mobile Darstellung testen

## Deployment-Checkliste

```bash
cd /root/smartcatalog-monitor
git pull --ff-only
npm ci
npm audit --omit=dev
pm2 restart smartcatalog-api --update-env
pm2 restart smartcatalog-monitor --update-env
curl https://api.evolvetech-solutions.de/health
```
