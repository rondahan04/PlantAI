import { PlantDiagnosis } from '../types';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

export async function diagnosePlant(
  imageBase64: string,
  apiKey: string
): Promise<PlantDiagnosis> {
  const prompt = `You are an expert plant doctor. Analyze this plant photo carefully.

Respond ONLY with a valid JSON object in this exact format (no markdown, no extra text):
{
  "plantName": "Common plant name",
  "condition": "healthy|mild|moderate|severe|critical",
  "conditionLabel": "Short status label like 'Overwatered', 'Root Rot', 'Healthy', 'Pest Infestation'",
  "issues": ["Issue 1", "Issue 2"],
  "treatments": [
    {
      "title": "Treatment name",
      "description": "What to do",
      "urgent": true
    }
  ],
  "canBeSaved": true,
  "confidence": 85,
  "description": "2-3 sentence diagnosis summary"
}

Rules:
- If the plant looks healthy, set condition to "healthy" and canBeSaved to true
- If critically damaged or dead, set condition to "critical" and canBeSaved to false
- confidence is 0-100
- Provide 1-3 issues and 1-3 treatments
- Be specific and actionable`;

  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-opus-4-7',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/jpeg',
                data: imageBase64,
              },
            },
            {
              type: 'text',
              text: prompt,
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API error: ${response.status} - ${error}`);
  }

  const data = await response.json();
  const content = data.content[0].text;

  try {
    const diagnosis = JSON.parse(content);
    return diagnosis as PlantDiagnosis;
  } catch {
    throw new Error('Failed to parse plant diagnosis response');
  }
}

export function getMockDiagnosis(): PlantDiagnosis {
  return {
    plantName: 'Monstera Deliciosa',
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
        description:
          'Treat with copper-based fungicide every 2 weeks to prevent spread.',
        urgent: false,
      },
    ],
    canBeSaved: true,
    confidence: 87,
    description:
      'Your Monstera is showing early signs of root rot caused by overwatering. The yellowing leaves and soft stems are classic indicators. With prompt treatment, this plant can be saved.',
  };
}
