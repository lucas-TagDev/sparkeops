import { DatabaseSync, backup } from "node:sqlite";
import { resolve } from "node:path";
import { mkdirSync, chmodSync } from "node:fs";

const source = process.env.FOXOPS_DATABASE ?? "foxops.sqlite3";
const directory = resolve("backups");
mkdirSync(directory, { recursive: true, mode: 0o700 });
const destination = resolve(
  directory,
  `foxops-${new Date().toISOString().replace(/[:.]/g, "-")}.sqlite3`,
);
const db = new DatabaseSync(source, { readOnly: true });
try {
  await backup(db, destination);
  chmodSync(destination, 0o600);
  console.log("Backup criado:", destination);
} finally {
  db.close();
}
