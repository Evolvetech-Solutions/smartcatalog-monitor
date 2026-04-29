import fs from "fs/promises";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";

const execFileAsync = promisify(execFile);

const BASE_URL = "https://api.evolvetech-solutions.de";
const URLS_FILE = "./urls.json";
const UPLOADS_DIR = "./uploads";
const CATALOG_PAGES_DIR = "./catalog-pages";

async function readJsonFile(file, fallback) {
  try {
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function writeJsonFile(file, data) {
  await fs.writeFile(file, JSON.stringify(data, null, 2), "utf8");
}

function getFilenameFromPdfUrl(pdfUrl) {
  if (!pdfUrl || !pdfUrl.includes("/uploads/")) return "";
  return decodeURIComponent(pdfUrl.split("/uploads/")[1]);
}

async function generateCatalogPages(pdfPath, catalogId) {
  const outputDir = `${CATALOG_PAGES_DIR}/${catalogId}`;
  await fs.mkdir(outputDir, { recursive: true });

  const outputPrefix = `${outputDir}/page`;

  await execFileAsync("pdftoppm", [
    "-jpeg",
    "-r",
    "140",
    pdfPath,
    outputPrefix
  ]);
}

async function main() {
  const urls = await readJsonFile(URLS_FILE, []);
  let changed = false;

  for (const item of urls) {
    if (item.catalog_id && item.flipbook_url) continue;
    if (!item.pdf_url) continue;

    const filename = getFilenameFromPdfUrl(item.pdf_url);
    if (!filename) continue;

    const pdfPath = path.join(UPLOADS_DIR, filename);

    try {
      await fs.access(pdfPath);

      const catalogId = String(item.id || Date.now());

      console.log(`Erzeuge SmartViewer-Seiten für: ${item.name || item.title || item.pdf_url}`);
      await generateCatalogPages(pdfPath, catalogId);

      item.catalog_id = catalogId;
      item.flipbook_url = `${BASE_URL}/smartviewer/index.html?catalog=${catalogId}`;

      // Optional: Primäre URL auf SmartViewer setzen
      item.url = item.flipbook_url;

      changed = true;
    } catch (err) {
      console.warn(`Übersprungen: ${filename} - ${err.message}`);
    }
  }

  if (changed) {
    await writeJsonFile(URLS_FILE, urls);
    console.log("Fertig: urls.json wurde aktualisiert.");
  } else {
    console.log("Keine Änderungen notwendig.");
  }
}

main();
