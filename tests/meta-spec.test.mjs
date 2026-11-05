import test from "node:test";
import assert from "node:assert/strict";
const spec = await import("../src/lib/meta/spec.ts");

const geo = {
  regions: [{ key: "1234", name: "Azuay, Ecuador", country_code: "EC" }, { key: "1235", name: "Cañar, Ecuador", country_code: "EC" }],
  cities: [{ key: "999", name: "Cuenca, Azuay", country_code: "EC", radius: 10, distance_unit: "kilometer" }],
};

test("geo: provincias y ciudades usan solo claves de Meta, sin forzar el país", () => {
  const t = spec.buildTargeting({ ...geo, ageMin: 20, ageMax: 40, genders: [2] });
  assert.deepEqual(t.geo_locations, {
    regions: [{ key: "1234" }, { key: "1235" }],
    cities: [{ key: "999", radius: 10, distance_unit: "kilometer" }],
  });
  assert.equal(t.age_min, 20);
  assert.deepEqual(t.genders, [2]);
  assert.ok(!("countries" in t.geo_locations), "EC no se agrega si no se eligió el país completo");
});

test("empleo: edad 18-65, todos los géneros, sin exclusiones y radio mínimo", () => {
  const input = { ...geo, ageMin: 20, ageMax: 30, genders: [1], excludedCustomAudiences: [{ id: "x" }] };
  const t = spec.buildTargeting(input, ["EMPLOYMENT"]);
  assert.equal(t.age_min, 18);
  assert.equal(t.age_max, 65);
  assert.ok(!("genders" in t));
  assert.ok(!("excluded_custom_audiences" in t));
  assert.equal(t.geo_locations.cities[0].radius, spec.SPECIAL_MIN_RADIUS_KM);
  assert.deepEqual(t.targeting_automation, { advantage_audience: 0 });
  assert.ok(spec.restrictionNotes(input, ["EMPLOYMENT"]).length >= 3);
});

const form = {
  name: "Casting AdVibe · Cuenca",
  fields: ["FULL_NAME", "PHONE", "EMAIL", "CITY"],
  customQuestions: [{ label: "¿Tienes experiencia frente a cámara?", options: ["Sí", "No"] }, { label: "Enlace a tu Instagram o TikTok" }],
  privacyUrl: "https://advibe.ec/privacidad",
  thankYou: { title: "¡Gracias por postular!", body: "Te contactaremos.", buttonText: "Ver AdVibe", websiteUrl: "https://advibe.ec" },
};

test("formulario: payload de leadgen_forms", () => {
  assert.deepEqual(spec.validateLeadForm(form), []);
  const p = spec.buildLeadFormPayload(form);
  assert.ok(!("locale" in p), "sin locale no confirmado en la documentación");
  assert.equal(p.questions.length, 6);
  assert.deepEqual(p.questions[0], { type: "FULL_NAME" });
  assert.equal(p.questions[4].type, "CUSTOM");
  assert.equal(p.questions[4].options.length, 2);
  assert.deepEqual(p.privacy_policy, { url: "https://advibe.ec/privacidad", link_text: "Política de privacidad" });
  assert.equal(p.thank_you_page.button_type, "VIEW_WEBSITE");
  assert.equal(p.thank_you_page.website_url, "https://advibe.ec");
});

test("formulario: validaciones", () => {
  assert.ok(spec.validateLeadForm(undefined).length);
  assert.ok(spec.validateLeadForm({ ...form, privacyUrl: "http://x" }).some((x) => x.includes("privacidad")));
  assert.deepEqual(spec.validateLeadForm({ ...form, privacyUrl: "", existingFormId: "123" }), []);
  assert.ok(spec.validateLeadForm({ ...form, customQuestions: [{ label: "A", options: ["solo"] }] }).length);
});

test("destinos: WhatsApp y sitio web sin cambios; formulario usa ON_AD y lead_gen_form_id", () => {
  assert.deepEqual(spec.destinationAdsetParams("WHATSAPP"), { destination_type: "WHATSAPP" });
  assert.deepEqual(spec.destinationAdsetParams("WEBSITE"), { destination_type: "WEBSITE" });
  assert.deepEqual(spec.destinationAdsetParams("FORM"), { destination_type: "ON_AD", optimization_goal: "LEAD_GENERATION" });
  assert.deepEqual(spec.callToAction("WHATSAPP", {}), { type: "WHATSAPP_MESSAGE", value: { app_destination: "WHATSAPP" } });
  assert.deepEqual(spec.callToAction("WEBSITE", { cta: "SHOP_NOW", link: "https://a.com" }), { type: "SHOP_NOW", value: { link: "https://a.com" } });
  assert.deepEqual(spec.callToAction("FORM", { cta: "WHATSAPP_MESSAGE", formId: "77" }), { type: "SIGN_UP", value: { lead_gen_form_id: "77" } });
  assert.deepEqual(spec.callToAction("FORM", { cta: "APPLY_NOW", formId: "77" }), { type: "APPLY_NOW", value: { lead_gen_form_id: "77" } });
});

test("ubicaciones superpuestas se detectan antes de enviar a Meta", () => {
  const overlap = spec.locationOverlaps({
    countries: ["EC"],
    regions: [{ key: "1234", name: "Azuay", country_code: "EC" }],
    cities: [{ key: "999", name: "Cuenca", country_code: "EC", region_key: "1234" }],
  });
  assert.equal(overlap.length, 3);
  assert.deepEqual(spec.locationOverlaps({ regions: [{ key: "1234", name: "Azuay", country_code: "EC" }, { key: "1235", name: "Cañar", country_code: "EC" }] }), []);
});

test("categorías: CREDIT se envía como FINANCIAL_PRODUCTS_SERVICES y sigue restringida", () => {
  assert.deepEqual(spec.normalizeCategories(["CREDIT", "EMPLOYMENT"]), ["FINANCIAL_PRODUCTS_SERVICES", "EMPLOYMENT"]);
  assert.ok(spec.isRestricted(["FINANCIAL_PRODUCTS_SERVICES"]));
  assert.ok(!spec.isRestricted(["ISSUES_ELECTIONS_POLITICS"]));
});

test("anuncio de formulario: CTA permitida y enlace fb.me", () => {
  assert.equal(spec.LEAD_AD_LINK, "https://fb.me/");
  assert.equal(spec.callToAction("FORM", { cta: "CONTACT_US", formId: "1" }).type, "SIGN_UP");
  assert.equal(spec.callToAction("FORM", { cta: "DOWNLOAD", formId: "1" }).type, "DOWNLOAD");
});

test("leads a CSV: columnas por pregunta y comillas escapadas", async () => {
  const { leadsToCsv } = await import("../src/lib/meta/leadforms-csv.ts");
  const csv = leadsToCsv([
    { id: "1", created_time: "2026-11-05T10:00:00+0000", field_data: [{ name: "full_name", values: ['Ana "A"'] }, { name: "phone_number", values: ["+593999"] }] },
    { id: "2", created_time: "2026-11-05T11:00:00+0000", field_data: [{ name: "full_name", values: ["Luis"] }] },
  ]);
  const lines = csv.split("\n");
  assert.equal(lines[0], '"fecha","full_name","phone_number"');
  assert.ok(lines[1].includes('"Ana ""A"""'));
  assert.ok(lines[2].endsWith(',""'));
});
