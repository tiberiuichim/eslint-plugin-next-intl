import fs from "node:fs";
import path from "node:path";

// Cache for loaded keys: "absolute/path/to/file" -> { mtimeMs, keys: Set<string> }
const cache = new Map<string, { mtimeMs: number; keys: Set<string> }>();

export function flattenKeys(obj: any, prefix = ""): string[] {
  let keys: string[] = [];
  for (const key in obj) {
    if (typeof obj[key] === "object" && obj[key] !== null) {
      keys = keys.concat(
        flattenKeys(obj[key], prefix ? `${prefix}.${key}` : key)
      );
    } else {
      keys.push(prefix ? `${prefix}.${key}` : key);
    }
  }
  return keys;
}

export function loadMessages(cwd: string, messagesDir: string, locale: string): Set<string> {
  const absoluteMessagesDir = path.resolve(cwd, messagesDir);
  const filePath = path.join(absoluteMessagesDir, `${locale}.json`);

  if (!fs.existsSync(filePath)) {
    // We might want to warn here, but for now just return empty
    return new Set();
  }

  const stats = fs.statSync(filePath);
  const cached = cache.get(filePath);

  if (cached && cached.mtimeMs === stats.mtimeMs) {
    return cached.keys;
  }

  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const json = JSON.parse(content);
    const keys = new Set(flattenKeys(json));
    
    cache.set(filePath, { mtimeMs: stats.mtimeMs, keys });
    return keys;
  } catch (error) {
    // In a plugin context, console.error might not be ideal, but it helps debugging
    // console.error(`Failed to parse messages file: ${filePath}`, error);
    return new Set();
  }
}
