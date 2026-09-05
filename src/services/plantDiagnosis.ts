import { readAsStringAsync } from 'expo-file-system/legacy';
import { PlantDiagnosis } from '../types';
import { apiFetch, apiHeaders, readApiError } from '../lib/api';
import { exceedsUploadLimit } from '../lib/uploadLimit';
import { classifyDiagnosisFailure } from '../lib/diagnosisFailure';
import { getLanguage } from './language';

/*
 * Diagnosis client (TODOS A3).
 *
 * The PlantNet and OpenAI calls used to live in this file, which meant both
 * keys were compiled into the app bundle and shipped to everyone who ever
 * received a build. They now live in server/diagnose.ts. This file uploads the
 * photo and reads back a PlantDiagnosis.
 *
 * The error types below are unchanged on purpose: CameraScreen's
 * `describeFailure` is the single place that decides failure copy, and moving
 * the network work must not reopen the three-error-dialects problem (E9).
 */

const TIMEOUT_MS = 60_000;

/*
 * The identifier recognized no plant. This is about the photo, not about us,
 * and retrying the same photo will not help.
 */
export class NotAPlantError extends Error {
  constructor() {
    super('NOT_A_PLANT');
    this.name = 'NotAPlantError';
  }
}

/*
 * The photo is in a format the identifier cannot read. Retrying the same file
 * will never work, so the app says so rather than blaming the service.
 */
export class UnsupportedImageError extends Error {
  constructor() {
    super('UNSUPPORTED_IMAGE');
    this.name = 'UnsupportedImageError';
  }
}

/*
 * The photo is too big for the server to accept.
 *
 * Its own type rather than a DiagnosisServiceError because the user can act on
 * this one and the action is specific: retake it with the camera, or pick a
 * smaller image. Folding it into the generic service error is what produced
 * "the network connection was lost" for a photo that was simply too large.
 *
 * `bytes` is the encoded size, for the copy only.
 */
export class PhotoTooLargeError extends Error {
  readonly bytes: number;

  constructor(bytes: number) {
    super('PHOTO_TOO_LARGE');
    this.name = 'PhotoTooLargeError';
    this.bytes = bytes;
  }
}

/*
 * This build cannot reach a diagnosis backend at all - no API base URL. Nothing
 * is wrong with the user's photo and retrying will not help; the build is wrong.
 */
export class DiagnosisUnavailableError extends Error {
  constructor() {
    super('DIAGNOSIS_UNAVAILABLE');
    this.name = 'DiagnosisUnavailableError';
  }
}

/*
 * The backend failed, timed out, or answered in a shape we can't use.
 *
 * `detail` is for the log ONLY and must NEVER be shown to the user. The server
 * already strips provider text before answering (H3), so `detail` here is our
 * own status code - but the rule stands at this layer too, because it is the
 * rule that stopped "You have no credits remaining" from being shown to a
 * person whose plant was dying.
 */
export class DiagnosisServiceError extends Error {
  readonly detail: string;

  constructor(detail: string) {
    super('DIAGNOSIS_SERVICE_ERROR');
    this.name = 'DiagnosisServiceError';
    this.detail = detail;
    console.warn(`[diagnosis] ${detail}`);
  }
}

function isDiagnosis(value: unknown): value is PlantDiagnosis {
  if (typeof value !== 'object' || value === null) return false;
  const d = value as Record<string, unknown>;
  return (
    typeof d.plantName === 'string' &&
    typeof d.scientificName === 'string' &&
    typeof d.condition === 'string' &&
    typeof d.conditionLabel === 'string' &&
    Array.isArray(d.issues) &&
    Array.isArray(d.treatments) &&
    typeof d.canBeSaved === 'boolean' &&
    typeof d.confidence === 'number' &&
    typeof d.description === 'string' &&
    /*
     * PRESENCE-CONDITIONAL, never required. A server that predates genus
     * aggregation omits both keys; requiring them here would fail shape
     * validation on every diagnosis it serves and turn a working older
     * deployment into a total outage.
     */
    (d.genus === undefined || typeof d.genus === 'string') &&
    (d.genusConfidence === undefined || typeof d.genusConfidence === 'number') &&
    // Same rule, same reason: absent means PlantNet, which is every response
    // served before the identification backup existed.
    (d.identificationSource === undefined ||
      d.identificationSource === 'plantnet' ||
      d.identificationSource === 'openai')
  );
}

export async function diagnosePlant(imageUri: string): Promise<PlantDiagnosis> {
  if (!process.env.EXPO_PUBLIC_API_BASE_URL) throw new DiagnosisUnavailableError();

  const imageBase64 = await readAsStringAsync(imageUri, { encoding: 'base64' });

  /*
   * Refuse the upload rather than start one that cannot finish. React Native
   * tears down an over-sized request while the body is still being written, so
   * the server's 413 is never read - the client only sees the socket die and
   * reports a network problem. Checked here, the user gets the real reason
   * instantly and spends none of their data finding out.
   */
  if (exceedsUploadLimit(imageBase64.length)) throw new PhotoTooLargeError(imageBase64.length);

  let res: Response;
  try {
    res = await apiFetch('/api/diagnose', {
      method: 'POST',
      headers: apiHeaders({ 'Content-Type': 'application/json' }),
      /* The model answers in this language; the enum fields it branches on
       * stay English regardless - see server/diagnose.ts languageRule. */
      body: JSON.stringify({ imageBase64, lang: getLanguage() }),
      timeoutMs: TIMEOUT_MS,
    });
  } catch (err: unknown) {
    // AbortError (our timeout) and a genuine network failure are the same thing
    // to the user: the service did not answer.
    throw new DiagnosisServiceError(err instanceof Error ? err.message : String(err));
  }

  if (!res.ok) {
    const { error } = await readApiError(res);
    /* The mapping lives in lib/diagnosisFailure so it can be tested without
     * this module's expo-file-system import. `payload_too_large` is belt and
     * braces - the pre-flight guard should mean we never send one this big -
     * but a future change to the server's cap would otherwise land back in the
     * generic branch and read as a network fault again. */
    switch (classifyDiagnosisFailure(res.status, error)) {
      case 'not_a_plant':
        throw new NotAPlantError();
      case 'unsupported_image':
        throw new UnsupportedImageError();
      case 'photo_too_large':
        throw new PhotoTooLargeError(imageBase64.length);
      default:
        throw new DiagnosisServiceError(`${res.status} ${error}`);
    }
  }

  // Valid JSON of the wrong shape used to render a blank screen with no error
  // anywhere. Validate the shape, not just the parse.
  const data = await res.json().catch(() => null);
  if (!isDiagnosis(data)) throw new DiagnosisServiceError('response failed shape validation');
  return data;
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
 * If diagnosis is unavailable, throw - never invent one.
 */
