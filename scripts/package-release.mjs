import {
  mkdtempSync,
  mkdirSync,
  readdirSync,
  lstatSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { join, resolve, relative } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

// Positive allowlist: never export the live database, .env, master key, backups or node_modules.
export const releaseEntries = [
  "src",
  "shared",
  "web",
  "agent",
  "deploy",
  "scripts",
  "docs",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "vite.config.ts",
  "index.html",
  ".env.example",
  "README.md",
  "Dockerfile",
  "compose.yaml",
];
const root = resolve(import.meta.dirname, "..");
const version = JSON.parse(
  readFileSync(join(root, "package.json"), "utf8"),
).version;
if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version))
  throw new Error("Versão inválida.");
const name = `foxops-platform-${version}`;
const output = join(root, "releases");
mkdirSync(output, { recursive: true });
const temp = mkdtempSync(join(tmpdir(), "foxops-release-"));
const destination = join(temp, name);
const manifest = [];
function copy(file) {
  const info = lstatSync(join(root, file));
  if (info.isSymbolicLink())
    throw new Error(`Link simbólico não permitido no pacote: ${file}`);
  if (info.isDirectory()) {
    mkdirSync(join(destination, file), { recursive: true });
    for (const child of readdirSync(join(root, file)).sort()) {
      if (
        [
          "__pycache__",
          "node_modules",
          ".secrets",
          ".git",
          "backups",
          "releases",
        ].includes(child)
      )
        continue;
      copy(join(file, child));
    }
  } else if (info.isFile() && !/\.(pyc|sqlite3|log)$/i.test(file)) {
    let bytes = readFileSync(join(root, file));
    if (
      /\.(sh|py|ts|tsx|mjs|json|md|css|yaml)$/.test(file) ||
      file.endsWith(".env.example")
    )
      bytes = Buffer.from(
        bytes
          .toString("utf8")
          .replace(/^\uFEFF/, "")
          .replace(/\r\n/g, "\n"),
      );
    const target = join(destination, file);
    mkdirSync(resolve(target, ".."), { recursive: true });
    writeFileSync(target, bytes);
    manifest.push(
      `${createHash("sha256").update(bytes).digest("hex")}  ${relative(destination, target).replaceAll("\\", "/")}`,
    );
  }
}
try {
  for (const entry of releaseEntries) copy(entry);
  writeFileSync(join(destination, "SHA256SUMS"), manifest.join("\n") + "\n");
  const artifact = join(output, `${name}.tar.gz`);
  execFileSync("tar", ["-czf", artifact, "-C", temp, name], {
    stdio: "inherit",
  });
  const checksum = createHash("sha256")
    .update(readFileSync(artifact))
    .digest("hex");
  writeFileSync(`${artifact}.sha256`, `${checksum}  ${name}.tar.gz\n`);
  console.log(
    `Pacote: ${artifact}\nChecksum: ${artifact}.sha256\nArquivos: ${manifest.length}`,
  );
} finally {
  rmSync(temp, { recursive: true, force: true });
}
