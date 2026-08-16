/*
 * Server-side plant diagnosis (TODOS A3).
 *
 * WHY THIS MOVED OFF THE PHONE. `EXPO_PUBLIC_PLANTNET_API_KEY` and
 * `EXPO_PUBLIC_OPENAI_API_KEY` were compiled into the app bundle, which means
 * they shipped in the submitted assignment zip and in every Expo Go build ever
 * shared. That is the root cause behind the P0 key rotation: anyone with the
 * bundle can extract the key and spend it. Holding them here is the fix — the
 * app now sends a photo and gets a diagnosis, and never sees a provider key.
 *
 * The trade this makes: diagnosis used to work whenever the phone had internet,
 * and now it also needs this server to be up. Accepted deliberately (see the A3
 * note in TODOS.md). The failure is honest either way — the app says the
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
 * bodies echo request payloads and account state — a live 429 read "You have no
 * credits remaining. Add credits to continue...", which is a sentence about our
 * billing that a user with a sick plant should never read.
 */
/*
 * The uploaded bytes are not a format the identifier accepts. Worth its own
 * type because the honest sentence is about the file, not about our service —
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
  };
}

// ─── PlantNet ─────────────────────────────────────────────────────────────────

/*
 * PlantNet accepts JPEG and PNG only, and it checks the bytes — not the
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
 * user's actual photo to GPT-5.5 (vision) so it diagnoses THIS plant — visible
 * disease, pests, deficiency — rather than reciting generic by-name care tips.
 */
export function openAiAssessHealth(apiKey: string) {
  return async function assessHealth(image: Buffer, id: Identification): Promise<HealthAssessment> {
    const res = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-5.5',
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
        max_completion_tokens: 800,
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

    if (!isHealthAssessment(parsed)) {
      throw new DiagnosisServiceError(
        'openai',
        `assessment failed validation: ${content.slice(0, 300)}`
      );
    }

    return parsed;
  };
}

function prompt(id: Identification): string {
  return `You are a plant pathologist. The plant in this photo has been identified as ${id.commonName} (${id.scientificName}) — trust that identification and do NOT re-identify the species. Examine the photo and diagnose the health of THIS specific plant: look for disease, pests, nutrient deficiency, over/under-watering, or damage visible in the image. Base every issue on what you can actually see. If the plant looks healthy, say so. Return a JSON health assessment in this exact shape:
{
  "condition": "healthy",
  "conditionLabel": "Healthy",
  "issues": [],
  "treatments": [
    { "title": "string", "description": "string (max 100 chars)", "urgent": false }
  ],
  "description": "string (max 180 chars)",
  "canBeSaved": true
}
condition must be one of: healthy, mild, moderate, severe, critical, reflecting what you see in the photo. List each visible problem in "issues". Provide 2-3 treatments targeting those problems (or general care tips if healthy). Return ONLY valid JSON.`;
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
    typeof a.canBeSaved === 'boolean'
  );
}
