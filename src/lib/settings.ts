import "server-only";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./db";

// Small local settings file (data/settings.json).
export type Settings = {
  googleUrl?: string; // the Apps Script web-app URL that writes to the Google Sheet
  googleToken: string; // shared secret the script checks, so only this website can write
  googleSheetUrl?: string; // link to open the Google Sheet, reported back by the script
  googleSyncedAt?: string;
};

const FILE = path.join(DATA_DIR, "settings.json");

export function readSettings(): Settings {
  let s: Partial<Settings> = {};
  try {
    s = JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch {}
  if (!s.googleToken) {
    s.googleToken = crypto.randomBytes(18).toString("base64url");
    writeSettings(s as Settings);
  }
  return s as Settings;
}

export function writeSettings(s: Settings) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(s, null, 2));
}

export function updateSettings(patch: Partial<Settings>) {
  const s = { ...readSettings(), ...patch };
  for (const k of Object.keys(patch) as (keyof Settings)[]) if (patch[k] === undefined) delete s[k];
  writeSettings(s);
  return s;
}
