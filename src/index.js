import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import manifestSchema from '../schemas/manifest.schema.json' with { type: 'json' };
import sectionSchema from '../schemas/section.schema.json' with { type: 'json' };

const MANIFEST_PATHS = ['/.well-known/aiax.json', '/aiax/manifest.json'];
const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: true });
addFormats(ajv);
const validateManifestSchema = ajv.compile(manifestSchema);
const validateSectionSchema = ajv.compile(sectionSchema);

function pointer(base, error) {
  const segments = (error.instancePath || '').split('/').slice(1).filter(Boolean)
    .map(s => s.replaceAll('~1', '/').replaceAll('~0', '~'));
  if (error.keyword === 'required') segments.push(error.params.missingProperty);
  if (error.keyword === 'additionalProperties') segments.push(error.params.additionalProperty);
  return (base || '') + (segments.length ? '/' + segments.map(s => s.replaceAll('~', '~0').replaceAll('/', '~1')).join('/') : '');
}

function friendlyMessage(e) {
  const p = e.params || {};
  switch (e.keyword) {
    case 'required': return `Missing required field "${p.missingProperty}".`;
    case 'additionalProperties': return `Unexpected field "${p.additionalProperty}" is not allowed.`;
    case 'type': return `Expected ${p.type}, but received a different type.`;
    case 'enum': return `Value must be one of: ${(p.allowedValues || []).join(', ')}.`;
    case 'pattern': return `Value does not match the required pattern ${p.pattern}.`;
    case 'format': return `Value is not a valid ${p.format}.`;
    case 'minimum': return `Value must be greater than or equal to ${p.limit}.`;
    case 'maximum': return `Value must be less than or equal to ${p.limit}.`;
    case 'minItems': return `At least ${p.limit} item(s) are required.`;
    case 'maxItems': return `At most ${p.limit} item(s) are allowed.`;
    case 'maxLength': return `Text must be no longer than ${p.limit} characters.`;
    case 'oneOf': return 'Value must match exactly one allowed schema.';
    default: return e.message || `Failed the ${e.keyword || 'schema'} check.`;
  }
}

function schemaErrors(validate, documentUrl, doc, basePath = '') {
  if (validate(doc)) return [];
  return (validate.errors || []).map(e => ({
    url: documentUrl,
    path: pointer(basePath, e),
    message: `${pointer(basePath, e) || '/'}: ${friendlyMessage(e)}`,
  }));
}

async function getResponse(fetchImpl, url) {
  try {
    const r = await fetchImpl(url, { headers: { accept: 'application/json' } });
    return { response: r };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

async function jsonDocument(fetchImpl, url) {
  const got = await getResponse(fetchImpl, url);
  if (got.error) return { error: `Fetch failed: ${got.error}` };
  const r = got.response;
  if (!r || !r.ok) return { status: r?.status ?? 0, error: `HTTP ${r?.status ?? 0}.` };
  try { return { document: await r.json() }; }
  catch { return { error: 'Response body is not valid JSON.' }; }
}

/**
 * Validate an AIAX 0.1 website. No signing, payment, or mutation is performed.
 * @param {string|URL} input URL to validate.
 * @param {{fetch?: typeof fetch}} options Optional injected fetch, including offline fixtures.
 */
export async function validateSite(input, options = {}) {
  let url;
  try { url = new URL(String(input)); }
  catch {
    return { url: String(input), manifest_url: null, ok: false, score: 0,
      errors: [{ url: String(input), path: '/', message: '/: A valid absolute website URL is required.' }], warnings: [], sections: [] };
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    return { url: url.href, manifest_url: null, ok: false, score: 0,
      errors: [{ url: url.href, path: '/', message: '/: URL must use http or https.' }], warnings: [], sections: [] };
  }
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const errors = []; const warnings = []; const sections = [];
  let manifestUrl = null; let manifest = null;
  for (const path of MANIFEST_PATHS) {
    const candidate = new URL(path, url.origin).href;
    const got = await jsonDocument(fetchImpl, candidate);
    if (got.document !== undefined && got.document !== null) {
      manifestUrl = candidate; manifest = got.document; break;
    }
  }
  if (manifest === null) {
    errors.push({ url: new URL(MANIFEST_PATHS[0], url.origin).href, path: '/',
      message: '/: No valid JSON manifest found at /.well-known/aiax.json or /aiax/manifest.json.' });
  } else {
    const validationErrors = schemaErrors(validateManifestSchema, manifestUrl, manifest);
    errors.push(...validationErrors);
    const points = Array.isArray(manifest?.entry_points) ? manifest.entry_points : [];
    for (let i = 0; i < points.length; i++) {
      const point = points[i] || {};
      const id = typeof point.id === 'string' ? point.id : `entry-${i}`;
      let sectionUrl;
      try { sectionUrl = new URL(String(point.url ?? ''), manifestUrl).href; }
      catch {
        const issue = { url: manifestUrl, path: `/entry_points/${i}/url`, message: `/entry_points/${i}/url: Invalid section URL.` };
        errors.push(issue); sections.push({ id, url: String(point.url ?? ''), ok: false, errors: [issue] }); continue;
      }
      const sectionErrors = [];
      const got = await jsonDocument(fetchImpl, sectionUrl);
      if (got.error) {
        sectionErrors.push({ url: sectionUrl, path: '/', message: `/: ${got.error}` });
      } else {
        sectionErrors.push(...schemaErrors(validateSectionSchema, sectionUrl, got.document));
        if (got.document && typeof got.document === 'object' && got.document.section_id !== point.id) {
          const wanted = String(point.id ?? '(missing)');
          const found = String(got.document.section_id ?? '(missing)');
          sectionErrors.push({ url: sectionUrl, path: '/section_id', message: `/section_id: Section id "${found}" does not match manifest entry point id "${wanted}".` });
        }
      }
      errors.push(...sectionErrors);
      sections.push({ id, url: sectionUrl, ok: sectionErrors.length === 0, errors: sectionErrors });
    }
  }
  const score = Math.max(0, Math.min(100, 100 - 10 * errors.length - 2 * warnings.length));
  return { url: url.href, manifest_url: manifestUrl, ok: errors.length === 0 && warnings.length === 0 && score >= 90,
    score, errors, warnings, sections };
}
