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
