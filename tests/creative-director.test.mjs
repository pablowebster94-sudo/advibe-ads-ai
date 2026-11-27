import test from "node:test";
import assert from "node:assert/strict";
import { buildCreativeBrief, creativeQualityChecks, CREATIVE_DIRECTIONS } from "../src/lib/creative/director.ts";

test("brief incluye concepto, dirección y objetivo", () => {
  const prompt = buildCreativeBrief({ scene: "estudio verde", format: "4:5", brand: "AdVibe", direction: "premium", objective: "branding", audience: "emprendedores" });
  assert.match(prompt, /estudio verde/);
  assert.match(prompt, /Premium/);
  assert.match(prompt, /consistencia de identidad/);
  assert.match(prompt, /emprendedores/);
  assert.match(prompt, /No escribas ningún texto/);
});

test("inputs desconocidos caen a valores seguros", () => {
  const prompt = buildCreativeBrief({ scene: "fondo", format: "1:1", direction: "no-es-valido", objective: "no-es-valido" });
  assert.match(prompt, /Comercial \/ Performance/);
  assert.match(prompt, /comprensión rápida de la oferta/);
});

test("direcciones creativas tienen guidance", () => {
  assert.equal(Object.keys(CREATIVE_DIRECTIONS).length, 6);
  for (const direction of Object.values(CREATIVE_DIRECTIONS)) assert.ok(direction.guidance.length > 40);
});

test("QA detecta formato, titular y CTA inválidos", () => {
  const checks = creativeQualityChecks({ title: "x".repeat(61), cta: "y".repeat(29), format: "3:2", hasProductReference: true, aiScene: true });
  assert.equal(checks.find((x) => x.id === "copy")?.pass, false);
  assert.equal(checks.find((x) => x.id === "cta")?.pass, false);
  assert.equal(checks.find((x) => x.id === "format")?.pass, false);
  assert.equal(checks.find((x) => x.id === "product")?.pass, false);
});

test("QA acepta formato y texto dentro de límites", () => {
  const checks = creativeQualityChecks({ title: "Sofá premium", cta: "Escríbenos", format: "4:5", hasProductReference: true, aiScene: false });
  assert.ok(checks.every((x) => x.pass));
});
