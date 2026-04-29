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

dotenv.config();

const app = express();

const PORT = process.env.API_PORT || 3001;
const API_TOKEN = process.env.API_TOKEN || "";
const CUSTOMER_JWT_SECRET = process.env.CUSTOMER_JWT_SECRET || "change-me";

const BASE_URL = "https://api.evolvetech-solutions.de";

const URLS_FILE = "./urls.json";
const STATE_FILE = "./state.json";
const HISTORY_FILE = "./history.json";
const CUSTOMERS_FILE = "./customers.json";
const REQUESTS_FILE = "./requests.json";

const CATALOG_PAGES_DIR = "./catalog-pages";
const execFileAsync = promisify(execFile);

app.use(cors());
app.use(express.json());

app.use("/uploads", express.static(path.resolve("./uploads")));
app.use("/viewer", express.static(path.resolve("./viewer")));
app.use("/flipbook", express.static(path.resolve("./flipbook")));
app.use("/smartviewer", express.static(path.resolve("./smartviewer")));
app.use("/catalog-pages", express.static(path.resolve("./catalog-pages")));

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

const upload = multer({ storage });

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

async function readJsonFile(pathValue, fallback) {
  try {
    const raw = await fs.readFile(pathValue, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function writeJsonFile(pathValue, data) {
  await fs.writeFile(pathValue, JSON.stringify(data, null, 2), "utf8");
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

function isValidCustomerNumber(value) {
  return /^\d{4}$/.test(String(value || "").trim());
}

function buildViewerUrl(pdfUrl) {
  if (!pdfUrl) return "";
  return `${BASE_URL}/viewer/web/viewer.html?file=${encodeURIComponent(pdfUrl)}`;
}

function buildFlipbookUrl(catalogId) {
  if (!catalogId) return "";
  return `${BASE_URL}/smartviewer/index.html?catalog=${catalogId}`;
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

    res.json({
      message: "Upload erfolgreich",
      url: fileUrl,
      pdf_url: fileUrl,
      viewer_url: viewerUrl,
      catalog_id: String(catalogId),
      flipbook_url: flipbookUrl,
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
  const finalCatalogId = catalog_id || "";
  const finalFlipbookUrl = flipbook_url || buildFlipbookUrl(finalCatalogId);
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
    id: Date.now(),
    name: finalName,
    title: finalName,
    customer_number: finalCustomerNumber,
    url: finalUrl,
    pdf_url: finalPdfUrl,
    viewer_url: finalViewerUrl,
    catalog_id: finalCatalogId,
    flipbook_url: finalFlipbookUrl,
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

  const finalFlipbookUrl =
    flipbook_url !== undefined
      ? flipbook_url
      : existingItem.flipbook_url || buildFlipbookUrl(finalCatalogId);

  const finalUrl = url || finalFlipbookUrl || finalViewerUrl || existingItem.url;

  urls[index] = {
    ...existingItem,
    name: name || title || existingItem.name || "Ohne Titel",
    title: title || name || existingItem.title || existingItem.name || "Ohne Titel",
    customer_number: finalCustomerNumber,
    url: finalUrl,
    pdf_url: finalPdfUrl,
    viewer_url: finalViewerUrl,
    catalog_id: finalCatalogId,
    flipbook_url: finalFlipbookUrl,
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

  res.json({
    customer_number: customer.customer_number,
    company_name: customer.company_name || "",
    is_active: customer.is_active !== false
  });
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

    res.json({
      message: "Upload erfolgreich",
      pdf_url: fileUrl,
      viewer_url: viewerUrl,
      catalog_id: String(catalogId),
      flipbook_url: flipbookUrl,
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
  const finalCatalogId = catalog_id || "";
  const finalFlipbookUrl = flipbook_url || buildFlipbookUrl(finalCatalogId);
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
    id: Date.now(),
    name: finalName,
    title: finalName,
    customer_number: req.customer.customer_number,
    url: finalUrl,
    pdf_url: finalPdfUrl,
    viewer_url: finalViewerUrl,
    catalog_id: finalCatalogId,
    flipbook_url: finalFlipbookUrl,
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

  const finalFlipbookUrl =
    flipbook_url !== undefined
      ? flipbook_url
      : existingItem.flipbook_url || buildFlipbookUrl(finalCatalogId);

  const finalUrl = url || finalFlipbookUrl || finalViewerUrl || existingItem.url;

  urls[index] = {
    ...existingItem,
    name: name || title || existingItem.name || "Ohne Titel",
    title: title || name || existingItem.title || existingItem.name || "Ohne Titel",
    customer_number: req.customer.customer_number,
    url: finalUrl,
    pdf_url: finalPdfUrl,
    viewer_url: finalViewerUrl,
    catalog_id: finalCatalogId,
    flipbook_url: finalFlipbookUrl,
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
    is_active: newCustomer.is_active,
    created_at: newCustomer.created_at,
    updated_at: newCustomer.updated_at
  });
});

app.put("/api/customers/:id", adminAuth, async (req, res) => {
  const id = Number(req.params.id);
  const {
    company_name,
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

app.listen(PORT, () => {
  console.log(`API läuft auf Port ${PORT}`);
});
