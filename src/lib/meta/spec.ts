/**
 * Pure builders for Marketing API payloads (no DB, no network) so they can be
 * unit-tested: targeting (geo + special ad categories) and Instant Forms.
 */

export type GeoPick = { key: string; name: string; country_code?: string; radius?: number; distance_unit?: "kilometer" | "mile" };

export type TargetingInput = {
  countries?: string[];
  regions?: GeoPick[];
  cities?: { key: string; name?: string; country_code?: string; radius?: number; distance_unit?: string }[];
  ageMin?: number;
  ageMax?: number;
  genders?: number[];
  interests?: { id: string; name: string }[];
  customAudiences?: { id: string }[];
  excludedCustomAudiences?: { id: string }[];
  placements?: "advantage" | { publisher_platforms: string[]; facebook_positions?: string[]; instagram_positions?: string[] };
};

/** Special ad categories that restrict targeting (Meta: employment, housing, credit). */
export const RESTRICTED_CATEGORIES = ["EMPLOYMENT", "HOUSING", "CREDIT"];

/** Minimum radius Meta accepts around a city for special ad categories (15 mi ≈ 24.1 km). */
export const SPECIAL_MIN_RADIUS_KM = 25;

export function isRestricted(categories: string[] = []) {
  return categories.some((c) => RESTRICTED_CATEGORIES.includes(c));
}

/**
 * Builds `targeting`. With a restricted special ad category it enforces
 * Meta's rules instead of letting the API reject them: ages 18-65+, all
 * genders, no audience exclusions, minimum city radius, no Advantage+ audience
 * override. Detailed-targeting availability is decided by Meta at publish
 * time; the API error is shown as-is.
 */
export function buildTargeting(t: TargetingInput, specialCategories: string[] = []) {
  const restricted = isRestricted(specialCategories);
  const cities = (t.cities ?? []).map((c) => {
    const radius = c.radius ?? (restricted ? SPECIAL_MIN_RADIUS_KM : 25);
    const unit = (c.distance_unit as "kilometer" | "mile") ?? "kilometer";
    const km = unit === "mile" ? radius * 1.609 : radius;
    return {
      key: c.key,
      radius: restricted && km < SPECIAL_MIN_RADIUS_KM ? SPECIAL_MIN_RADIUS_KM : radius,
      distance_unit: restricted && km < SPECIAL_MIN_RADIUS_KM ? "kilometer" : unit,
    };
  });
  const geo: Record<string, unknown> = {};
  if (t.countries?.length) geo.countries = t.countries;
  if (t.regions?.length) geo.regions = t.regions.map((r) => ({ key: r.key }));
  if (cities.length) geo.cities = cities;

  const out: Record<string, unknown> = {
    geo_locations: geo,
    age_min: restricted ? 18 : t.ageMin ?? 18,
    age_max: restricted ? 65 : t.ageMax ?? 65,
  };
  if (!restricted) out.targeting_automation = { advantage_audience: 0 };
  if (!restricted && t.genders?.length) out.genders = t.genders;
  if (t.interests?.length) out.flexible_spec = [{ interests: t.interests.map((i) => ({ id: i.id, name: i.name })) }];
  if (t.customAudiences?.length) out.custom_audiences = t.customAudiences;
  if (!restricted && t.excludedCustomAudiences?.length) out.excluded_custom_audiences = t.excludedCustomAudiences;
  if (t.placements && t.placements !== "advantage") Object.assign(out, t.placements);
  return out;
}

/** Human-readable list of what the restricted category changed, for the UI. */
export function restrictionNotes(t: TargetingInput, specialCategories: string[] = []): string[] {
  if (!isRestricted(specialCategories)) return [];
  const notes = ["Edad fijada en 18-65+ (categoría especial)."];
  if (t.genders?.length) notes.push("Se ignora el filtro de género (categoría especial).");
  if (t.excludedCustomAudiences?.length) notes.push("Se ignoran las exclusiones de públicos (categoría especial).");
  if ((t.cities ?? []).some((c) => (c.radius ?? 25) < SPECIAL_MIN_RADIUS_KM)) {
    notes.push(`Radio mínimo de ${SPECIAL_MIN_RADIUS_KM} km alrededor de ciudades (categoría especial).`);
  }
  return notes;
}

export function hasLocation(t: TargetingInput) {
  return Boolean(t.countries?.length || t.regions?.length || t.cities?.length);
}

/* ─────────────────────────── Instant Forms ─────────────────────────── */

export const STANDARD_FIELDS = {
  FULL_NAME: "Nombre completo",
  EMAIL: "Correo electrónico",
  PHONE: "Teléfono",
  CITY: "Ciudad",
  PROVINCE: "Provincia",
  DOB: "Fecha de nacimiento",
  GENDER: "Género",
} as const;
export type StandardField = keyof typeof STANDARD_FIELDS;

export type LeadFormConfig = {
  /** Use an existing form (id from the page) instead of creating one. */
  existingFormId?: string;
  name: string;
  fields: StandardField[];
  /** Custom short-answer or multiple-choice questions. */
  customQuestions: { label: string; options?: string[] }[];
  privacyUrl: string;
  privacyLinkText?: string;
  intro?: { headline: string; description?: string };
  thankYou: { title: string; body: string; buttonText: string; websiteUrl?: string };
  locale?: string;
  /** "Higher intent" adds a review step before submitting. */
  higherIntent?: boolean;
  /** Filled after the form is created in Meta. */
  metaFormId?: string;
};

const URL_RE = /^https:\/\/[^\s/$.?#].[^\s]*$/i;

export function validateLeadForm(f: LeadFormConfig | undefined): string[] {
  if (!f) return ["Configura el formulario instantáneo."];
  if (f.existingFormId || f.metaFormId) return [];
  const issues: string[] = [];
  if (!f.name?.trim()) issues.push("El formulario necesita un nombre.");
  if (!f.fields?.length && !f.customQuestions?.length) issues.push("El formulario necesita al menos una pregunta.");
  if (!URL_RE.test(f.privacyUrl || "")) issues.push("La política de privacidad debe ser una URL https válida (Meta la exige).");
  if (!f.thankYou?.title?.trim() || !f.thankYou?.body?.trim()) issues.push("Completa título y texto de la pantalla de agradecimiento.");
  if (f.thankYou?.websiteUrl && !URL_RE.test(f.thankYou.websiteUrl)) issues.push("La URL del botón de agradecimiento no es válida.");
  if (!f.thankYou?.websiteUrl) issues.push("La pantalla de agradecimiento necesita una URL para su botón.");
  f.customQuestions?.forEach((q, i) => {
    if (!q.label?.trim()) issues.push(`La pregunta personalizada ${i + 1} no tiene texto.`);
    if (q.options && q.options.length === 1) issues.push(`La pregunta "${q.label}" necesita al menos 2 opciones.`);
  });
  return issues;
}

const slug = (s: string, i: number) =>
  (s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "q") +
  `_${i + 1}`;

/** Payload for POST /{page_id}/leadgen_forms. */
export function buildLeadFormPayload(f: LeadFormConfig) {
  const questions: Record<string, unknown>[] = f.fields.map((type) => ({ type }));
  f.customQuestions.forEach((q, i) => {
    const base: Record<string, unknown> = { type: "CUSTOM", key: slug(q.label, i), label: q.label };
    if (q.options?.length) base.options = q.options.map((value, j) => ({ value, key: `${slug(value, j)}` }));
    questions.push(base);
  });
  const payload: Record<string, unknown> = {
    name: f.name,
    locale: f.locale || "es_LA",
    questions,
    privacy_policy: { url: f.privacyUrl, link_text: f.privacyLinkText || "Política de privacidad" },
    thank_you_page: {
      title: f.thankYou.title,
      body: f.thankYou.body,
      button_type: "VIEW_WEBSITE",
      button_text: f.thankYou.buttonText || "Visitar sitio web",
      website_url: f.thankYou.websiteUrl,
    },
    follow_up_action_url: f.thankYou.websiteUrl,
    is_optimized_for_quality: Boolean(f.higherIntent),
  };
  if (f.intro?.headline) {
    payload.context_card = {
      title: f.intro.headline,
      style: "PARAGRAPH_STYLE",
      content: f.intro.description ? [f.intro.description] : [],
    };
  }
  return payload;
}

/** Ad set settings per destination. */
export function destinationAdsetParams(destination: string) {
  switch (destination) {
    case "WHATSAPP":
      return { destination_type: "WHATSAPP" };
    case "MESSENGER":
      return { destination_type: "MESSENGER" };
    case "INSTAGRAM_DM":
      return { destination_type: "INSTAGRAM_DIRECT" };
    case "WEBSITE":
      return { destination_type: "WEBSITE" };
    case "FORM":
      return { destination_type: "ON_AD", optimization_goal: "LEAD_GENERATION" };
    default:
      return {};
  }
}

/** Creative call to action per destination. */
export function callToAction(destination: string, opts: { cta?: string; link?: string; formId?: string }) {
  if (destination === "WHATSAPP") return { type: "WHATSAPP_MESSAGE", value: { app_destination: "WHATSAPP" } };
  if (destination === "FORM") {
    const type = ["SIGN_UP", "APPLY_NOW", "LEARN_MORE", "GET_QUOTE", "SUBSCRIBE", "CONTACT_US"].includes(opts.cta || "") ? opts.cta : "SIGN_UP";
    return { type, value: { lead_gen_form_id: opts.formId } };
  }
  return { type: opts.cta || "LEARN_MORE", value: { link: opts.link } };
}
