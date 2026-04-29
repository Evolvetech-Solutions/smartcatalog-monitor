import fs from "fs/promises";
import dotenv from "dotenv";
import nodemailer from "nodemailer";
import { chromium } from "playwright";

dotenv.config();

const CHECK_INTERVAL_MS = 300000; // 5 Minuten
const URLS_FILE = "./urls.json";
const STATE_FILE = "./state.json";
const HISTORY_FILE = "./history.json";

const SMTP_HOST = process.env.SMTP_HOST || "";
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_SECURE = String(process.env.SMTP_SECURE || "false").toLowerCase() === "true";
const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";
const MAIL_FROM = process.env.MAIL_FROM || "";
const MAIL_TO = process.env.MAIL_TO || "";

function mailConfigured() {
  return Boolean(
    SMTP_HOST &&
      SMTP_PORT &&
      SMTP_USER &&
      SMTP_PASS &&
      MAIL_FROM &&
      MAIL_TO
  );
}

async function readJsonFile(path, fallback) {
  try {
    const raw = await fs.readFile(path, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function writeJsonFile(path, data) {
  await fs.writeFile(path, JSON.stringify(data, null, 2), "utf8");
}

async function sendMail(subject, text) {
  if (!mailConfigured()) {
    console.log("⚠️ Mail nicht gesendet: SMTP-Daten fehlen.");
    return;
  }

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS
    }
  });

  await transporter.sendMail({
    from: MAIL_FROM,
    to: MAIL_TO,
    subject,
    text
  });
}

async function loadUrls() {
  return await readJsonFile(URLS_FILE, []);
}

async function loadState() {
  return await readJsonFile(STATE_FILE, {});
}

async function saveState(state) {
  await writeJsonFile(STATE_FILE, state);
}

async function loadHistory() {
  return await readJsonFile(HISTORY_FILE, {});
}

async function saveHistory(history) {
  await writeJsonFile(HISTORY_FILE, history);
}

function normalize(text) {
  return (text || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

async function checkSingleUrl(browser, urlItem, previousState) {
  const {
    id,
    name = "Ohne Titel",
    url,
    error_text = "Das Dokument wurde gelöscht und steht nicht mehr zur Verfügung.",
    is_active = true
  } = urlItem;

  if (!is_active || !url) {
    return previousState[url] || {
      id,
      name,
      url,
      errorFound: false,
      checkedAt: null,
      status: "inactive",
      lastErrorMessage: null
    };
  }

  let page;
  const checkedAt = new Date().toISOString();

  const result = {
    id,
    name,
    url,
    errorFound: false,
    checkedAt,
    status: "ok",
    lastErrorMessage: null
  };

  try {
    console.log(`Prüfe: ${name} | ${url}`);

    page = await browser.newPage({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36"
    });

    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 45000
    });

    await page.waitForTimeout(5000);

    const pageText = await page.locator("body").innerText().catch(() => "");
    const errorFound = normalize(pageText).includes(normalize(error_text));

    result.errorFound = errorFound;
    result.status = errorFound ? "error" : "ok";
    result.lastErrorMessage = errorFound ? error_text : null;

    const oldState = previousState[url] || { errorFound: false };

    if (errorFound && !oldState.errorFound) {
      console.log(`❌ Fehler erkannt: ${name}`);

      await sendMail(
        `SmartCatalog Monitor: Fehler erkannt - ${name}`,
        [
          "Auf der überwachten Seite wurde ein Fehler erkannt.",
          "",
          `Name: ${name}`,
          `URL: ${url}`,
          `Fehlertext: ${error_text}`,
          `Zeit: ${checkedAt}`
        ].join("\n")
      );
    } else if (!errorFound && oldState.errorFound) {
      console.log(`✅ Seite wieder OK: ${name}`);

      await sendMail(
        `SmartCatalog Monitor: Seite wieder OK - ${name}`,
        [
          "Die überwachte Seite ist wieder in Ordnung.",
          "",
          `Name: ${name}`,
          `URL: ${url}`,
          `Zeit: ${checkedAt}`
        ].join("\n")
      );
    } else if (errorFound) {
      console.log(`❌ Fehler weiterhin vorhanden: ${name}`);
    } else {
      console.log(`✅ Alles OK: ${name}`);
    }
  } catch (error) {
    console.error(`Prüfung fehlgeschlagen bei ${name}: ${error.message}`);

    result.errorFound = true;
    result.status = "error";
    result.lastErrorMessage = error.message;

    const oldState = previousState[url] || { errorFound: false };

    if (!oldState.errorFound) {
      await sendMail(
        `SmartCatalog Monitor: Technischer Fehler - ${name}`,
        [
          "Die Prüfung der URL ist technisch fehlgeschlagen.",
          "",
          `Name: ${name}`,
          `URL: ${url}`,
          `Fehler: ${error.message}`,
          `Zeit: ${checkedAt}`
        ].join("\n")
      );
    }
  } finally {
    if (page) {
      await page.close();
    }
  }

  return result;
}

async function runCheck() {
  console.log("🔄 Neue Monitoring-Runde gestartet");

  const urls = await loadUrls();
  const previousState = await loadState();
  const history = await loadHistory();
  const newState = {};

  if (!urls.length) {
    console.log("Keine URLs in urls.json gefunden.");
    await saveState(newState);
    await saveHistory(history);
    return;
  }

  const browser = await chromium.launch({
    headless: true
  });

  try {
    for (const urlItem of urls) {
      const result = await checkSingleUrl(browser, urlItem, previousState);
      newState[urlItem.url] = result;

      if (!history[urlItem.url]) {
        history[urlItem.url] = [];
      }

      history[urlItem.url].push({
        status: result.status,
        checkedAt: result.checkedAt
      });

      const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

      history[urlItem.url] = history[urlItem.url].filter(
        (entry) => new Date(entry.checkedAt).getTime() > sevenDaysAgo
      );
    }
  } finally {
    await browser.close();
  }

  await saveState(newState);
  await saveHistory(history);
  console.log("✅ Monitoring-Runde abgeschlossen");
}

async function main() {
  while (true) {
    try {
      await runCheck();
    } catch (error) {
      console.error("Globaler Fehler im Monitoring:", error.message);
    }

    await new Promise((resolve) => setTimeout(resolve, CHECK_INTERVAL_MS));
  }
}

main();
