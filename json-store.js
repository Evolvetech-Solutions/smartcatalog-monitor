import fs from "fs/promises";
import path from "path";

const BACKUP_DIR = "./data-backups";

function backupNameFor(filePath) {
  const parsed = path.parse(filePath);
  return path.join(BACKUP_DIR, `${parsed.name}.bak${parsed.ext}`);
}

export async function readJsonFile(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export async function writeJsonFile(filePath, data) {
  const targetDir = path.dirname(filePath);
  const targetBaseName = path.basename(filePath);
  const tempPath = path.join(
    targetDir,
    `.${targetBaseName}.${process.pid}.${Date.now()}.tmp`
  );

  const json = `${JSON.stringify(data, null, 2)}\n`;

  await fs.mkdir(targetDir, { recursive: true });
  await fs.mkdir(BACKUP_DIR, { recursive: true });

  try {
    await fs.copyFile(filePath, backupNameFor(filePath));
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }

  try {
    await fs.writeFile(tempPath, json, "utf8");
    await fs.rename(tempPath, filePath);
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}
