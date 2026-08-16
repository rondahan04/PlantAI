import { File } from 'expo-file-system';
import { readAsStringAsync } from 'expo-file-system/legacy';
import { PlantDiagnosis, Treatment } from '../types';

const PLANTNET_URL = 'https://my-api.plantnet.org/v2/identify/all';
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

/*
 * Thrown when PlantNet returns 404 (no plant recognized) or returns no results.
 * CameraScreen catches this to show a user-friendly "try again" prompt.
 */
export class NotAPlantError extends Error {
  constructor() {
    super('NOT_A_PLANT');
    this.name = 'NotAPlantError';
  }
}

/*
 * Thrown when this build has no keys for the diagnosis pipeline. Nothing is
 * wrong with the user's photo and retrying will not help — the build is wrong.
 */
export class DiagnosisUnavailableError extends Error {
  constructor() {
    super('DIAGNOSIS_UNAVAILABLE');
    this.name = 'DiagnosisUnavailableError';
  }
}

/*
 * Thrown when a provider call fails or answers in a shape we can't use.
 *
 * `detail` is for the log only and must NEVER be shown to the user: provider
 * bodies have echoed request payloads and account state (a live 429 read
 * "You have no credits remaining. Add credits to continue..." — the user's
 * plant has nothing to do with our billing). `message` stays a stable code.
 */
export type DiagnosisProvider = 'plantnet' | 'openai';

export class DiagnosisServiceError extends Error {
  readonly provider: DiagnosisProvider;
  readonly detail: string;

  constructor(provider: DiagnosisProvider, detail: string) {
    super('DIAGNOSIS_SERVICE_ERROR');
    this.name = 'DiagnosisServiceError';
    this.provider = provider;
    this.detail = detail;
    console.warn(`[diagnosis] ${provider} failed: ${detail}`);
  }
}

// ─── PlantNet ─────────────────────────────────────────────────────────────────

interface PlantNetResult {
  scientificName: string;
  commonName: string;
  confidence: number;
}

async function identifyWithPlantNet(
  imageUri: string,
  apiKey: string
): Promise<PlantNetResult> {
  // Expo's global fetch is the winter (WinterCG) implementation, which only
  // accepts string/Blob/File FormData parts — NOT React Native's {uri,name,type}
  // shape (that throws "Unsupported FormDataPart implementation"). expo-file-system's
  // File implements Blob, so it appends correctly and streams the real bytes.
  const formData = new FormData();
  formData.append('images', new File(imageUri));
  formData.append('organs', 'auto');

  const response = await fetch(
    `${PLANTNET_URL}?api-key=${apiKey}&nb-results=1&lang=en`,
    { method: 'POST', body: formData }
  );

  if (response.status === 404) throw new NotAPlantError();

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new DiagnosisServiceError('plantnet', `${response.status} ${errText.slice(0, 300)}`);
  }

  const data = await response.json();
  const top = data.results?.[0];
  if (!top) throw new NotAPlantError();

  return {
    scientificName: top.species.scientificName ?? '',
    commonName: top.species.commonNames?.[0] ?? top.species.scientificName,
    confidence: Math.round(top.score * 100),
  };
}

// ─── OpenAI health assessment ─────────────────────────────────────────────────

interface HealthAssessment {
  condition: PlantDiagnosis['condition'];
  conditionLabel: string;
  issues: string[];
  treatments: Treatment[];
  description: string;
  canBeSaved: boolean;
}

/*
 * Photo-based health assessment. PlantNet has already identified the species;
 * we trust that name and send the user's actual photo to GPT-5.5 (vision) so it
 * diagnoses THIS plant — visible disease, pests, deficiencies — rather than
 * giving generic by-name care tips. The image is inlined as a base64 data URL
 * (a local file:// URI can't be a public URL OpenAI could fetch).
 */
async function assessHealthWithOpenAI(
  imageUri: string,
  commonName: string,
  scientificName: string,
  apiKey: string
): Promise<HealthAssessment> {
  const base64 = await readAsStringAsync(imageUri, { encoding: 'base64' });

  const response = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-5.5',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `You are a plant pathologist. The plant in this photo has been identified as ${commonName} (${scientificName}) — trust that identification and do NOT re-identify the species. Examine the photo and diagnose the health of THIS specific plant: look for disease, pests, nutrient deficiency, over/under-watering, or damage visible in the image. Base every issue on what you can actually see. If the plant looks healthy, say so. Return a JSON health assessment in this exact shape:
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
condition must be one of: healthy, mild, moderate, severe, critical, reflecting what you see in the photo. List each visible problem in "issues". Provide 2-3 treatments targeting those problems (or general care tips if healthy). Return ONLY valid JSON.`,
            },
            {
              type: 'image_url',
              image_url: { url: `data:image/jpeg;base64,${base64}` },
            },
          ],
        },
      ],
      response_format: { type: 'json_object' },
      max_completion_tokens: 800,
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new DiagnosisServiceError('openai', `${response.status} ${errText.slice(0, 300)}`);
  }

  // Three separate failure modes used to live on one unguarded line: empty
  // `choices` threw a TypeError, a refusal threw a SyntaxError, and valid JSON
  // of the wrong shape rendered a blank screen with no error anywhere. Validate
  // the shape, not just the parse.
  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new DiagnosisServiceError('openai', `no message content: ${JSON.stringify(data).slice(0, 300)}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new DiagnosisServiceError('openai', `content was not JSON: ${content.slice(0, 300)}`);
  }

  if (!isHealthAssessment(parsed)) {
    throw new DiagnosisServiceError('openai', `assessment failed validation: ${content.slice(0, 300)}`);
  }

  return parsed;
}

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

function isHealthAssessment(value: unknown): value is HealthAssessment {
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

// ─── Public API ───────────────────────────────────────────────────────────────

export async function diagnosePlant(
  imageUri: string,
  plantNetKey: string,
  openAiKey: string
): Promise<PlantDiagnosis> {
  if (!plantNetKey || !openAiKey) throw new DiagnosisUnavailableError();

  const { scientificName, commonName, confidence } = await identifyWithPlantNet(
    imageUri,
    plantNetKey
  );
  const health = await assessHealthWithOpenAI(imageUri, commonName, scientificName, openAiKey);

  return {
    plantName: commonName,
    condition: health.condition,
    conditionLabel: health.conditionLabel,
    issues: health.issues,
    treatments: health.treatments,
    canBeSaved: health.canBeSaved,
    confidence,
    description: health.description,
  };
}

/*
 * There is deliberately no mock diagnosis here.
 *
 * `getMockDiagnosis()` used to return a hardcoded Monstera root-rot result and
 * was wired as a CameraScreen fallback. It rendered at "87% confidence" with an
 * urgent three-step treatment plan and was visually indistinguishable from a
 * real diagnosis, which meant an outage showed a real person fabricated medical
 * advice about their actual plant. Removed 2026-08-16 (TODOS A5).
 *
 * If diagnosis is unavailable, throw — never invent one.
 */
