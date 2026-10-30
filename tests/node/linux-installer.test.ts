import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  lstatSync,
  rmSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

test("platform installer: LF distribution, unprivileged service and external persistent data", () => {
  const script = readFileSync("deploy/install.sh", "utf8");
  assert.ok(script.startsWith("#!/usr/bin/env bash\n"));
  assert.ok(!script.includes("\r"));
  assert.ok(script.includes("User=foxops"));
  assert.ok(script.includes("ProtectSystem=strict"));
  assert.ok(script.includes("FOXOPS_AI_KEY_FILE=$DATA/.secrets/ai-master.key"));
  assert.ok(script.includes("sha256sum -c expected.sha256"));
  assert.ok(script.includes("npm ci --ignore-scripts"));
});

test("Linux release is self-contained and contains no local customer database or secrets", () => {
  execFileSync(process.execPath, ["scripts/package-release.mjs"], {
    stdio: "pipe",
  });
  const version = JSON.parse(readFileSync("package.json", "utf8")).version;
  const name = `sparkeops-platform-${version}`;
  const archive = resolve("releases", `${name}.tar.gz`);
  const actual = createHash("sha256")
    .update(readFileSync(archive))
    .digest("hex");
  assert.ok(readFileSync(`${archive}.sha256`, "utf8").startsWith(actual));
  const list = execFileSync("tar", ["-tzf", archive], { encoding: "utf8" })
    .trim()
    .split(/\r?\n/);
  for (const file of list) {
    assert.ok(
      !file
        .split("/")
        .some((part) =>
          [
            ".env",
            ".secrets",
            "node_modules",
            "backups",
            "__pycache__",
          ].includes(part),
        ),
      file,
    );
    assert.ok(!/\.(sqlite3|pyc|log)$/.test(file), file);
    assert.ok(!file.includes(".."), file);
  }
  for (const file of [
    "src/server.ts",
    "shared/plans.ts",
    "deploy/install.sh",
    "package-lock.json",
    "SHA256SUMS",
  ])
    assert.ok(list.includes(`${name}/${file}`), file);
  const temp = mkdtempSync(join(tmpdir(), "foxops-package-test-"));
  try {
    execFileSync("tar", ["-xzf", archive, "-C", temp]);
    const manifest = readFileSync(join(temp, name, "SHA256SUMS"), "utf8")
      .trim()
      .split("\n");
    for (const line of manifest) {
      const [hash, file] = line.split("  ");
      assert.equal(
        createHash("sha256")
          .update(readFileSync(join(temp, name, file)))
          .digest("hex"),
        hash,
        file,
      );
      if (/\.(sh|py)$/.test(file))
        assert.ok(!readFileSync(join(temp, name, file)).includes(13), file);
    }
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
