import path from "node:path";
import fs from "node:fs";

export const ROOT_DIR = path.resolve(process.cwd());
export const DATA_DIR = process.env.CLAIMCHECK_DATA_DIR
  ? path.resolve(process.env.CLAIMCHECK_DATA_DIR)
  : path.join(ROOT_DIR, "data");
export const DB_PATH = path.join(DATA_DIR, "claimcheck.sqlite");
export const SAMPLE_DIR = path.join(ROOT_DIR, "samples");
export const SAMPLE_PDF = path.join(SAMPLE_DIR, "claimcheck-demo-paper.pdf");
export const CLIENT_DIST = path.join(ROOT_DIR, "client", "dist");
export const EVALUATION_SUMMARY_PATH = path.join(ROOT_DIR, "evaluation", "summary.json");

const configuredPort = Number(process.env.PORT);
export const PORT =
  Number.isInteger(configuredPort) && configuredPort > 0 && configuredPort <= 65535
    ? configuredPort
    : 8787;
/** Bind address. Defaults to localhost; a hosting platform needs HOST=0.0.0.0 to route traffic in. */
export const HOST = process.env.HOST?.trim() || "127.0.0.1";
/**
 * Optional admin token. When set, listing every report, deleting reports, and
 * restoring backups require "Authorization: Bearer <token>". Individual report
 * links (unguessable ids) and uploads stay open. Unset keeps the old open behaviour.
 */
export const ADMIN_TOKEN = process.env.CLAIMCHECK_ADMIN_TOKEN?.trim() || null;
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_PAGES = 150;
export const PROCESSING_TIMEOUT_MS = 90_000;
export const MIN_AUDITABLE_CHARS = 500;
export const MIN_AUDITABLE_WORDS = 60;
/** Below this average characters-per-page a document is treated as likely scanned. */
export const MIN_CHARS_PER_PAGE = 140;

fs.mkdirSync(DATA_DIR, { recursive: true });
