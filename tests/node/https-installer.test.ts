import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
const bash = ["/bin/bash", "C:/Program Files/Git/bin/bash.exe"].find(
  existsSync,
);
const helper = resolve("deploy/https.sh").replaceAll("\\", "/");

test(
  "HTTPS installer: valid Bash syntax and public domain validation",
  { skip: !bash },
  () => {
    execFileSync(bash!, ["-n", "deploy/install.sh"]);
    execFileSync(bash!, ["-n", helper]);
    for (const url of [
      "https://monitor.example.com",
      "https://monitor.example.com:443",
    ]) {
      const result = execFileSync(
        bash!,
        ["-c", '. "$1"; https_domain "$2"', "_", helper, url],
        { encoding: "utf8" },
      );
      assert.equal(result.trim(), "monitor.example.com");
    }
    for (const url of [
      "http://monitor.example.com",
      "https://127.0.0.1",
      "https://localhost",
      "https://server.local",
      "https://monitor.example.com:8443",
      "https://monitor.example.com/path",
      "https://monitor.example.com;id",
      "https://a.test",
      "https://-bad.example.com",
    ]) {
      const result = spawnSync(bash!, [
        "-c",
        '. "$1"; https_domain "$2"',
        "_",
        helper,
        url,
      ]);
      assert.notEqual(result.status, 0, url);
    }
  },
);

test(
  "HTTPS requires explicit DNS and ports acknowledgment when no interactive terminal exists",
  { skip: !bash },
  () => {
    const script =
      '. "$1"; fail() { printf "%s\\n" "$*" >&2; exit 9; }; https_notice https://monitor.example.com "$2"';
    const refused = spawnSync(bash!, ["-c", script, "_", helper, "0"], {
      encoding: "utf8",
    });
    assert.equal(refused.status, 9);
    assert.match(refused.stderr, /--confirm-dns-ports/);
    const accepted = spawnSync(bash!, ["-c", script, "_", helper, "1"], {
      encoding: "utf8",
    });
    assert.equal(accepted.status, 0);
    assert.match(accepted.stdout, /80 e 443/);
    assert.match(accepted.stdout, /A e, se houver, AAAA/);
  },
);
