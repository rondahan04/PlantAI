import { Image } from 'react-native';
import { File, Paths } from 'expo-file-system';
import type { PlantDiagnosis } from '../types';
import { plantRepo } from './plantRepoInstance';
import { plantPhotos } from './photos';
import { plantLibrary } from './plantLibrary';
import { getSessionHint } from './sessionHint';

/*
 * Dev-only fixtures for exercising the nursery scrape end to end without
 * burning a real camera + diagnosis round trip on every run.
 *
 * Deliberately NOT wired into any production path: the only caller is a
 * `__DEV__`-guarded button on Home. The plants go through `plantRepo.save`
 * like any other save, so they exercise the same guest/cloud split - a seeded
 * plant is a real record, not a render-time stub.
 */

interface Mock {
  file: string; // basename used for the cached copy
  asset: number; // require() handle
  diagnosis: PlantDiagnosis;
}

const MOCKS: Mock[] = [
  {
    file: 'seed-monstera.jpeg',
    asset: require('../../photos_for_testing/sickmonstera.jpeg'),
    diagnosis: {
      plantName: 'Monstera Deliciosa',
      scientificName: 'Monstera deliciosa Liebm.',
      condition: 'critical',
      conditionLabel: 'Critical - beyond treatment',
      issues: [
        'Advanced root rot - the crown is soft and the base has collapsed',
        'More than 70% of the foliage is blackened and dry',
        'No viable growth point left to cut back to',
      ],
      treatments: [],
      canBeSaved: false,
      confidence: 0.93,
      description:
        'This Monstera is past the point where treatment helps. The rot has reached the stem and there is no healthy node left to propagate from. Replace the plant and start with fresh, well-draining soil.',
      carePlan: {
        soil: 'Chunky aroid mix - bark, perlite and coco coir. Never a dense potting soil.',
        light: 'Bright indirect light, no direct midday sun.',
        water: 'Water every 7 days once the top 3 cm are dry.',
        waterEveryDays: 7,
        waterEveryDaysMax: 10,
      },
    },
  },
  {
    file: 'seed-alocasia.jpeg',
    asset: require('../../photos_for_testing/sick.jpeg'),
    diagnosis: {
      plantName: 'Alocasia',
      scientificName: 'Alocasia x amazonica',
      condition: 'moderate',
      conditionLabel: 'Moderate - treatable',
      issues: [
        'Scale insects (כנימות) clustered along the leaf undersides and petioles',
        'Sticky honeydew on the lower leaves',
        'Early sooty mold on the honeydew',
      ],
      treatments: [
        {
          title: 'Confidor (imidacloprid) soil drench',
          description:
            'Mix Confidor at the label rate (about 1 ml per 1 L of water) and drench the soil until it runs from the drainage holes. Repeat after 3 weeks. Systemic, so it reaches the scale under their shields.',
          urgent: true,
        },
        {
          title: 'Wipe the scale off by hand first',
          description:
            'Rub the visible scale off with a cloth dipped in dilute soapy water so the drench has less to kill, then rinse the leaves.',
          urgent: false,
        },
      ],
      canBeSaved: true,
      confidence: 0.88,
      description:
        'A scale (כנימות) infestation caught before it did structural damage. A systemic like Confidor plus manual removal clears it; the plant keeps its leaves.',
      carePlan: {
        soil: 'Loose, moisture-retentive aroid mix with perlite.',
        light: 'Bright indirect light. Direct sun scorches the leaves.',
        water: 'Keep evenly moist - water roughly every 5 days.',
        waterEveryDays: 5,
        waterEveryDaysMax: 7,
      },
    },
  },
];

/*
 * Metro serves bundled assets over HTTP in dev, and the photo pipeline (local
 * adopt and the Storage upload alike) reads real bytes off disk - so the asset
 * is materialised into the cache directory first, exactly where a camera shot
 * would have landed.
 */
async function materialize(mock: Mock): Promise<string> {
  const source = Image.resolveAssetSource(mock.asset);
  if (!source?.uri) throw new Error(`no asset uri for ${mock.file}`);
  if (!source.uri.startsWith('http')) return source.uri;

  const destination = new File(Paths.cache, mock.file);
  if (destination.exists) destination.delete();
  const downloaded = await File.downloadFileAsync(source.uri, destination);
  return downloaded.uri;
}

/*
 * The same fixtures as route params, for jumping straight to the Diagnosis
 * screen - that is the only screen with the "Find Nearby Nurseries" CTA, so
 * this is how a seeded plant reaches the scrape.
 */
export async function mockDiagnosisParams(
  which: 'monstera' | 'alocasia'
): Promise<{ imageUri: string; diagnosis: PlantDiagnosis }> {
  const mock = which === 'monstera' ? MOCKS[0] : MOCKS[1];
  return { imageUri: await materialize(mock), diagnosis: mock.diagnosis };
}

export interface SeedResult {
  saved: number;
  failed: string[];
}

export async function seedMockPlants(): Promise<SeedResult> {
  const result: SeedResult = { saved: 0, failed: [] };

  for (const mock of MOCKS) {
    try {
      const photoUri = await materialize(mock);
      const saved = await plantRepo.save({ photoUri, diagnosis: mock.diagnosis });
      if (!saved.ok) {
        result.failed.push(`${mock.diagnosis.plantName}: ${saved.reason}`);
        continue;
      }
      result.saved += 1;

      // Same guest-only photo adoption the Diagnosis screen does: a cloud save
      // already uploaded the bytes to Storage.
      if (!getSessionHint()) {
        const persisted = await plantPhotos.adopt(saved.plant.id, photoUri);
        if (persisted) plantLibrary.update(saved.plant.id, { photoUri: persisted });
      }
    } catch (e) {
      result.failed.push(`${mock.diagnosis.plantName}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return result;
}
