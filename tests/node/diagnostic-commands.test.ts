import assert from "node:assert/strict";
import { test } from "node:test";
import {
  requireDiagnosticCommand,
  validateDiagnosticWrapper,
} from "../../src/diagnostic-commands.ts";

test("assistant SSH rejects destructive commands, shell composition and older unsafe proposals", () => {
  requireDiagnosticCommand("df -h");
  requireDiagnosticCommand("journalctl -n 50 --no-pager -u nginx.service");
  for (const command of [
    "rm -rf /",
    "df -h; reboot",
    "df -h > /etc/passwd",
    "df -h\nreboot",
    "systemctl restart nginx.service",
    "journalctl -n 50 --no-pager -u $(reboot).service",
  ]) {
    assert.throws(() => requireDiagnosticCommand(command));
    const payload = Buffer.from(JSON.stringify({ command })).toString("base64");
    assert.throws(() =>
      validateDiagnosticWrapper(
        "/usr/local/sbin/foxops-command '" + payload + "'",
      ),
    );
  }
});
