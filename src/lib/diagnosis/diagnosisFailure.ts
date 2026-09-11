/*
 * Which failure a diagnosis response represents.
 *
 * Split out of `services/plantDiagnosis.ts` so it can be tested at all: that
 * module imports `expo-file-system`, which does not load under `node --test`,
 * so every mapping decision inside it was unreachable by the test suite. The
 * decision is the part that has actually been wrong in production - a 413 read
 * to the user as "the network connection was lost" - so the decision is what
 * needs covering, not the fetch around it.
 *
 * `plantDiagnosis.ts` turns these into the thrown error types; this file
 * deliberately knows nothing about them, or about copy.
 */
export type DiagnosisFailureKind =
  | 'not_a_plant'
  | 'unsupported_image'
  | 'photo_too_large'
  | 'service';

/*
 * Reads the SERVER'S answer, so it takes the status and the machine code from
 * the error body rather than an exception.
 *
 * The status is consulted as well as the code because the code is only present
 * when the body parsed: a proxy or a platform layer can return a bare 413 with
 * an HTML body, and `readApiError` then reports `http_413` with no code at all.
 * Both are the same fact to the user.
 */
export function classifyDiagnosisFailure(status: number, code: string): DiagnosisFailureKind {
  if (code === 'not_a_plant') return 'not_a_plant';
  if (code === 'unsupported_image') return 'unsupported_image';
  if (code === 'payload_too_large' || status === 413) return 'photo_too_large';
  // Everything else is ours to own, including anything added server-side later:
  // an unknown code must degrade to "we failed", never to a guess about the
  // user's photo.
  return 'service';
}
