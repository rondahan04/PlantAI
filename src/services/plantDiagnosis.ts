import { PlantDiagnosis, Treatment } from '../types';

const PLANT_ID_URL = 'https://plant.id/api/v3/identification';

/*
 * Thrown when Plant.id identifies the image as not a plant (is_plant.binary === false).
 * CameraScreen catches this specifically to show a user-friendly "try again" prompt.
 */
export class NotAPlantError extends Error {
  constructor() {
    super('NOT_A_PLANT');
    this.name = 'NotAPlantError';
  }
}

// ─── Plant.id v3 response shape ──────────────────────────────────────────────

interface PlantIdDisease {
  name: string;
  probability: number;
  details?: {
    description?: string;
    treatment?: {
      biological?: string[];
      chemical?: string[];
      prevention?: string[];
    };
  };
}

interface PlantIdSuggestion {
  name: string;
  probability: number;
  details?: {
    common_names?: string[];
    description?: { value: string };
  };
}

interface PlantIdResponse {
  result: {
    is_plant: { binary: boolean; probability: number };
    classification: { suggestions: PlantIdSuggestion[] };
    is_healthy?: { binary: boolean; probability: number };
    disease?: { suggestions: PlantIdDisease[] };
  };
}

// ─── Condition mapping (agreed thresholds from eng review D6) ────────────────

/*
 * Maps Plant.id health output to the 5-level condition scale used in the UI.
 *
 *   healthy   → is_healthy = true
 *   mild      → max disease probability < 0.30
 *   moderate  → max disease probability < 0.60
 *   severe    → max disease probability < 0.85
 *   critical  → max disease probability ≥ 0.85
 */
function mapCondition(
  isHealthy: boolean,
  maxDiseaseProbability: number
): PlantDiagnosis['condition'] {
  if (isHealthy) return 'healthy';
  if (maxDiseaseProbability < 0.3) return 'mild';
  if (maxDiseaseProbability < 0.6) return 'moderate';
  if (maxDiseaseProbability < 0.85) return 'severe';
  return 'critical';
}

// ─── API call ─────────────────────────────────────────────────────────────────

export async function diagnosePlant(
  imageBase64: string,
  apiKey: string
): Promise<PlantDiagnosis> {
  const response = await fetch(PLANT_ID_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Api-Key': apiKey,
    },
    body: JSON.stringify({
      images: [`data:image/jpeg;base64,${imageBase64}`],
      health: 'all',
      details: 'common_names,description,treatment',
      disease_details: 'description,treatment',
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(
      response.status === 401
        ? 'Invalid Plant.id API key. Check your EXPO_PUBLIC_PLANTID_API_KEY.'
        : `Plant.id API error: ${response.status}. ${errText.slice(0, 120)}`
    );
  }

  const data: PlantIdResponse = await response.json();

  if (!data.result.is_plant.binary) {
    throw new NotAPlantError();
  }

  const suggestions = data.result.classification?.suggestions ?? [];
  if (!suggestions.length) {
    throw new Error('Plant could not be identified. Try a clearer photo.');
  }

  const top = suggestions[0];
  const commonNames = top.details?.common_names;
  const plantName = commonNames?.[0] ?? top.name;
  const confidence = Math.round(top.probability * 100);

  const isHealthy = data.result.is_healthy?.binary ?? true;
  const diseases = data.result.disease?.suggestions ?? [];
  const maxDiseaseProbability = diseases.length > 0 ? diseases[0].probability : 0;

  const condition = mapCondition(isHealthy, maxDiseaseProbability);
  const conditionLabel = isHealthy
    ? 'Healthy'
    : (diseases[0]?.name ?? 'Unknown Issue');

  const issues = diseases.slice(0, 3).map((d) => d.name);

  const treatments: Treatment[] = [];
  if (diseases.length > 0) {
    const topDisease = diseases[0];
    const tr = topDisease.details?.treatment;
    const isUrgent = maxDiseaseProbability > 0.6;

    if (tr?.biological?.length) {
      treatments.push({
        title: 'Biological Treatment',
        description: tr.biological[0],
        urgent: isUrgent,
      });
    }
    if (tr?.chemical?.length) {
      treatments.push({
        title: 'Chemical Treatment',
        description: tr.chemical[0],
        urgent: false,
      });
    }
    if (tr?.prevention?.length) {
      treatments.push({
        title: 'Prevention',
        description: tr.prevention[0],
        urgent: false,
      });
    }
  }

  const descriptionValue = top.details?.description?.value;
  const description = descriptionValue
    ? `${plantName}: ${descriptionValue.slice(0, 180)}${descriptionValue.length > 180 ? '...' : ''}`
    : isHealthy
    ? `Your ${plantName} looks healthy! No signs of disease detected.`
    : `Your ${plantName} shows signs of ${conditionLabel}. ${diseases.length} issue(s) detected.`;

  return {
    plantName,
    condition,
    conditionLabel,
    issues,
    treatments,
    canBeSaved: condition !== 'critical',
    confidence,
    description,
  };
}

// ─── Mock fallback (used when no API key is set) ──────────────────────────────

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
