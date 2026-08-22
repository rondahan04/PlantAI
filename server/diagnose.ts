/*
 * Server-side plant diagnosis (TODOS A3).
 *
 * WHY THIS MOVED OFF THE PHONE. `EXPO_PUBLIC_PLANTNET_API_KEY` and
 * `EXPO_PUBLIC_OPENAI_API_KEY` were compiled into the app bundle, which means
 * they shipped in the submitted assignment zip and in every Expo Go build ever
 * shared. That is the root cause behind the P0 key rotation: anyone with the
 * bundle can extract the key and spend it. Holding them here is the fix - the
 * app now sends a photo and gets a diagnosis, and never sees a provider key.
 *
 * The trade this makes: diagnosis used to work whenever the phone had internet,
 * and now it also needs this server to be up. Accepted deliberately (see the A3
 * note in TODOS.md). The failure is honest either way - the app says the
 * service did not answer, never invents a diagnosis.
 *
 * The validators and named error types below were written client-side in
 * `b09a3d7` and are PORTED, not rewritten. `isHealthAssessment` exists because
 * valid JSON of the wrong shape used to render a blank screen with no error
 * anywhere; that bug does not get to come back on the server.
 */

const PLANTNET_URL = 'https://my-api.plantnet.org/v2/identify/all';
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

export interface Treatment {
  title: string;
  description: string;
  urgent: boolean;
}

export type Condition = 'healthy' | 'mild' | 'moderate' | 'severe' | 'critical';

/*
 * Ongoing care for the SPECIES, as opposed to `treatments`, which target what is
 * wrong in this photo right now. A healthy plant has an empty issue list and no
 * urgent treatment, and the user still needs to know how to keep it that way -
 * that gap is what this fills.
 *
 * Optional the whole way down (here, on the wire, and in the client type). A
 * diagnosis is a paid call and the user's plant may be dying; losing it because
 * the model omitted a watering tip would be a bad trade. Missing means "not
 * shown", never "failed".
 */
export interface CarePlan {
  soil: string;
  light: string;
  water: string;
  /*
   * The watering interval as a NUMBER, alongside the prose in `water`.
   *
   * The app schedules a reminder off this, and "Every 7-10 days, when the top
   * 2cm is dry" is not a date. Parsing that sentence client-side was the
   * alternative and was rejected: the model writes it a dozen ways ("weekly",
   * "twice a month", "keep evenly moist") and a regex that silently misreads one
   * of them schedules a reminder for the wrong week, which is worse than none.
   *
   * `waterEveryDaysMax` is the far end of a range and may be absent even when
   * the minimum is present - plenty of species get a single number.
   */
  waterEveryDays?: number;
  waterEveryDaysMax?: number;
}

/* Anything outside this is a model mistake, not a plant. */
const MIN_WATER_DAYS = 1;
const MAX_WATER_DAYS = 90;

export interface PlantDiagnosis {
  plantName: string;
  scientificName: string;
  condition: Condition;
  conditionLabel: string;
  issues: string[];
  treatments: Treatment[];
  canBeSaved: boolean;
  confidence: number;
  description: string;
  carePlan?: CarePlan;
  variety?: string;
}

export interface Identification {
  scientificName: string;
  commonName: string;
  confidence: number;
}

export interface HealthAssessment {
  condition: Condition;
  conditionLabel: string;
  issues: string[];
  treatments: Treatment[];
  description: string;
  canBeSaved: boolean;
  carePlan?: CarePlan;
  /*
   * Cultivar/variety, e.g. "Thai Constellation" for a Monstera deliciosa - only
   * the vision model can name this, PlantNet identifies species, not cultivar.
   * Optional and visual-evidence-only: a model that cannot tell from the photo
   * must omit it rather than guess a variety onto a plain species.
   */
  variety?: string;
}

/*
 * Mirrors `PipelineDeps` in scraper/pipeline.ts: real network calls are wired
 * in by the caller, tests pass stubs. Swapping PlantNet for Plant.id v3 (E1) is
 * a change to one dep, not a change to this module.
 */
export interface DiagnosisDeps {
  identify(image: Buffer): Promise<Identification>;
  assessHealth(image: Buffer, id: Identification): Promise<HealthAssessment>;
}

/*
 * Thrown when the identifier recognizes no plant. This is about the photo, not
 * about us, and the app says so in different words than a service failure.
 */
export class NotAPlantError extends Error {
  constructor() {
    super('NOT_A_PLANT');
    this.name = 'NotAPlantError';
  }
}

/*
 * Thrown when a provider fails or answers in a shape we can't use.
 *
 * `detail` is for the log ONLY and must never leave this process. Provider
 * bodies echo request payloads and account state - a live 429 read "You have no
 * credits remaining. Add credits to continue...", which is a sentence about our
 * billing that a user with a sick plant should never read.
 */
/*
 * The uploaded bytes are not a format the identifier accepts. Worth its own
 * type because the honest sentence is about the file, not about our service -
 * reporting a format problem as "the plant service did not answer" is exactly
 * the dishonest-error pattern E9 exists to remove.
 */
export class UnsupportedImageError extends Error {
  readonly detectedType: string;
  constructor(detectedType: string) {
    super('UNSUPPORTED_IMAGE');
    this.name = 'UnsupportedImageError';
    this.detectedType = detectedType;
  }
}

export type DiagnosisProvider = 'plantnet' | 'openai';

export class DiagnosisServiceError extends Error {
  readonly provider: DiagnosisProvider;
  readonly detail: string;

  constructor(provider: DiagnosisProvider, detail: string) {
    super('DIAGNOSIS_SERVICE_ERROR');
    this.name = 'DiagnosisServiceError';
    this.provider = provider;
    this.detail = detail;
  }
}

export async function diagnose(image: Buffer, deps: DiagnosisDeps): Promise<PlantDiagnosis> {
  const id = await deps.identify(image);
  const health = await deps.assessHealth(image, id);

  return {
    plantName: id.commonName,
    scientificName: id.scientificName,
    condition: health.condition,
    conditionLabel: health.conditionLabel,
    issues: health.issues,
    treatments: health.treatments,
    canBeSaved: health.canBeSaved,
    confidence: id.confidence,
    description: health.description,
    // Omitted rather than sent as undefined: JSON.stringify drops it either
    // way, and an absent key is what the client's optional field expects.
    ...(health.carePlan ? { carePlan: health.carePlan } : {}),
    ...(health.variety ? { variety: health.variety } : {}),
  };
}

// ─── PlantNet ─────────────────────────────────────────────────────────────────

/*
 * PlantNet accepts JPEG and PNG only, and it checks the bytes - not the
 * filename or the declared content type. Sniffing the magic number is what
 * turns "400 Unsupported file type for image[0]" into a sentence about the
 * photo. WebP in particular reaches here easily: the repo's own test fixtures
 * are WebP files named .jpeg, and the app only avoids the problem because
 * expo-image-picker re-encodes to real JPEG on the way out.
 */
function sniffImage(image: Buffer): { mime: string; ext: string } | null {
  if (image.length >= 3 && image[0] === 0xff && image[1] === 0xd8 && image[2] === 0xff) {
    return { mime: 'image/jpeg', ext: 'jpg' };
  }
  if (image.length >= 8 && image.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mime: 'image/png', ext: 'png' };
  }
  return null;
}

function describeBytes(image: Buffer): string {
  if (image.subarray(0, 4).toString('ascii') === 'RIFF') return 'webp/riff';
  if (image.subarray(4, 8).toString('ascii') === 'ftyp') return 'heic/mp4-family';
  if (image.subarray(0, 6).toString('ascii').startsWith('GIF8')) return 'gif';
  return `unknown (${image.subarray(0, 4).toString('hex')})`;
}

export function plantNetIdentify(apiKey: string) {
  return async function identify(image: Buffer): Promise<Identification> {
    const kind = sniffImage(image);
    if (!kind) throw new UnsupportedImageError(describeBytes(image));

    const form = new FormData();
    form.append(
      'images',
      new Blob([new Uint8Array(image)], { type: kind.mime }),
      `plant.${kind.ext}`
    );
    form.append('organs', 'auto');

    const res = await fetch(`${PLANTNET_URL}?api-key=${apiKey}&nb-results=1&lang=en`, {
      method: 'POST',
      body: form,
    });

    if (res.status === 404) throw new NotAPlantError();
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new DiagnosisServiceError('plantnet', `${res.status} ${body.slice(0, 300)}`);
    }

    const data: any = await res.json();
    const top = data.results?.[0];
    if (!top) throw new NotAPlantError();

    return {
      scientificName: top.species?.scientificName ?? '',
      commonName: top.species?.commonNames?.[0] ?? top.species?.scientificName ?? '',
      confidence: Math.round((top.score ?? 0) * 100),
    };
  };
}

// ─── OpenAI health assessment ─────────────────────────────────────────────────

/*
 * PlantNet has already named the species; we trust that name and send the
 * user's actual photo to GPT-5.5 (vision) so it diagnoses THIS plant - visible
 * disease, pests, deficiency - rather than reciting generic by-name care tips.
 */
export function openAiAssessHealth(apiKey: string) {
  return async function assessHealth(image: Buffer, id: Identification): Promise<HealthAssessment> {
    const res = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-5.6-luna',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt(id) },
              {
                type: 'image_url',
                image_url: {
                  // Reuse the sniffed type rather than asserting jpeg: this only
                  // runs after identify() accepted the bytes, so it is jpeg or
                  // png, and mislabelling a png as jpeg is a silent quality loss.
                  url: `data:${sniffImage(image)?.mime ?? 'image/jpeg'};base64,${image.toString('base64')}`,
                },
              },
            ],
          },
        ],
        response_format: { type: 'json_object' },
        // 800 was sized before carePlan existed; three more fields of prose ran
        // the response into the cap and truncated JSON fails to parse, which
        // surfaces as a service error on a diagnosis that actually succeeded.
        max_completion_tokens: 1000,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new DiagnosisServiceError('openai', `${res.status} ${body.slice(0, 300)}`);
    }

    // Three separate failure modes used to live on one unguarded line: empty
    // `choices` threw a TypeError, a refusal threw a SyntaxError, and valid JSON
    // of the wrong shape rendered a blank screen with no error anywhere.
    // Validate the shape, not just the parse.
    const data: any = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      throw new DiagnosisServiceError(
        'openai',
        `no message content: ${JSON.stringify(data).slice(0, 300)}`
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new DiagnosisServiceError('openai', `content was not JSON: ${content.slice(0, 300)}`);
    }

    // Repair known model shape-drift before validating. The guard below still
    // rejects anything genuinely unusable - this only rescues responses whose
    // content is right and whose structure is not.
    const normalized = normalizeAssessment(parsed);
    if (!isHealthAssessment(normalized)) {
      throw new DiagnosisServiceError(
        'openai',
        `assessment failed validation: ${content.slice(0, 300)}`
      );
    }

    return normalized;
  };
}

/*
 * Stand-in for `openAiAssessHealth` when the OpenAI account has no credits
 * (the lecturer's shared key, in this case) and testing everything else -
 * identify, gating, the client UI - shouldn't have to wait on billing. Wired
 * in behind DIAGNOSIS_SKIP_OPENAI (see server/index.ts); never the default.
 * See TODOS.md "Restore OpenAI health assessment" for the revert.
 */
export async function stubAssessHealth(_image: Buffer, _id: Identification): Promise<HealthAssessment> {
  return {
    condition: 'healthy',
    conditionLabel: 'Diagnosis skipped (dev stub)',
    issues: [],
    treatments: [
      {
        title: 'OpenAI call skipped',
        description: 'DIAGNOSIS_SKIP_OPENAI is set - this is not a real diagnosis.',
        urgent: false,
      },
    ],
    description: 'OpenAI credits are exhausted, so this response is a placeholder, not a real health assessment.',
    canBeSaved: true,
  };
}

function prompt(id: Identification): string {
  return `You are a plant pathologist. The plant in this photo has been identified as ${id.commonName} (${id.scientificName}) - trust that identification and do NOT re-identify the species. Examine the photo and diagnose the health of THIS specific plant: look for disease, pests, nutrient deficiency, over/under-watering, or damage visible in the image. Base every issue on what you can actually see. If the plant looks healthy, say so. Return a JSON health assessment in this exact shape:
{
  "condition": "healthy",
  "conditionLabel": "Healthy",
  "issues": ["short sentence naming one visible problem", "another one"],
  "treatments": [
    { "title": "string", "description": "string (max 100 chars)", "urgent": false }
  ],
  "description": "string (max 180 chars)",
  "canBeSaved": true,
  "variety": "string (max 60 chars), omit entirely if not visually determinable",
  "carePlan": {
    "soil": "string (max 90 chars)",
    "light": "string (max 90 chars)",
    "water": "string (max 90 chars)",
    "waterEveryDays": 7,
    "waterEveryDaysMax": 10
  }
}
condition must be one of: healthy, mild, moderate, severe, critical, reflecting what you see in the photo. "issues" must be an array of PLAIN STRINGS - one short sentence per visible problem, never objects. Use [] if the plant is healthy. Provide 2-3 treatments targeting those problems (or general care tips if healthy).

"variety" is the specific cultivar or variety of ${id.commonName}, e.g. "Thai Constellation" for a Monstera deliciosa, named ONLY from what the photo actually shows - variegation pattern, leaf shape or color distinct from the typical species. Do not guess a popular cultivar name onto a plain, unremarkable specimen. Omit the field entirely (do not include the key) when the photo gives no visual evidence of a specific variety.

"carePlan" is ongoing care for this SPECIES, not a fix for what is wrong today - a healthy plant still gets one. "soil": the potting mix and its drainage. "light": state explicitly whether the plant wants DIRECT or INDIRECT light, how bright, and any exposure to avoid. "water": how often, plus the physical check that says it is time (e.g. top 2cm of soil dry). Those three are required and each must be one short concrete phrase, never a paragraph.

"waterEveryDays" is the SAME interval as a whole number of days, because the app schedules a watering reminder from it - it must agree with the "water" sentence. Give "waterEveryDaysMax" as well when the interval is a range ("every 7-10 days" is 7 and 10); omit it for a single figure. Both are between 1 and 90. Adjust the interval for the season and the plant's condition only if the photo justifies it. Return ONLY valid JSON.`;
}

// ─── Validation ───────────────────────────────────────────────────────────────

const CONDITIONS: readonly string[] = ['healthy', 'mild', 'moderate', 'severe', 'critical'];

function isTreatment(value: unknown): value is Treatment {
  if (typeof value !== 'object' || value === null) return false;
  const t = value as Record<string, unknown>;
  return (
    typeof t.title === 'string' &&
    typeof t.description === 'string' &&
    typeof t.urgent === 'boolean'
  );
}

/*
 * Flatten one `issues` element to a string.
 *
 * The prompt asks for plain strings, but the model periodically returns richly
 * shaped objects instead - `{name, evidence, likelyCause}` and similar. That is
 * not an error worth failing a paid diagnosis over: the information the user
 * needs is present, just nested. This lost a live request on 2026-08-18 (r68)
 * while the identical photo had succeeded locally minutes earlier, which is
 * exactly how non-deterministic shape drift shows up - as a phantom
 * environment bug.
 *
 * Prefer the descriptive field over the label when both exist, since `name`
 * alone ("Brown necrotic leaf margins") loses the evidence that justifies it.
 */
function issueToString(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value !== 'object' || value === null) return null;

  const o = value as Record<string, unknown>;
  const pick = (...keys: string[]) =>
    keys.map((k) => o[k]).find((v) => typeof v === 'string' && v.trim()) as string | undefined;

  const label = pick('name', 'issue', 'title', 'problem');
  const detail = pick('evidence', 'description', 'detail', 'observation', 'likelyCause', 'cause');

  if (label && detail) return `${label.replace(/[.:]\s*$/, '')} - ${detail}`;
  return (detail ?? label ?? null)?.trim() || null;
}

function isWaterDays(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MIN_WATER_DAYS &&
    value <= MAX_WATER_DAYS
  );
}

export function isCarePlan(value: unknown): value is CarePlan {
  if (typeof value !== 'object' || value === null) return false;
  const c = value as Record<string, unknown>;
  // Non-empty on purpose: `{soil: ""}` renders a labelled row with nothing
  // beside it, which reads as a rendering bug rather than as missing advice.
  const prose = (['soil', 'light', 'water'] as const).every(
    (k) => typeof c[k] === 'string' && (c[k] as string).trim() !== ''
  );
  if (!prose) return false;

  if (c.waterEveryDays !== undefined && !isWaterDays(c.waterEveryDays)) return false;
  if (c.waterEveryDaysMax !== undefined && !isWaterDays(c.waterEveryDaysMax)) return false;
  /*
   * A max below the minimum is a contradiction - the reminder would be
   * scheduled off whichever end the client read first. A max EQUAL to the
   * minimum is not wrong, just not a range, and carrying it renders as "every
   * 7-7 days"; normalizeCarePlan drops it, so the guard rejects it here rather
   * than letting an un-normalized value through with a field normalize removes.
   */
  if (
    isWaterDays(c.waterEveryDays) &&
    isWaterDays(c.waterEveryDaysMax) &&
    c.waterEveryDaysMax <= c.waterEveryDays
  ) {
    return false;
  }
  // A range with no floor cannot be scheduled from; the prose still stands.
  if (c.waterEveryDaysMax !== undefined && c.waterEveryDays === undefined) return false;

  return true;
}

/*
 * Salvage a care plan whose prose is good and whose numbers are not.
 *
 * The interval is the newest and least reliable part of the response, and it is
 * strictly an enhancement: without it the user reads "every 7-10 days" and
 * waters by eye, exactly as they did before reminders existed. Dropping the
 * whole section over a bad integer would trade three correct sentences for one
 * wrong number. Returns null when the prose itself is unusable.
 */
function normalizeCarePlan(value: unknown): CarePlan | null {
  if (typeof value !== 'object' || value === null) return null;
  const c = value as Record<string, unknown>;

  const prose = ['soil', 'light', 'water'].map((k) => c[k]);
  if (!prose.every((v) => typeof v === 'string' && v.trim() !== '')) return null;

  const plan: CarePlan = {
    soil: (c.soil as string).trim(),
    light: (c.light as string).trim(),
    water: (c.water as string).trim(),
  };

  if (isWaterDays(c.waterEveryDays)) {
    plan.waterEveryDays = c.waterEveryDays;
    // Only meaningful alongside a floor, and only when it is actually above it.
    if (isWaterDays(c.waterEveryDaysMax) && c.waterEveryDaysMax > c.waterEveryDays) {
      plan.waterEveryDaysMax = c.waterEveryDaysMax;
    }
  }

  return plan;
}

/*
 * Coerce a parsed OpenAI response toward HealthAssessment without inventing
 * anything. Only `issues` is repaired and only `carePlan` is dropped - every
 * other field is either present and correct or genuinely wrong, and quietly
 * fabricating a `condition` would put words in a pathologist's mouth. Returns
 * the input untouched when there is nothing to fix.
 */
export function normalizeAssessment(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) return value;
  const a = value as Record<string, unknown>;

  let out = a;

  if (Array.isArray(a.issues) && !a.issues.every((i) => typeof i === 'string')) {
    out = { ...out, issues: a.issues.map(issueToString).filter((s): s is string => s !== null) };
  }

  /*
   * A malformed care plan is repaired where possible and discarded otherwise,
   * never fatal. It is the one advisory field here: the diagnosis the user paid
   * for is still correct without it, so a model that answers `{"light":
   * "bright"}` costs them a section, not the call.
   */
  if ('carePlan' in a && !isCarePlan(a.carePlan)) {
    const repaired = normalizeCarePlan(a.carePlan);
    out = { ...out };
    if (repaired) out.carePlan = repaired;
    else delete out.carePlan;
  }

  // Same treatment as carePlan: advisory and easy for a model to answer with
  // an empty string instead of omitting the key. Drop rather than fail.
  if ('variety' in a && (typeof a.variety !== 'string' || !a.variety.trim())) {
    out = { ...out };
    delete out.variety;
  }

  return out;
}

export function isHealthAssessment(value: unknown): value is HealthAssessment {
  if (typeof value !== 'object' || value === null) return false;
  const a = value as Record<string, unknown>;
  return (
    typeof a.condition === 'string' &&
    CONDITIONS.includes(a.condition) &&
    typeof a.conditionLabel === 'string' &&
    Array.isArray(a.issues) &&
    a.issues.every((i) => typeof i === 'string') &&
    Array.isArray(a.treatments) &&
    a.treatments.every(isTreatment) &&
    typeof a.description === 'string' &&
    typeof a.canBeSaved === 'boolean' &&
    // Advisory: absent is valid, malformed is not. normalizeAssessment has
    // already dropped the malformed case, so this only bites a direct caller.
    (a.carePlan === undefined || isCarePlan(a.carePlan)) &&
    (a.variety === undefined || (typeof a.variety === 'string' && a.variety.trim() !== ''))
  );
}
