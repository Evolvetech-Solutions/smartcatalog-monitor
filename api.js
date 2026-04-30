import express from "express";
import cors from "cors";
import fs from "fs/promises";
import dotenv from "dotenv";
import path from "path";
import multer from "multer";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { execFile } from "child_process";
import { promisify } from "util";
import { readJsonFile, writeJsonFile } from "./json-store.js";

dotenv.config();

const app = express();

const PORT = process.env.API_PORT || 3001;
const API_TOKEN = process.env.API_TOKEN || "";
const CUSTOMER_JWT_SECRET = process.env.CUSTOMER_JWT_SECRET || "change-me";

const BASE_URL = process.env.API_BASE_URL || `http://localhost:${PORT}`;

const URLS_FILE = "./urls.json";
const STATE_FILE = "./state.json";
const HISTORY_FILE = "./history.json";
const CUSTOMERS_FILE = "./customers.json";
const REQUESTS_FILE = "./requests.json";
const CATALOG_HOTSPOTS_FILE = "./catalog-hotspots.json";

const CATALOG_PAGES_DIR = "./catalog-pages";
const CUSTOMER_ASSETS_DIR = "./customer-assets";
const MAX_CATALOG_UPLOAD_BYTES = 20 * 1024 * 1024;
const execFileAsync = promisify(execFile);

async function ensureRuntimeDirs() {
  await Promise.all([
    fs.mkdir("./uploads", { recursive: true }),
    fs.mkdir(CATALOG_PAGES_DIR, { recursive: true }),
    fs.mkdir(CUSTOMER_ASSETS_DIR, { recursive: true })
  ]);
}

app.use(cors());
app.use(express.json());

app.use("/uploads", express.static(path.resolve("./uploads")));
app.get("/viewer/web/viewer.html", (req, res) => {
  res.sendFile(path.resolve("./pdf-viewer/viewer.html"));
});
app.use("/viewer", express.static(path.resolve("./viewer")));
app.use("/pdfjs/build", express.static(path.resolve("./node_modules/pdfjs-dist/build")));
app.use("/pdfjs/cmaps", express.static(path.resolve("./node_modules/pdfjs-dist/cmaps")));
app.use("/pdfjs/standard_fonts", express.static(path.resolve("./node_modules/pdfjs-dist/standard_fonts")));
app.use("/smartviewer", express.static(path.resolve("./smartviewer")));
app.use("/smartviewer-v2", express.static(path.resolve("./smartviewer-v2")));
app.use("/catalog-pages", express.static(path.resolve("./catalog-pages")));
app.use("/customer-assets", express.static(path.resolve("./customer-assets")));

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/\s+/g, "_");
    const uniqueName = Date.now() + "-" + safeName;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: MAX_CATALOG_UPLOAD_BYTES
  }
});

const logoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, CUSTOMER_ASSETS_DIR);
  },
  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]+/g, "_");
    cb(null, `${Date.now()}-${safeName}`);
  }
});

const logoUpload = multer({
  storage: logoStorage,
  limits: {
    fileSize: 2 * 1024 * 1024
  },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Nur Bilddateien sind erlaubt"));
    }

    cb(null, true);
  }
});

function adminAuth(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.replace("Bearer ", "").trim();

  if (!API_TOKEN || token !== API_TOKEN) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  next();
}

function customerAuth(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.replace("Bearer ", "").trim();

  if (!token) {
    return res.status(401).json({ error: "Customer token missing" });
  }

  try {
    const decoded = jwt.verify(token, CUSTOMER_JWT_SECRET);
    req.customer = decoded;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid customer token" });
  }
}

function editorAuth(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.replace("Bearer ", "").trim();

  if (!token) {
    return res.status(401).json({ error: "Editor token missing" });
  }

  try {
    const decoded = jwt.verify(token, CUSTOMER_JWT_SECRET);
    if (decoded.type !== "hotspot_editor") {
      return res.status(401).json({ error: "Invalid editor token" });
    }
    req.editor = decoded;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid editor token" });
  }
}

function normalizeTags(tags) {
  if (Array.isArray(tags)) {
    return tags.map((tag) => String(tag).trim()).filter(Boolean);
  }

  if (typeof tags === "string") {
    return tags
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
  }

  return [];
}

function normalizeCustomerNumber(value) {
  return String(value || "").trim();
}

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function isValidCustomerNumber(value) {
  return /^\d{4}$/.test(String(value || "").trim());
}

function buildCustomerProfile(customer) {
  return {
    customer_number: customer.customer_number,
    company_name: customer.company_name || "",
    first_name: customer.first_name || "",
    last_name: customer.last_name || "",
    email: customer.email || "",
    phone: customer.phone || "",
    logo_url: customer.logo_url || "",
    is_active: customer.is_active !== false,
    created_at: customer.created_at || null,
    updated_at: customer.updated_at || null
  };
}

function buildViewerUrl(pdfUrl) {
  if (!pdfUrl) return "";
  return `${BASE_URL}/viewer/web/viewer.html?file=${encodeURIComponent(pdfUrl)}`;
}

function buildFlipbookUrl(catalogId) {
  if (!catalogId) return "";
  return `${BASE_URL}/smartviewer/index.html?catalog=${catalogId}`;
}

function buildSmartviewerV2Url(catalogId) {
  if (!catalogId) return "";
  return `${BASE_URL}/smartviewer-v2/index.html?catalog=${catalogId}`;
}

function getUploadPathFromPdfUrl(pdfUrl) {
  if (!pdfUrl || !pdfUrl.includes("/uploads/")) return "";
  const fileName = decodeURIComponent(pdfUrl.split("/uploads/")[1] || "");
  return fileName ? path.join("./uploads", fileName) : "";
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

  const files = await fs.readdir(outputDir);

  const pages = files
    .filter((file) => file.endsWith(".jpg"))
    .sort((a, b) => {
      const numA = Number(a.match(/\d+/)?.[0] || 0);
      const numB = Number(b.match(/\d+/)?.[0] || 0);
      return numA - numB;
    })
    .map((file) => `${BASE_URL}/catalog-pages/${catalogId}/${file}`);

  return {
    catalog_id: String(catalogId),
    pages
  };
}

async function ensureSmartviewerFields({ id, pdfUrl, catalogId, flipbookUrl }) {
  const finalCatalogId = catalogId || (pdfUrl ? String(id) : "");

  if (!pdfUrl || !finalCatalogId) {
    return {
      catalog_id: finalCatalogId,
      flipbook_url: flipbookUrl || ""
    };
  }

  const outputDir = `${CATALOG_PAGES_DIR}/${finalCatalogId}`;
  const pdfPath = getUploadPathFromPdfUrl(pdfUrl);
  let hasPages = false;

  try {
    const existingPages = await fs.readdir(outputDir).catch(() => []);
    hasPages = existingPages.some((file) => file.endsWith(".jpg"));

    if (!hasPages && pdfPath) {
      await fs.access(pdfPath);
      await generateCatalogPages(pdfPath, finalCatalogId);
      hasPages = true;
    }
  } catch (error) {
    console.warn(
      `Smartviewer-Seiten konnten nicht automatisch erzeugt werden: ${error.message}`
    );
  }

  return {
    catalog_id: hasPages || flipbookUrl ? finalCatalogId : "",
    flipbook_url: flipbookUrl || (hasPages ? buildFlipbookUrl(finalCatalogId) : "")
  };
}

function buildStatusEntry(item, states, history) {
  const stateEntry = states[item.url] || {};
  const historyEntry = history[item.url] || [];

  return {
    id: item.id,
    name: item.name || item.title || "Ohne Titel",
    title: item.title || item.name || "Ohne Titel",
    customer_number: item.customer_number || "",
    url: item.url,
    pdf_url: item.pdf_url || "",
    viewer_url: item.viewer_url || "",
    catalog_id: item.catalog_id || "",
    flipbook_url:
      item.flipbook_url ||
      (item.catalog_id ? buildFlipbookUrl(item.catalog_id) : ""),
    smartviewer_v2_url:
      item.smartviewer_v2_url ||
      (item.catalog_id ? buildSmartviewerV2Url(item.catalog_id) : ""),
    linkly_url: item.linkly_url || "",
    tags: normalizeTags(item.tags),
    error_text:
      item.error_text ||
      "Das Dokument wurde gelöscht und steht nicht mehr zur Verfügung.",
    is_active: item.is_active ?? true,
    check_interval_minutes: item.check_interval_minutes ?? 60,
    notification_email: item.notification_email || "",
    status: stateEntry.errorFound ? "error" : "ok",
    last_checked_at: stateEntry.checkedAt || null,
    last_checked_at_formatted: stateEntry.checkedAt
      ? new Date(stateEntry.checkedAt).toLocaleString("de-DE")
      : "Nie geprüft",
    history: historyEntry
  };
}

function normalizeHotspotPosition(position = {}) {
  const clamp = (value) => Math.max(0, Math.min(1, Number(value) || 0));

  return {
    left: clamp(position.left),
    top: clamp(position.top),
    width: clamp(position.width),
    height: clamp(position.height)
  };
}

function normalizeHotspots(hotspots) {
  if (!Array.isArray(hotspots)) return [];

  const allowedTypes = new Set(["link", "product", "page", "video", "note"]);

  return hotspots.slice(0, 500).map((hotspot) => {
    const type = allowedTypes.has(hotspot.type) ? hotspot.type : "link";
    const page = Math.max(1, Number.parseInt(hotspot.page, 10) || 1);
    const normalized = {
      id: String(hotspot.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`),
      type,
      page,
      title: String(hotspot.title || "").trim(),
      label: String(hotspot.label || "").trim(),
      show_icon: hotspot.show_icon !== false,
      position: normalizeHotspotPosition(hotspot.position),
      updated_at: new Date().toISOString()
    };

    if (type === "link" || type === "video") {
      normalized.url = String(hotspot.url || "").trim();
      normalized.target = hotspot.target === "_self" ? "_self" : "_blank";
    }

    if (type === "page") {
      normalized.target_page = Math.max(1, Number.parseInt(hotspot.target_page, 10) || page);
    }

    if (type === "product") {
      normalized.product = {
        name: String(hotspot.product?.name || hotspot.title || "").trim(),
        price: String(hotspot.product?.price || "").trim(),
        description: String(hotspot.product?.description || "").trim(),
        image_url: String(hotspot.product?.image_url || "").trim(),
        url: String(hotspot.product?.url || hotspot.url || "").trim(),
        sku: String(hotspot.product?.sku || "").trim()
      };
    }

    return normalized;
  });
}

async function readCatalogHotspots(catalogId) {
  const allHotspots = await readJsonFile(CATALOG_HOTSPOTS_FILE, {});
  return normalizeHotspots(allHotspots[String(catalogId)] || []);
}

async function writeCatalogHotspots(catalogId, hotspots) {
  const allHotspots = await readJsonFile(CATALOG_HOTSPOTS_FILE, {});
  allHotspots[String(catalogId)] = normalizeHotspots(hotspots);
  await writeJsonFile(CATALOG_HOTSPOTS_FILE, allHotspots);
  return allHotspots[String(catalogId)];
}

async function getCatalogPages(catalogId) {
  const outputDir = `${CATALOG_PAGES_DIR}/${catalogId}`;
  const files = await fs.readdir(outputDir).catch(() => []);

  return files
    .filter((file) => file.toLowerCase().endsWith(".jpg"))
    .sort((a, b) => {
      const numA = Number(a.match(/\d+/)?.[0] || 0);
      const numB = Number(b.match(/\d+/)?.[0] || 0);
      return numA - numB;
    })
    .map((file, index) => ({
      page: index + 1,
      image_url: `${BASE_URL}/catalog-pages/${catalogId}/${file}`
    }));
}

async function findCustomerCatalogById(customerNumber, id) {
  const urls = await readJsonFile(URLS_FILE, []);
  return urls.find(
    (item) => item.id === Number(id) && item.customer_number === customerNumber
  );
}

async function findCustomerCatalogByCatalogId(customerNumber, catalogId) {
  const urls = await readJsonFile(URLS_FILE, []);
  return urls.find(
    (item) =>
      String(item.catalog_id || "") === String(catalogId || "") &&
      item.customer_number === customerNumber
  );
}

function buildPublicCustomer(customer) {
  if (!customer) return null;

  return {
    customer_number: customer.customer_number,
    company_name: customer.company_name || "",
    logo_url: customer.logo_url || ""
  };
}

async function deleteCustomerAsset(assetUrl) {
  if (!assetUrl || !assetUrl.includes("/customer-assets/")) return;

  const fileName = assetUrl.split("/customer-assets/")[1];
  if (!fileName) return;

  try {
    await fs.unlink(path.join(CUSTOMER_ASSETS_DIR, fileName));
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.warn("Altes Kundenlogo konnte nicht geloescht werden:", error.message);
    }
  }
}

async function deleteRelatedFiles(item) {
  if (item?.pdf_url) {
    try {
      const fileName = item.pdf_url.split("/uploads/")[1];
      if (fileName) {
        await fs.unlink(`./uploads/${fileName}`);
      }
    } catch (err) {
      console.warn("PDF konnte nicht gelöscht werden:", err.message);
    }
  }

  if (item?.catalog_id) {
    try {
      await fs.rm(`${CATALOG_PAGES_DIR}/${item.catalog_id}`, {
        recursive: true,
        force: true
      });
    } catch (err) {
      console.warn("Catalog-Pages konnten nicht gelöscht werden:", err.message);
    }

    try {
      const allHotspots = await readJsonFile(CATALOG_HOTSPOTS_FILE, {});
      if (allHotspots[String(item.catalog_id)]) {
        delete allHotspots[String(item.catalog_id)];
        await writeJsonFile(CATALOG_HOTSPOTS_FILE, allHotspots);
      }
    } catch (err) {
      console.warn("Katalog-Hotspots konnten nicht gelöscht werden:", err.message);
    }
  }
}

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

/* =========================
   ADMIN API
========================= */

app.get("/api/status", adminAuth, async (req, res) => {
  const urls = await readJsonFile(URLS_FILE, []);
  const states = await readJsonFile(STATE_FILE, {});
  const history = await readJsonFile(HISTORY_FILE, {});

  res.json(urls.map((item) => buildStatusEntry(item, states, history)));
});

app.get("/api/tags", adminAuth, async (req, res) => {
  const urls = await readJsonFile(URLS_FILE, []);
  const allTags = urls.flatMap((item) => normalizeTags(item.tags));
  const uniqueTags = [...new Set(allTags.map((tag) => tag.trim()).filter(Boolean))].sort(
    (a, b) => a.localeCompare(b, "de")
  );

  res.json(uniqueTags);
});

app.get("/api/viewer-settings/:catalogId", async (req, res) => {
  const catalogId = String(req.params.catalogId || "").trim();

  if (!catalogId) {
    return res.status(400).json({ error: "catalogId ist erforderlich" });
  }

  const urls = await readJsonFile(URLS_FILE, []);
  const customers = await readJsonFile(CUSTOMERS_FILE, []);
  const catalog = urls.find((item) => String(item.catalog_id || "") === catalogId);

  if (!catalog) {
    return res.json({
      catalog_id: catalogId,
      title: "",
      customer: null
    });
  }

  const customer = customers.find(
    (entry) => entry.customer_number === catalog.customer_number
  );

  res.json({
    catalog_id: catalogId,
    title: catalog.title || catalog.name || "",
    customer: buildPublicCustomer(customer)
  });
});

app.get("/api/smartviewer-v2/catalogs/:catalogId", async (req, res) => {
  const catalogId = String(req.params.catalogId || "").trim();

  if (!catalogId) {
    return res.status(400).json({ error: "catalogId ist erforderlich" });
  }

  const urls = await readJsonFile(URLS_FILE, []);
  const customers = await readJsonFile(CUSTOMERS_FILE, []);
  const catalog = urls.find((item) => String(item.catalog_id || "") === catalogId);

  if (!catalog) {
    return res.status(404).json({ error: "Katalog nicht gefunden" });
  }

  const customer = customers.find(
    (entry) => entry.customer_number === catalog.customer_number
  );
  const pages = await getCatalogPages(catalogId);
  const hotspots = await readCatalogHotspots(catalogId);

  res.json({
    catalog_id: catalogId,
    id: catalog.id,
    title: catalog.title || catalog.name || "",
    pdf_url: catalog.pdf_url || "",
    viewer_url: catalog.viewer_url || "",
    legacy_smartviewer_url: catalog.flipbook_url || buildFlipbookUrl(catalogId),
    smartviewer_v2_url: buildSmartviewerV2Url(catalogId),
    customer: buildPublicCustomer(customer),
    pages,
    hotspots,
    features: {
      swipe: true,
      pinch_zoom: true,
      pan_when_zoomed: true,
      hotspots: true
    }
  });
});

app.post("/api/upload", adminAuth, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Keine Datei hochgeladen" });
    }

    const catalogId = Date.now();
    const fileUrl = `${BASE_URL}/uploads/${req.file.filename}`;
    const viewerUrl = buildViewerUrl(fileUrl);

    const generated = await generateCatalogPages(req.file.path, catalogId);
    const flipbookUrl = buildFlipbookUrl(catalogId);
    const smartviewerV2Url = buildSmartviewerV2Url(catalogId);

    res.json({
      message: "Upload erfolgreich",
      url: fileUrl,
      pdf_url: fileUrl,
      viewer_url: viewerUrl,
      catalog_id: String(catalogId),
      flipbook_url: flipbookUrl,
      smartviewer_v2_url: smartviewerV2Url,
      pages: generated.pages,
      filename: req.file.filename,
      originalname: req.file.originalname
    });
  } catch (error) {
    console.error("Upload Fehler:", error);
    res.status(500).json({
      error: "Upload oder Katalog-Konvertierung fehlgeschlagen",
      details: error.message
    });
  }
});

app.post("/api/urls", adminAuth, async (req, res) => {
  const {
    name,
    title,
    customer_number,
    url,
    pdf_url,
    viewer_url,
    catalog_id,
    flipbook_url,
    linkly_url,
    tags,
    error_text,
    description,
    is_active = true,
    check_interval_minutes = 60,
    notification_email = ""
  } = req.body;

  const finalCustomerNumber = normalizeCustomerNumber(customer_number);

  if (!isValidCustomerNumber(finalCustomerNumber)) {
    return res.status(400).json({
      error: "customer_number ist erforderlich und muss genau 4 Ziffern enthalten"
    });
  }

  const finalName = name || title || "Ohne Titel";
  const finalPdfUrl = pdf_url || "";
  const finalViewerUrl = viewer_url || (finalPdfUrl ? buildViewerUrl(finalPdfUrl) : "");
  const id = Date.now();
  const smartviewerFields = await ensureSmartviewerFields({
    id,
    pdfUrl: finalPdfUrl,
    catalogId: catalog_id || "",
    flipbookUrl: flipbook_url || ""
  });
  const finalCatalogId = smartviewerFields.catalog_id;
  const finalFlipbookUrl = smartviewerFields.flipbook_url;
  const finalSmartviewerV2Url = finalCatalogId ? buildSmartviewerV2Url(finalCatalogId) : "";
  const finalUrl = url || finalFlipbookUrl || finalViewerUrl || finalPdfUrl;

  if (!finalUrl) {
    return res.status(400).json({ error: "url, flipbook_url, viewer_url oder pdf_url ist erforderlich" });
  }

  const finalErrorText =
    error_text ||
    description ||
    "Das Dokument wurde gelöscht und steht nicht mehr zur Verfügung.";

  const urls = await readJsonFile(URLS_FILE, []);

  const newItem = {
    id,
    name: finalName,
    title: finalName,
    customer_number: finalCustomerNumber,
    url: finalUrl,
    pdf_url: finalPdfUrl,
    viewer_url: finalViewerUrl,
    catalog_id: finalCatalogId,
    flipbook_url: finalFlipbookUrl,
    smartviewer_v2_url: finalSmartviewerV2Url,
    linkly_url: linkly_url || "",
    tags: normalizeTags(tags),
    error_text: finalErrorText,
    is_active,
    check_interval_minutes,
    notification_email
  };

  urls.push(newItem);
  await writeJsonFile(URLS_FILE, urls);

  res.status(201).json(newItem);
});

app.put("/api/urls/:id", adminAuth, async (req, res) => {
  const id = Number(req.params.id);
  const urls = await readJsonFile(URLS_FILE, []);
  const index = urls.findIndex((item) => item.id === id);

  if (index === -1) {
    return res.status(404).json({ error: "Eintrag nicht gefunden" });
  }

  const {
    name,
    title,
    customer_number,
    url,
    pdf_url,
    viewer_url,
    catalog_id,
    flipbook_url,
    linkly_url,
    tags,
    error_text,
    description,
    is_active,
    check_interval_minutes,
    notification_email
  } = req.body;

  const existingItem = urls[index];

  const finalCustomerNumber =
    customer_number !== undefined
      ? normalizeCustomerNumber(customer_number)
      : existingItem.customer_number || "";

  if (!isValidCustomerNumber(finalCustomerNumber)) {
    return res.status(400).json({
      error: "customer_number ist erforderlich und muss genau 4 Ziffern enthalten"
    });
  }

  const finalPdfUrl = pdf_url !== undefined ? pdf_url : existingItem.pdf_url || "";

  const finalViewerUrl =
    viewer_url !== undefined
      ? viewer_url
      : existingItem.viewer_url || (finalPdfUrl ? buildViewerUrl(finalPdfUrl) : "");

  const finalCatalogId =
    catalog_id !== undefined ? catalog_id : existingItem.catalog_id || "";

  const smartviewerFields = await ensureSmartviewerFields({
    id,
    pdfUrl: finalPdfUrl,
    catalogId: finalCatalogId,
    flipbookUrl:
      flipbook_url !== undefined ? flipbook_url : existingItem.flipbook_url || ""
  });

  const resolvedCatalogId = smartviewerFields.catalog_id;
  const finalFlipbookUrl = smartviewerFields.flipbook_url;
  const finalSmartviewerV2Url = resolvedCatalogId ? buildSmartviewerV2Url(resolvedCatalogId) : "";

  const finalUrl = url || finalFlipbookUrl || finalViewerUrl || existingItem.url;

  urls[index] = {
    ...existingItem,
    name: name || title || existingItem.name || "Ohne Titel",
    title: title || name || existingItem.title || existingItem.name || "Ohne Titel",
    customer_number: finalCustomerNumber,
    url: finalUrl,
    pdf_url: finalPdfUrl,
    viewer_url: finalViewerUrl,
    catalog_id: resolvedCatalogId,
    flipbook_url: finalFlipbookUrl,
    smartviewer_v2_url: finalSmartviewerV2Url,
    linkly_url: linkly_url !== undefined ? linkly_url : existingItem.linkly_url,
    tags: tags !== undefined ? normalizeTags(tags) : normalizeTags(existingItem.tags),
    error_text:
      error_text ||
      description ||
      existingItem.error_text ||
      "Das Dokument wurde gelöscht und steht nicht mehr zur Verfügung.",
    is_active:
      typeof is_active === "boolean" ? is_active : existingItem.is_active,
    check_interval_minutes:
      typeof check_interval_minutes === "number"
        ? check_interval_minutes
        : existingItem.check_interval_minutes,
    notification_email:
      notification_email !== undefined
        ? notification_email
        : existingItem.notification_email,
    id
  };

  await writeJsonFile(URLS_FILE, urls);
  res.json(urls[index]);
});

app.delete("/api/urls/:id", adminAuth, async (req, res) => {
  const id = Number(req.params.id);
  const urls = await readJsonFile(URLS_FILE, []);
  const item = urls.find((entry) => entry.id === id);

  if (!item) {
    return res.status(404).json({ error: "Eintrag nicht gefunden" });
  }

  await deleteRelatedFiles(item);

  const filtered = urls.filter((entry) => entry.id !== id);
  await writeJsonFile(URLS_FILE, filtered);

  res.json({ success: true });
});

/* =========================
   CUSTOMER AUTH
========================= */

app.post("/api/customer-login", async (req, res) => {
  const { customer_number, password } = req.body;

  const normalizedCustomerNumber = normalizeCustomerNumber(customer_number);

  if (!isValidCustomerNumber(normalizedCustomerNumber) || !password) {
    return res.status(400).json({
      error: "customer_number und password sind erforderlich"
    });
  }

  const customers = await readJsonFile(CUSTOMERS_FILE, []);
  const customer = customers.find(
    (entry) =>
      entry.customer_number === normalizedCustomerNumber &&
      entry.is_active !== false
  );

  if (!customer) {
    return res.status(401).json({ error: "Login fehlgeschlagen" });
  }

  const passwordOk = await bcrypt.compare(password, customer.password_hash || "");

  if (!passwordOk) {
    return res.status(401).json({ error: "Login fehlgeschlagen" });
  }

  const token = jwt.sign(
    {
      customer_number: customer.customer_number,
      company_name: customer.company_name || ""
    },
    CUSTOMER_JWT_SECRET,
    { expiresIn: "7d" }
  );

  res.json({
    success: true,
    token,
    customer: {
      customer_number: customer.customer_number,
      company_name: customer.company_name || ""
    }
  });
});

/* =========================
   CUSTOMER PORTAL API
========================= */

app.get("/api/customer/me", customerAuth, async (req, res) => {
  const customers = await readJsonFile(CUSTOMERS_FILE, []);
  const customer = customers.find(
    (entry) => entry.customer_number === req.customer.customer_number
  );

  if (!customer) {
    return res.status(404).json({ error: "Kunde nicht gefunden" });
  }

  res.json(buildCustomerProfile(customer));
});

app.put("/api/customer/me", customerAuth, async (req, res) => {
  const {
    company_name,
    first_name,
    last_name,
    email,
    phone
  } = req.body;

  const customers = await readJsonFile(CUSTOMERS_FILE, []);
  const index = customers.findIndex(
    (entry) => entry.customer_number === req.customer.customer_number
  );

  if (index === -1) {
    return res.status(404).json({ error: "Kunde nicht gefunden" });
  }

  const nextEmail = email !== undefined ? normalizeEmail(email) : customers[index].email || "";
  if (nextEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextEmail)) {
    return res.status(400).json({ error: "E-Mail-Adresse ist ungültig" });
  }

  customers[index] = {
    ...customers[index],
    company_name:
      company_name !== undefined ? normalizeText(company_name) : customers[index].company_name || "",
    first_name:
      first_name !== undefined ? normalizeText(first_name) : customers[index].first_name || "",
    last_name:
      last_name !== undefined ? normalizeText(last_name) : customers[index].last_name || "",
    email: nextEmail,
    phone: phone !== undefined ? normalizeText(phone) : customers[index].phone || "",
    updated_at: new Date().toISOString()
  };

  await writeJsonFile(CUSTOMERS_FILE, customers);
  res.json(buildCustomerProfile(customers[index]));
});

app.put("/api/customer/password", customerAuth, async (req, res) => {
  const { current_password, new_password } = req.body;

  if (!current_password || !new_password) {
    return res.status(400).json({
      error: "Aktuelles Passwort und neues Passwort sind erforderlich"
    });
  }

  if (String(new_password).length < 8) {
    return res.status(400).json({
      error: "Das neue Passwort muss mindestens 8 Zeichen lang sein"
    });
  }

  const customers = await readJsonFile(CUSTOMERS_FILE, []);
  const index = customers.findIndex(
    (entry) => entry.customer_number === req.customer.customer_number
  );

  if (index === -1) {
    return res.status(404).json({ error: "Kunde nicht gefunden" });
  }

  const passwordOk = await bcrypt.compare(
    String(current_password),
    customers[index].password_hash || ""
  );

  if (!passwordOk) {
    return res.status(401).json({ error: "Aktuelles Passwort ist falsch" });
  }

  customers[index] = {
    ...customers[index],
    password_hash: await bcrypt.hash(String(new_password), 10),
    updated_at: new Date().toISOString()
  };

  await writeJsonFile(CUSTOMERS_FILE, customers);
  res.json({ success: true });
});

app.post("/api/customer/logo", customerAuth, logoUpload.single("logo"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Keine Logo-Datei hochgeladen" });
    }

    const customers = await readJsonFile(CUSTOMERS_FILE, []);
    const index = customers.findIndex(
      (entry) => entry.customer_number === req.customer.customer_number
    );

    if (index === -1) {
      return res.status(404).json({ error: "Kunde nicht gefunden" });
    }

    const logoUrl = `${BASE_URL}/customer-assets/${req.file.filename}`;
    const previousLogoUrl = customers[index].logo_url || "";

    customers[index] = {
      ...customers[index],
      logo_url: logoUrl,
      updated_at: new Date().toISOString()
    };

    await writeJsonFile(CUSTOMERS_FILE, customers);
    await deleteCustomerAsset(previousLogoUrl);

    res.json({
      success: true,
      logo_url: logoUrl
    });
  } catch (error) {
    res.status(500).json({
      error: "Logo konnte nicht gespeichert werden",
      details: error.message
    });
  }
});

app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: "Datei größer als 20 MB" });
  }

  if (error instanceof multer.MulterError || error.message === "Nur Bilddateien sind erlaubt") {
    return res.status(400).json({ error: error.message });
  }

  next(error);
});

app.get("/api/customer/catalogs", customerAuth, async (req, res) => {
  const urls = await readJsonFile(URLS_FILE, []);
  const states = await readJsonFile(STATE_FILE, {});
  const history = await readJsonFile(HISTORY_FILE, {});

  const customerUrls = urls.filter(
    (item) => item.customer_number === req.customer.customer_number
  );

  res.json(customerUrls.map((item) => buildStatusEntry(item, states, history)));
});

app.post("/api/customer/upload", customerAuth, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Keine Datei hochgeladen" });
    }

    const catalogId = Date.now();
    const fileUrl = `${BASE_URL}/uploads/${req.file.filename}`;
    const viewerUrl = buildViewerUrl(fileUrl);

    const generated = await generateCatalogPages(req.file.path, catalogId);
    const flipbookUrl = buildFlipbookUrl(catalogId);
    const smartviewerV2Url = buildSmartviewerV2Url(catalogId);

    res.json({
      message: "Upload erfolgreich",
      pdf_url: fileUrl,
      viewer_url: viewerUrl,
      catalog_id: String(catalogId),
      flipbook_url: flipbookUrl,
      smartviewer_v2_url: smartviewerV2Url,
      pages: generated.pages,
      filename: req.file.filename,
      originalname: req.file.originalname
    });
  } catch (error) {
    console.error("Customer Upload Fehler:", error);
    res.status(500).json({
      error: "Upload oder Katalog-Konvertierung fehlgeschlagen",
      details: error.message
    });
  }
});

app.post("/api/customer/catalogs", customerAuth, async (req, res) => {
  const {
    name,
    title,
    url,
    pdf_url,
    viewer_url,
    catalog_id,
    flipbook_url,
    tags,
    error_text,
    description,
    is_active = true,
    check_interval_minutes = 60,
    notification_email = ""
  } = req.body;

  const finalName = name || title || "Ohne Titel";
  const finalPdfUrl = pdf_url || "";
  const finalViewerUrl = viewer_url || (finalPdfUrl ? buildViewerUrl(finalPdfUrl) : "");
  const id = Date.now();
  const smartviewerFields = await ensureSmartviewerFields({
    id,
    pdfUrl: finalPdfUrl,
    catalogId: catalog_id || "",
    flipbookUrl: flipbook_url || ""
  });
  const finalCatalogId = smartviewerFields.catalog_id;
  const finalFlipbookUrl = smartviewerFields.flipbook_url;
  const finalUrl = url || finalFlipbookUrl || finalViewerUrl || finalPdfUrl;

  if (!finalUrl) {
    return res.status(400).json({ error: "url, flipbook_url, viewer_url oder pdf_url ist erforderlich" });
  }

  const finalErrorText =
    error_text ||
    description ||
    "Das Dokument wurde gelöscht und steht nicht mehr zur Verfügung.";

  const urls = await readJsonFile(URLS_FILE, []);

  const newItem = {
    id,
    name: finalName,
    title: finalName,
    customer_number: req.customer.customer_number,
    url: finalUrl,
    pdf_url: finalPdfUrl,
    viewer_url: finalViewerUrl,
    catalog_id: finalCatalogId,
    flipbook_url: finalFlipbookUrl,
    smartviewer_v2_url: finalCatalogId ? buildSmartviewerV2Url(finalCatalogId) : "",
    linkly_url: "",
    tags: normalizeTags(tags),
    error_text: finalErrorText,
    is_active,
    check_interval_minutes,
    notification_email
  };

  urls.push(newItem);
  await writeJsonFile(URLS_FILE, urls);

  res.status(201).json(newItem);
});

app.put("/api/customer/catalogs/:id", customerAuth, async (req, res) => {
  const id = Number(req.params.id);
  const urls = await readJsonFile(URLS_FILE, []);
  const index = urls.findIndex(
    (item) =>
      item.id === id &&
      item.customer_number === req.customer.customer_number
  );

  if (index === -1) {
    return res.status(404).json({ error: "Eintrag nicht gefunden" });
  }

  const existingItem = urls[index];

  const {
    name,
    title,
    url,
    pdf_url,
    viewer_url,
    catalog_id,
    flipbook_url,
    tags,
    error_text,
    description,
    is_active,
    check_interval_minutes,
    notification_email
  } = req.body;

  const finalPdfUrl = pdf_url !== undefined ? pdf_url : existingItem.pdf_url || "";

  const finalViewerUrl =
    viewer_url !== undefined
      ? viewer_url
      : existingItem.viewer_url || (finalPdfUrl ? buildViewerUrl(finalPdfUrl) : "");

  const finalCatalogId =
    catalog_id !== undefined ? catalog_id : existingItem.catalog_id || "";

  const smartviewerFields = await ensureSmartviewerFields({
    id,
    pdfUrl: finalPdfUrl,
    catalogId: finalCatalogId,
    flipbookUrl:
      flipbook_url !== undefined ? flipbook_url : existingItem.flipbook_url || ""
  });

  const resolvedCatalogId = smartviewerFields.catalog_id;
  const finalFlipbookUrl = smartviewerFields.flipbook_url;

  const finalUrl = url || finalFlipbookUrl || finalViewerUrl || existingItem.url;

  urls[index] = {
    ...existingItem,
    name: name || title || existingItem.name || "Ohne Titel",
    title: title || name || existingItem.title || existingItem.name || "Ohne Titel",
    customer_number: req.customer.customer_number,
    url: finalUrl,
    pdf_url: finalPdfUrl,
    viewer_url: finalViewerUrl,
    catalog_id: resolvedCatalogId,
    flipbook_url: finalFlipbookUrl,
    smartviewer_v2_url: resolvedCatalogId ? buildSmartviewerV2Url(resolvedCatalogId) : "",
    tags: tags !== undefined ? normalizeTags(tags) : normalizeTags(existingItem.tags),
    error_text:
      error_text ||
      description ||
      existingItem.error_text ||
      "Das Dokument wurde gelöscht und steht nicht mehr zur Verfügung.",
    is_active:
      typeof is_active === "boolean" ? is_active : existingItem.is_active,
    check_interval_minutes:
      typeof check_interval_minutes === "number"
        ? check_interval_minutes
        : existingItem.check_interval_minutes,
    notification_email:
      notification_email !== undefined
        ? notification_email
        : existingItem.notification_email
  };

  await writeJsonFile(URLS_FILE, urls);
  res.json(urls[index]);
});

app.post("/api/customer/catalogs/:id/editor-session", customerAuth, async (req, res) => {
  const catalog = await findCustomerCatalogById(
    req.customer.customer_number,
    req.params.id
  );

  if (!catalog) {
    return res.status(404).json({ error: "Katalog nicht gefunden" });
  }

  if (!catalog.catalog_id) {
    return res.status(400).json({ error: "Katalog hat keine catalog_id" });
  }

  const editorToken = jwt.sign(
    {
      type: "hotspot_editor",
      customer_number: req.customer.customer_number,
      catalog_id: String(catalog.catalog_id),
      catalog_item_id: catalog.id
    },
    CUSTOMER_JWT_SECRET,
    { expiresIn: "2h" }
  );

  const editorUrl =
    `${BASE_URL}/smartviewer-v2/editor.html` +
    `?catalog=${encodeURIComponent(catalog.catalog_id)}` +
    `&id=${encodeURIComponent(catalog.id)}` +
    `&edit_token=${encodeURIComponent(editorToken)}`;

  res.json({
    success: true,
    catalog_id: catalog.catalog_id,
    id: catalog.id,
    editor_url: editorUrl,
    editor_token: editorToken,
    expires_in_seconds: 7200
  });
});

app.get("/api/customer/catalogs/:id/hotspots", customerAuth, async (req, res) => {
  const catalog = await findCustomerCatalogById(
    req.customer.customer_number,
    req.params.id
  );

  if (!catalog) {
    return res.status(404).json({ error: "Katalog nicht gefunden" });
  }

  if (!catalog.catalog_id) {
    return res.status(400).json({ error: "Katalog hat keine catalog_id" });
  }

  const hotspots = await readCatalogHotspots(catalog.catalog_id);

  res.json({
    catalog_id: catalog.catalog_id,
    catalog_title: catalog.title || catalog.name || "",
    hotspots
  });
});

app.put("/api/customer/catalogs/:id/hotspots", customerAuth, async (req, res) => {
  const catalog = await findCustomerCatalogById(
    req.customer.customer_number,
    req.params.id
  );

  if (!catalog) {
    return res.status(404).json({ error: "Katalog nicht gefunden" });
  }

  if (!catalog.catalog_id) {
    return res.status(400).json({ error: "Katalog hat keine catalog_id" });
  }

  const hotspots = await writeCatalogHotspots(
    catalog.catalog_id,
    req.body.hotspots || []
  );

  res.json({
    success: true,
    catalog_id: catalog.catalog_id,
    hotspots
  });
});

app.get("/api/smartviewer-v2/editor/catalogs/:catalogId/hotspots", editorAuth, async (req, res) => {
  if (String(req.editor.catalog_id) !== String(req.params.catalogId)) {
    return res.status(403).json({ error: "Editor token passt nicht zu diesem Katalog" });
  }

  const catalog = await findCustomerCatalogByCatalogId(
    req.editor.customer_number,
    req.params.catalogId
  );

  if (!catalog) {
    return res.status(404).json({ error: "Katalog nicht gefunden" });
  }

  const hotspots = await readCatalogHotspots(catalog.catalog_id);

  res.json({
    catalog_id: catalog.catalog_id,
    id: catalog.id,
    catalog_title: catalog.title || catalog.name || "",
    hotspots
  });
});

app.put("/api/smartviewer-v2/editor/catalogs/:catalogId/hotspots", editorAuth, async (req, res) => {
  if (String(req.editor.catalog_id) !== String(req.params.catalogId)) {
    return res.status(403).json({ error: "Editor token passt nicht zu diesem Katalog" });
  }

  const catalog = await findCustomerCatalogByCatalogId(
    req.editor.customer_number,
    req.params.catalogId
  );

  if (!catalog) {
    return res.status(404).json({ error: "Katalog nicht gefunden" });
  }

  const hotspots = await writeCatalogHotspots(
    catalog.catalog_id,
    req.body.hotspots || []
  );

  res.json({
    success: true,
    catalog_id: catalog.catalog_id,
    id: catalog.id,
    hotspots
  });
});

app.delete("/api/customer/catalogs/:id", customerAuth, async (req, res) => {
  const id = Number(req.params.id);
  const urls = await readJsonFile(URLS_FILE, []);
  const item = urls.find(
    (entry) =>
      entry.id === id &&
      entry.customer_number === req.customer.customer_number
  );

  if (!item) {
    return res.status(404).json({ error: "Eintrag nicht gefunden" });
  }

  await deleteRelatedFiles(item);

  const filtered = urls.filter((entry) => entry.id !== id);
  await writeJsonFile(URLS_FILE, filtered);

  res.json({ success: true });
});

app.get("/api/customer/requests", customerAuth, async (req, res) => {
  const requests = await readJsonFile(REQUESTS_FILE, []);
  const customerRequests = requests.filter(
    (entry) => entry.customer_number === req.customer.customer_number
  );

  res.json(customerRequests);
});

app.post("/api/customer/requests", customerAuth, async (req, res) => {
  const { type, title, message } = req.body;

  if (!type || !title) {
    return res.status(400).json({ error: "type und title sind erforderlich" });
  }

  const requests = await readJsonFile(REQUESTS_FILE, []);

  const newRequest = {
    id: Date.now(),
    customer_number: req.customer.customer_number,
    type,
    title,
    message: message || "",
    status: "open",
    created_at: new Date().toISOString()
  };

  requests.push(newRequest);
  await writeJsonFile(REQUESTS_FILE, requests);

  res.status(201).json(newRequest);
});

/* =========================
   ADMIN CUSTOMERS / REQUESTS
========================= */

app.get("/api/customers", adminAuth, async (req, res) => {
  const customers = await readJsonFile(CUSTOMERS_FILE, []);

  res.json(
    customers.map((c) => ({
      id: c.id,
      customer_number: c.customer_number,
      company_name: c.company_name || "",
      logo_url: c.logo_url || "",
      is_active: c.is_active !== false,
      created_at: c.created_at || null,
      updated_at: c.updated_at || null
    }))
  );
});

app.post("/api/customers", adminAuth, async (req, res) => {
  const {
    customer_number,
    company_name,
    logo_url = "",
    password,
    is_active = true
  } = req.body;

  const finalCustomerNumber = normalizeCustomerNumber(customer_number);

  if (!isValidCustomerNumber(finalCustomerNumber)) {
    return res.status(400).json({
      error: "customer_number ist erforderlich und muss genau 4 Ziffern enthalten"
    });
  }

  if (!company_name) {
    return res.status(400).json({
      error: "company_name ist erforderlich"
    });
  }

  if (!password || String(password).length < 6) {
    return res.status(400).json({
      error: "password ist erforderlich und muss mindestens 6 Zeichen haben"
    });
  }

  const customers = await readJsonFile(CUSTOMERS_FILE, []);

  const exists = customers.some(
    (entry) => entry.customer_number === finalCustomerNumber
  );

  if (exists) {
    return res.status(409).json({
      error: "Kundennummer existiert bereits"
    });
  }

  const passwordHash = await bcrypt.hash(String(password), 10);

  const newCustomer = {
    id: Date.now(),
    customer_number: finalCustomerNumber,
    company_name,
    logo_url,
    password_hash: passwordHash,
    is_active,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  customers.push(newCustomer);
  await writeJsonFile(CUSTOMERS_FILE, customers);

  res.status(201).json({
    id: newCustomer.id,
    customer_number: newCustomer.customer_number,
    company_name: newCustomer.company_name,
    logo_url: newCustomer.logo_url,
    is_active: newCustomer.is_active,
    created_at: newCustomer.created_at,
    updated_at: newCustomer.updated_at
  });
});

app.put("/api/customers/:id", adminAuth, async (req, res) => {
  const id = Number(req.params.id);
  const {
    company_name,
    logo_url,
    password,
    is_active
  } = req.body;

  const customers = await readJsonFile(CUSTOMERS_FILE, []);
  const index = customers.findIndex((entry) => entry.id === id);

  if (index === -1) {
    return res.status(404).json({
      error: "Kunde nicht gefunden"
    });
  }

  const existingCustomer = customers[index];

  let passwordHash = existingCustomer.password_hash;

  if (password && String(password).length >= 6) {
    passwordHash = await bcrypt.hash(String(password), 10);
  }

  customers[index] = {
    ...existingCustomer,
    company_name:
      company_name !== undefined ? company_name : existingCustomer.company_name,
    logo_url:
      logo_url !== undefined ? logo_url : existingCustomer.logo_url || "",
    password_hash: passwordHash,
    is_active:
      typeof is_active === "boolean" ? is_active : existingCustomer.is_active,
    updated_at: new Date().toISOString()
  };

  await writeJsonFile(CUSTOMERS_FILE, customers);

  res.json({
    id: customers[index].id,
    customer_number: customers[index].customer_number,
    company_name: customers[index].company_name,
    logo_url: customers[index].logo_url || "",
    is_active: customers[index].is_active,
    created_at: customers[index].created_at,
    updated_at: customers[index].updated_at
  });
});

app.delete("/api/customers/:id", adminAuth, async (req, res) => {
  const id = Number(req.params.id);
  const customers = await readJsonFile(CUSTOMERS_FILE, []);
  const index = customers.findIndex((entry) => entry.id === id);

  if (index === -1) {
    return res.status(404).json({
      error: "Kunde nicht gefunden"
    });
  }

  customers[index] = {
    ...customers[index],
    is_active: false,
    updated_at: new Date().toISOString()
  };

  await writeJsonFile(CUSTOMERS_FILE, customers);

  res.json({
    success: true,
    message: "Kunde wurde deaktiviert"
  });
});

app.get("/api/requests", adminAuth, async (req, res) => {
  const requests = await readJsonFile(REQUESTS_FILE, []);
  res.json(requests);
});

app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: "Datei größer als 20 MB" });
  }

  if (error instanceof multer.MulterError || error.message === "Nur Bilddateien sind erlaubt") {
    return res.status(400).json({ error: error.message });
  }

  next(error);
});

await ensureRuntimeDirs();

app.listen(PORT, () => {
  console.log(`API läuft auf Port ${PORT}`);
});
