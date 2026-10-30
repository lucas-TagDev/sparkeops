import assert from "node:assert/strict";
import { test } from "node:test";
import { Store } from "../../src/store.ts";
import { Platform } from "../../src/platform.ts";
import { BrandingSettings } from "../../src/branding.ts";
import { brandingTextColor } from "../../shared/branding.ts";
const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jHhoAAAAASUVORK5CYII=";

test("marca global: somente administrador explicitamente configurado pode editar", (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const platform = new Platform(store);
  const a = platform.signup({
    name: "Admin",
    company: "Platform",
    email: "admin@example.test",
    password: "strong-password-123",
  }).principal;
  const b = platform.signup({
    name: "Customer",
    company: "Tenant",
    email: "customer@example.test",
    password: "strong-password-456",
  }).principal;
  const brand = new BrandingSettings(platform, ["ADMIN@example.test"]);
  assert.equal(brand.canManage(a), true);
  assert.equal(brand.canManage(b), false);
  assert.equal(new BrandingSettings(platform).canManage(a), false);
  assert.throws(() =>
    brand.save(b, { name: "Attacker", primaryColor: "#123456" }),
  );
  assert.throws(() =>
    brand.save(
      { ...a, role: "reader" },
      { name: "Other", primaryColor: "#123456" },
    ),
  );
  const original = brand.public();
  assert.equal(original.name, "FoxOps");
  const result = brand.save(a, {
    name: "Minha Plataforma",
    primaryColor: "#2244aa",
    logo: png,
    favicon: png,
  });
  assert.equal(result.name, "Minha Plataforma");
  assert.match(result.logo!, /^\/branding\/logo\?v=/);
  assert.match(result.favicon!, /^\/branding\/favicon\?v=/);
  assert.doesNotMatch(JSON.stringify(result), /base64/);
  assert.equal(
    new BrandingSettings(platform).public().name,
    "Minha Plataforma",
  );
  assert.equal(brand.asset("logo")!.mime, "image/png");
  const update = brand.save(a, { name: "Nova Marca", primaryColor: "#ffdd00" });
  assert.ok(update.logo);
  assert.notEqual(update.revision, result.revision);
  brand.save(a, { name: "Nova Marca", primaryColor: "#ffdd00", logo: null });
  assert.equal(brand.asset("logo"), null);
  assert.ok(brand.asset("favicon"));
  const restored = brand.reset(a);
  assert.equal(restored.name, "FoxOps");
  assert.equal(restored.logo, null);
  assert.equal(restored.primaryColor, "#79e2af");
  assert.ok(
    platform
      .auditLog(a)
      .some((row) => row.action === "platform.branding.updated"),
  );
});

test("imagens: formatos ativos, URLs externas e conteúdo divergente são recusados", (t) => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const brand = new BrandingSettings(new Platform(store));
  assert.ok(brand.validateAsset(png, "logo"));
  for (const image of [
    "https://example.test/logo.png",
    "data:image/svg+xml;base64,PHN2Zy8+",
    "data:image/png;base64,PGh0bWw+",
    "data:image/png;base64,",
    "data:image/jpeg;base64," + "A".repeat(720000),
  ])
    assert.throws(() => brand.validateAsset(image, "logo"));
  const large = Buffer.from(png.split(",")[1], "base64");
  large.writeUInt32BE(10000, 16);
  assert.throws(() =>
    brand.validateAsset(
      "data:image/png;base64," + large.toString("base64"),
      "logo",
    ),
  );
  assert.equal(brandingTextColor("#000000"), "#ffffff");
  assert.equal(brandingTextColor("#ffffff"), "#09131c");
});
