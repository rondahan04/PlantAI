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
  const formData = new FormData();
  formData.append('images', {
    uri: imageUri,
    name: 'plant.jpg',
    type: 'image/jpeg',
  } as any);
  formData.append('organs', 'auto');

  const response = await fetch(
    `${PLANTNET_URL}?api-key=${apiKey}&nb-results=1&lang=en`,
    { method: 'POST', body: formData }
  );

  if (response.status === 404) throw new NotAPlantError();

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`PlantNet error: ${response.status}. ${errText.slice(0, 120)}`);
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

async function assessHealthWithOpenAI(
  commonName: string,
  scientificName: string,
  apiKey: string
): Promise<HealthAssessment> {
  const response = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'user',
          content: `You are a plant health expert. For ${commonName} (${scientificName}), return a JSON health assessment in this exact shape:
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
condition must be one of: healthy, mild, moderate, severe, critical.
List 2-3 common care tips as treatments. Return ONLY valid JSON.`,
        },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 500,
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`OpenAI error: ${response.status}. ${errText.slice(0, 120)}`);
  }

  const data = await response.json();
  return JSON.parse(data.choices[0].message.content) as HealthAssessment;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function diagnosePlant(
  imageUri: string,
  plantNetKey: string,
  openAiKey: string
): Promise<PlantDiagnosis> {
  const { scientificName, commonName, confidence } = await identifyWithPlantNet(
    imageUri,
    plantNetKey
  );
  const health = await assessHealthWithOpenAI(commonName, scientificName, openAiKey);

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

// ─── Mock fallback (used when API keys are missing) ───────────────────────────

export function getMockDiagnosis(): PlantDiagnosis {
  return {
    plantName: 'Monstera deliciosa',
    condition: 'moderate',
    conditionLabel: 'Root Rot Detected',
    issues: [
      'Yellowing leaves indicate overwatering',
      'Root rot beginning in lower stems',
      'Fungal infection spreading',
    ],
    treatments: [
      {
        title: 'Reduce Watering Immediately',
        description:
          'Allow soil to dry completely between waterings. Only water when top 2 inches of soil are dry.',
        urgent: true,
      },
      {
        title: 'Repot with Fresh Soil',
        description:
          'Remove from pot, trim rotted roots, and repot in well-draining soil mix.',
        urgent: true,
      },
      {
        title: 'Apply Fungicide',
        description: 'Treat with copper-based fungicide every 2 weeks to prevent spread.',
        urgent: false,
      },
    ],
    canBeSaved: true,
    confidence: 87,
    description:
      'Your Monstera is showing early signs of root rot caused by overwatering. The yellowing leaves and soft stems are classic indicators. With prompt treatment, this plant can be saved.',
  };
}
