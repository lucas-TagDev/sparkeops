import assert from "node:assert/strict";
import { test } from "node:test";
import {
  recoveryIndicator,
  recoveryCountdown,
} from "../../web/recovery-time.ts";
test("recovery indicator: idle service never flashes a wait or countdown on refresh", () => {
  const now = 1_800_000_000;
  for (const drift of [-1500, -1, 0, 1000]) {
    const display = recoveryIndicator(
      { state: "ready", next_eligible_at: now, waiting_until: null },
      now * 1000 + drift,
    );
    assert.equal(display.label, "Nenhuma tentativa agendada");
    assert.equal(display.deadline, null);
  }
});
test("recovery indicator: pending work, policy cooldown and exhausted daily budget are distinct", () => {
  const now = 1_800_000_000;
  const policy = recoveryIndicator(
    { state: "cooldown", next_eligible_at: now + 60, waiting_until: null },
    now * 1000,
  );
  assert.equal(policy.label, "Intervalo entre reinícios");
  assert.equal(recoveryCountdown(policy.deadline!, now * 1000), "00:01:00");
  const pending = recoveryIndicator(
    { state: "cooldown", next_eligible_at: now + 60, waiting_until: now + 60 },
    now * 1000,
  );
  assert.equal(pending.label, "Aguardando intervalo");
  const daily = recoveryIndicator(
    {
      state: "daily_limit",
      next_eligible_at: now + 86400,
      waiting_until: null,
    },
    now * 1000,
  );
  assert.equal(daily.label, "Limite diário atingido");
  assert.equal(recoveryCountdown(daily.deadline!, now * 1000), "24:00:00");
  assert.equal(
    recoveryIndicator(
      { state: "ready", next_eligible_at: null, waiting_until: now },
      now * 1000,
    ).label,
    "Aguardando verificação para executar",
  );
  assert.equal(
    recoveryIndicator(
      { state: "unknown", next_eligible_at: now + 60, waiting_until: now + 60 },
      now * 1000,
    ).deadline,
    null,
  );
});
