import assert from "node:assert/strict";
import { test } from "node:test";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
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

test(
  "Caddy checksums: accepts official SHA-512 and SHA-256, rejects corruption and invalid manifests",
  { skip: !bash },
  () => {
    const directory = mkdtempSync(join(tmpdir(), "sparkeops-caddy-check-"));
    const name = "caddy_2.11.7_linux_amd64.tar.gz",
      content = Buffer.from("archive test fixture"),
      manifest = join(directory, "checksums.txt");
    writeFileSync(join(directory, name), content);
    const command =
      (process.platform === "win32" ? 'python3() { python "$@"; }; ' : "") +
      '. "$1"; https_verify_archive "$2" "$3" "$4"';
    const verify = () =>
      spawnSync(
        bash!,
        [
          "-c",
          command,
          "_",
          helper,
          directory.replaceAll("\\", "/"),
          name,
          manifest.replaceAll("\\", "/"),
        ],
        { encoding: "utf8" },
      );
    try {
      for (const algorithm of ["sha256", "sha512"]) {
        const hash = createHash(algorithm).update(content).digest("hex");
        writeFileSync(manifest, hash + "  " + name + "\r\n");
        const result = verify();
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /verificado com sucesso/);
      }
      for (const invalid of [
        "0".repeat(128) + "  " + name,
        "a".repeat(40) + "  " + name,
        createHash("sha512").update(content).digest("hex") +
          "  another-file.tar.gz",
        "not a checksum",
      ]) {
        writeFileSync(manifest, invalid + "\n");
        assert.notEqual(verify().status, 0);
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

test(
  "First install never treats a missing or incomplete current directory as a previous release",
  { skip: !bash },
  () => {
    const directory = mkdtempSync(join(tmpdir(), "sparkeops-state-"));
    const stateHelper = resolve("deploy/platform-state.sh").replaceAll(
      "\\",
      "/",
    );
    const current = join(directory, "current");
    const detect = () =>
      execFileSync(
        bash!,
        [
          "-c",
          '. "$1"; platform_previous_release "$2"',
          "_",
          stateHelper,
          current.replaceAll("\\", "/"),
        ],
        { encoding: "utf8" },
      ).trim();
    try {
      assert.equal(detect(), "");
      mkdirSync(current);
      assert.equal(detect(), "");
      mkdirSync(join(current, "src"));
      writeFileSync(join(current, "src/server.ts"), "// previous release");
      assert.match(detect(), /current$/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
test(
  "Service stop skips missing units and preserves real failures for installed units",
  { skip: !bash },
  () => {
    const stateHelper = resolve("deploy/platform-state.sh").replaceAll(
      "\\",
      "/",
    );
    const script =
      '. "$1"; systemctl() { if [[ "$1" == show ]]; then printf "%s\\n" "$STATE"; else printf "STOP"; return "$STOP_CODE"; fi; }; platform_stop_if_loaded foxops.service';
    const run = (state: string, code: string) =>
      spawnSync(bash!, ["-c", script, "_", stateHelper], {
        encoding: "utf8",
        env: { ...process.env, STATE: state, STOP_CODE: code },
      });
    const missing = run("not-found", "0");
    assert.equal(missing.status, 0);
    assert.equal(missing.stdout, "");
    const loaded = run("loaded", "0");
    assert.equal(loaded.status, 0);
    assert.equal(loaded.stdout, "STOP");
    assert.equal(run("loaded", "5").status, 5);
  },
);
