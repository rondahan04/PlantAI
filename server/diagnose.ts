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

import { friendlyName } from './commonNames.ts';
import type { Lang } from './carePlan.ts';

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
  /* Genus and its aggregated score. Optional - see `Identification`. */
  genus?: string;
  genusConfidence?: number;
  /*
   * Which identifier named this plant. Absent means PlantNet, which is what
   * every response before the fallback existed meant - the client must keep
   * rendering those, so this is never required.
   */
  identificationSource?: IdentificationSource;
}

/*
 * PlantNet is a botanical database matching against herbarium photos; the
 * vision model is a general recognizer. They fail differently, which is the
 * whole point of having both - but the user deserves to know which one spoke.
 */
export type IdentificationSource = 'plantnet' | 'openai';

export interface Identification {
  scientificName: string;
  commonName: string;
  /* The identifier's score for THIS SPECIES. See `genusConfidence` for why that
   * is often the wrong number to show a user. */
  confidence: number;
  /* Optional on purpose: an older server omits both, and the client must keep
   * rendering plants saved before they existed. Never make these required. */
  genus?: string;
  genusConfidence?: number;
  /* Set by the identifier itself so the cascade below can compare like for
   * like and the response can say who answered. */
  source?: IdentificationSource;
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
 * in by the caller, tests pass stubs.
 */
export interface DiagnosisDeps {
  identify(image: Buffer): Promise<Identification>;
  assessHealth(image: Buffer, id: Identification, lang?: Lang): Promise<HealthAssessment>;
  /*
   * Second opinion on the species, used only when the primary identifier is
   * weak or down. OPTIONAL: without it `diagnose` behaves exactly as it did
   * before the cascade existed, which is what keeps every existing test and
   * the DIAGNOSIS_SKIP_OPENAI dev mode honest.
   */
  identifyFallback?(image: Buffer, hint?: IdentifyHint): Promise<Identification>;
}

/*
 * What the primary identifier already established, handed to the backup.
 *
 * Only sent on the tiebreak path, where PlantNet has a confident GENUS and an
 * unconvincing species. Naming the genus turns an open-ended "what is this?"
 * into the narrow question we actually have - "which Alocasia is this?" - and
 * a narrow question is one a vision model answers far better.
 */
export interface IdentifyHint {
  genus: string;
  closestSpecies: string;
  closestSpeciesConfidence: number;
}

/*
 * Below this, PlantNet has not really identified the plant - it has ranked
 * guesses. Deliberately the same number as `UNSURE_BELOW` in
 * src/lib/confidence.ts, which is the point at which the app stops leading with
 * the species name: the tier the user would have been shown as "we could not
 * identify this plant" is exactly the tier worth a second opinion.
 */
export const LOW_MATCH_BELOW = 40;

/*
 * The vision model only gets to overrule PlantNet when it is genuinely sure.
 * Same number as `CONFIDENT_AT_OR_ABOVE` client-side, for the same reason:
 * swapping a weak botanical match for an equally weak visual guess buys the
 * user nothing and loses PlantNet's herbarium grounding.
 */
export const LLM_ID_ACCEPT_AT_OR_ABOVE = 70;

/*
 * Below this the SPECIES is not really named, even when the genus is certain.
 *
 * THE GAP THIS CLOSES. PlantNet returned Alocasia sanderiana at 69% on
 * 2026-08-28: too weak for the app to lead with the species, too strong to look
 * weak. The user saw the headline collapse to the bare genus, "Alocasia", while
 * a vision model handed the same photo names the cultivar without hesitating.
 * 40 to 70 was a dead band where we had a confident group and no species and
 * asked nobody about it.
 *
 * Same number as `CONFIDENT_AT_OR_ABOVE` client-side because it is the same
 * decision: the point at which the app stops presenting the species plainly is
 * the point at which the species is worth a second opinion.
 */
export const SPECIES_UNSURE_BELOW = 70;

/*
 * What the identification is actually worth, as one number.
 *
 * The genus sum is the honest headline when it exists (see
 * `aggregateIdentification`): an Anthurium at 23% species / 91% genus is a
 * confident identification, and re-running it through a vision model would
 * spend a call to be told the same thing less reliably.
 */
export function effectiveMatch(id: Identification): number {
  return Math.max(id.confidence, id.genusConfidence ?? 0);
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

/*
 * Identify the plant, with the vision model as a backstop.
 *
 * WHY. PlantNet is a herbarium matcher and it has two failure modes the app
 * used to dead-end on: it answers with a weak spread of guesses (the 23%-across-
 * eight-species case, or a genuine cross-genus miss), or it does not answer at
 * all - a 5xx, or a 404 "no plant here" on a perfectly ordinary houseplant that
 * is under-represented in its dataset. In both cases we already have a vision
 * model in the pipeline, holding the same photo, that can name the species.
 *
 * THE RULES, in order of how much they cost the user:
 *   - Format errors never fall back. The bytes are wrong; a second opinion on
 *     an image nobody can read is a wasted call and a slower error.
 *   - A confident PlantNet answer never falls back. No extra call, no latency.
 *   - A weak answer gets a second opinion, and the model replaces it only when
 *     the model is confident AND beats what we had. A tie keeps PlantNet: it is
 *     matching against real herbarium specimens, the model is recognizing.
 *   - A weak answer whose second opinion fails is still served. The fallback is
 *     an enhancement on this path and must never turn a served diagnosis into
 *     an error.
 *   - A dead PlantNet gets a second opinion, and there the model is all we have
 *     - so a confident answer is used and anything else re-throws the ORIGINAL
 *     error, because "the plant service did not answer" is still the true
 *     sentence about what happened.
 */
export async function resolveIdentification(
  image: Buffer,
  deps: DiagnosisDeps
): Promise<Identification> {
  const fallback = deps.identifyFallback;

  let primary: Identification;
  try {
    primary = await deps.identify(image);
  } catch (err) {
    // About the file, not about the identifier - see UnsupportedImageError.
    if (err instanceof UnsupportedImageError || !fallback) throw err;

    let rescue: Identification;
    try {
      rescue = await fallback(image);
    } catch (fallbackErr) {
      // The photo having no plant in it is a better answer than a service
      // error, and it is the one message that helps the user. Otherwise the
      // original failure stands - the backup's own failure is noise.
      if (fallbackErr instanceof NotAPlantError) throw fallbackErr;
      throw err;
    }

    if (effectiveMatch(rescue) < LLM_ID_ACCEPT_AT_OR_ABOVE) throw err;
    return { ...rescue, source: 'openai' };
  }

  const keep = (): Identification => ({ ...primary, source: primary.source ?? 'plantnet' });

  if (!fallback) return keep();

  // The whole identification is weak - ask the open question.
  if (effectiveMatch(primary) < LOW_MATCH_BELOW) {
    let second: Identification;
    try {
      second = await fallback(image);
    } catch {
      // Enhancement only: a weak identification still beats no diagnosis.
      return keep();
    }

    const better =
      effectiveMatch(second) >= LLM_ID_ACCEPT_AT_OR_ABOVE &&
      effectiveMatch(second) > effectiveMatch(primary);

    return better ? { ...second, source: 'openai' } : keep();
  }

  // Confident group, unconvincing species - ask the narrow question instead.
  if (isGenusLed(primary)) return tiebreakSpecies(image, primary, fallback);

  return keep();
}

/*
 * True when PlantNet is sure of the group and not of the species - the state in
 * which the app shows a bare genus as the plant's name. Mirrors `genusLed` in
 * src/lib/confidence.ts; if that rule moves, this one moves with it, because
 * the tiebreak exists precisely to stop that headline from happening.
 */
function isGenusLed(id: Identification): boolean {
  return (
    typeof id.genus === 'string' &&
    id.genus.trim() !== '' &&
    id.genusConfidence !== undefined &&
    id.genusConfidence >= LLM_ID_ACCEPT_AT_OR_ABOVE &&
    id.confidence < SPECIES_UNSURE_BELOW
  );
}

/*
 * Resolve the species WITHIN a genus PlantNet has already established.
 *
 * The result is a deliberate hybrid: PlantNet keeps the genus and its
 * aggregated score, because summing real herbarium matches is evidence the
 * model cannot produce, and the model supplies only the species name and its
 * own confidence in it. Neither half is asked to do the other's job.
 *
 * The genus check is the guard that makes this safe. A model that answers with
 * a different genus is not breaking the tie we asked about - it is relitigating
 * a question PlantNet answered well - so its answer is dropped rather than
 * promoted. Without that check this path would quietly become a second, weaker
 * route for a vision guess to overrule a confident botanical match.
 */
async function tiebreakSpecies(
  image: Buffer,
  primary: Identification,
  fallback: NonNullable<DiagnosisDeps['identifyFallback']>
): Promise<Identification> {
  const keep = (): Identification => ({ ...primary, source: primary.source ?? 'plantnet' });

  let second: Identification;
  try {
    second = await fallback(image, {
      genus: primary.genus!,
      closestSpecies: primary.scientificName,
      closestSpeciesConfidence: primary.confidence,
    });
  } catch {
    return keep();
  }

  const sameGenus =
    typeof second.genus === 'string' &&
    second.genus.trim().toLowerCase() === primary.genus!.trim().toLowerCase();

  const decisive =
    second.confidence >= LLM_ID_ACCEPT_AT_OR_ABOVE && second.confidence > primary.confidence;

  if (!sameGenus || !decisive) return keep();

  return {
    scientificName: second.scientificName,
    commonName: second.commonName,
    confidence: second.confidence,
    genus: primary.genus,
    // PlantNet's aggregate, not the model's estimate - it is the better number
    // and the one the genus half of the identification actually rests on.
    genusConfidence: primary.genusConfidence,
    source: 'openai',
  };
}

export async function diagnose(
  image: Buffer,
  deps: DiagnosisDeps,
  lang: Lang = 'en'
): Promise<PlantDiagnosis> {
  const id = await resolveIdentification(image, deps);
  const health = await deps.assessHealth(image, id, lang);

  return {
    /*
     * The one place the displayed name is decided. Renaming here rather than in
     * the client means a plant SAVED to the library keeps the everyday name
     * too, and that the name is identical on every screen that reads a stored
     * diagnosis. `scientificName` below is deliberately untouched: this changes
     * what we call the plant, never what we think it is.
     */
    plantName: friendlyName(id.scientificName, id.commonName),
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
    ...(id.genus ? { genus: id.genus } : {}),
    ...(id.genusConfidence !== undefined ? { genusConfidence: id.genusConfidence } : {}),
    ...(id.source ? { identificationSource: id.source } : {}),
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

/*
 * Turn PlantNet's ranked species list into one identification.
 *
 * THE PROBLEM THIS SOLVES. PlantNet scores SPECIES, and it splits its
 * probability mass across every species it considered. Photograph an Anthurium
 * and it may return eight Anthurium species at 23%, 19%, 14%... Reporting the
 * top species score alone renders a confident genus match as "23%", and the
 * client's low-confidence tier then tells the user we could not identify their
 * plant - while the name on screen is right. The number was never wrong; it was
 * answering "which species is this?" when the user asked "what is this?".
 *
 * Summing the same-genus scores answers the second question. Crucially it does
 * NOT paper over real errors: the Aug 2026 case where a Monstera deliciosa came
 * back as Rhaphidophora tetrasperma at 48% is a CROSS-genus mistake, so the
 * genus sum stays low there and the caveat still fires. Same-genus doubt gets
 * quieter; genuinely-wrong identifications do not.
 *
 * We report the genus OF THE TOP CANDIDATE rather than the heaviest genus. A
 * heaviest-genus rule can print "Ficus 40% · best guess Monstera deliciosa 35%",
 * a headline its own subtitle contradicts. Aggregation may only ever strengthen
 * what the top result already said.
 *
 * Pure and exported so the whole cascade is testable without a network call.
 */
export function aggregateIdentification(results: any[]): Identification {
  const candidates = (Array.isArray(results) ? results : [])
    .map((r) => ({
      score: Number(r?.score) || 0,
      scientificName: r?.species?.scientificName ?? '',
      commonName: r?.species?.commonNames?.[0] ?? r?.species?.scientificName ?? '',
      genus: genusOf(r),
    }))
    .filter((c) => c.score > 0)
    // Do not trust the upstream ordering; the top score decides the headline.
    .sort((a, b) => b.score - a.score);

  if (candidates.length === 0) throw new NotAPlantError();

  const top = candidates[0];
  const base: Identification = {
    scientificName: top.scientificName,
    commonName: top.commonName,
    confidence: Math.round(top.score * 100),
  };

  if (!top.genus) return base; // no genus to aggregate on - species score stands

  const key = top.genus.toLowerCase();
  const sum = candidates
    .filter((c) => c.genus && c.genus.toLowerCase() === key)
    .reduce((acc, c) => acc + c.score, 0);

  return {
    ...base,
    genus: top.genus,
    // Clamped: nb-results truncation plus float error can push a sum past 1.
    genusConfidence: Math.max(0, Math.min(100, Math.round(sum * 100))),
  };
}

/*
 * The genus for one PlantNet result. Prefers the structured field; falls back
 * to the first token of the scientific name, but only when it LOOKS like a
 * genus - capitalized, alphabetic, three or more letters. That guard rejects
 * hybrid markers ("×Fatshedera") and junk, which would otherwise become their
 * own bucket and silently split a genus in two.
 */
function genusOf(result: any): string | null {
  const structured = result?.species?.genus?.scientificNameWithoutAuthor;
  if (typeof structured === 'string' && structured.trim()) return structured.trim();

  const name = result?.species?.scientificNameWithoutAuthor ?? result?.species?.scientificName;
  const first = typeof name === 'string' ? name.trim().split(/\s+/)[0] : '';
  return /^[A-Z][a-z-]{2,}$/.test(first) ? first : null;
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

    // 10, not 1: aggregateIdentification needs the genus's siblings to sum. The
    // tail past ten is noise, and PlantNet charges per request, not per result.
    const res = await fetch(`${PLANTNET_URL}?api-key=${apiKey}&nb-results=10&lang=en`, {
      method: 'POST',
      body: form,
    });

    if (res.status === 404) throw new NotAPlantError();
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new DiagnosisServiceError('plantnet', `${res.status} ${body.slice(0, 300)}`);
    }

    const data: any = await res.json();
    // Throws NotAPlantError on an empty result set, exactly as before.
    return aggregateIdentification(data.results ?? []);
  };
}

// ─── OpenAI species identification (backup) ───────────────────────────────────

/*
 * Name the species from the photo alone, as a backup for `plantNetIdentify`.
 *
 * This is NOT a general-purpose identifier and is not wired as one: it runs
 * only through the cascade in `resolveIdentification`, which decides whether
 * the answer is good enough to use. The model is asked for its own confidence
 * and told, in the prompt, that a low number is a perfectly acceptable answer -
 * the cascade's whole safety property is that an unsure model gets discarded,
 * and a model that always answers "95%" destroys it. That is also why the
 * prompt forbids a genus figure below the species one: `effectiveMatch` takes
 * the larger of the two, so an inflated genus number would be the easiest way
 * for a guess to smuggle itself past the threshold.
 */
export function openAiIdentify(apiKey: string) {
  return async function identifyFallback(
    image: Buffer,
    hint?: IdentifyHint
  ): Promise<Identification> {
    const kind = sniffImage(image);
    if (!kind) throw new UnsupportedImageError(describeBytes(image));

    const res = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-5.6-luna',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: identifyPrompt(hint) },
              {
                type: 'image_url',
                image_url: { url: `data:${kind.mime};base64,${image.toString('base64')}` },
              },
            ],
          },
        ],
        response_format: { type: 'json_object' },
        // A name and two numbers. Small on purpose: this call is on the slow
        // path of an already-slow request, and a truncated JSON body here
        // costs the user the backup they were falling back to.
        max_completion_tokens: 300,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new DiagnosisServiceError('openai', `identify ${res.status} ${body.slice(0, 300)}`);
    }

    const data: any = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      throw new DiagnosisServiceError(
        'openai',
        `identify: no message content: ${JSON.stringify(data).slice(0, 300)}`
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new DiagnosisServiceError('openai', `identify: not JSON: ${content.slice(0, 300)}`);
    }

    return parseIdentification(parsed);
  };
}

/*
 * Turn a parsed identification response into an `Identification`.
 *
 * Exported for tests: every branch here is a way the backup can be wrong, and
 * they should not need a network call to exercise.
 *
 * `notAPlant` is honoured before anything else because a model looking at a
 * photo of a desk will still fill in the name fields if asked to - the flag is
 * the only thing that distinguishes "no plant" from "a plant I cannot place",
 * and the two produce different sentences in the app.
 */
export function parseIdentification(value: unknown): Identification {
  if (typeof value !== 'object' || value === null) {
    throw new DiagnosisServiceError('openai', `identify: not an object: ${String(value)}`);
  }
  const o = value as Record<string, unknown>;

  if (o.notAPlant === true) throw new NotAPlantError();

  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const scientificName = str(o.scientificName);
  const commonName = str(o.commonName) || scientificName;
  const genus = str(o.genus) || scientificName.split(/\s+/)[0] || '';

  // A percentage the model did not actually give is not a zero, it is a
  // response we cannot grade - and an ungradable answer must never be allowed
  // to sit at the threshold. Reject rather than default.
  const pct = (v: unknown): number | null => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : null;
  };
  const confidence = pct(o.confidence);

  if (!scientificName || confidence === null) {
    throw new DiagnosisServiceError(
      'openai',
      `identify: unusable response: ${JSON.stringify(value).slice(0, 300)}`
    );
  }

  const genusConfidence = pct(o.genusConfidence);

  return {
    scientificName,
    commonName,
    confidence,
    source: 'openai',
    ...(genus ? { genus } : {}),
    /*
     * Dropped when it undercuts the species score. Aggregation may only ever
     * strengthen the species number (the client asserts the same invariant in
     * identityConfidence), and a genus figure below it means the model was
     * answering something other than what we asked.
     */
    ...(genus && genusConfidence !== null && genusConfidence >= confidence
      ? { genusConfidence }
      : {}),
  };
}

function identifyPrompt(hint?: IdentifyHint): string {
  return `${hint ? tiebreakPreamble(hint) : openPreamble()} Return ONLY valid JSON in this exact shape:
{
  "scientificName": "Monstera deliciosa",
  "commonName": "Swiss cheese plant",
  "genus": "Monstera",
  "confidence": 82,
  "genusConfidence": 95,
  "notAPlant": false
}
"confidence" is how sure you are of the SPECIES, 0-100. "genusConfidence" is how sure you are of the GENUS alone, 0-100, and it can never be lower than "confidence" - being sure of the species implies being at least as sure of the group it belongs to.

BE HONEST ABOUT DOUBT. A low number is a useful, acceptable answer - it is discarded and the user is simply told we are unsure, which is the correct outcome. An inflated number instead hands them a confident diagnosis and a shopping list for a plant they do not own. If the photo is blurry, too far away, shows only soil or a stem, or shows a plant you genuinely cannot place, say so with a low "confidence" rather than naming the most common houseplant that roughly fits.

Set "notAPlant" to true ONLY when the photo contains no plant at all - a person, a room, an object, a blank wall. A plant you cannot identify is NOT "notAPlant"; give it a name and a low confidence. Return ONLY the JSON object.`;
}

/* No prior: the primary identifier failed outright or produced nothing usable. */
function openPreamble(): string {
  return 'You are a botanist identifying a plant from a photograph. Name the plant in the photo as precisely as the image actually supports.';
}

/*
 * The narrow question.
 *
 * The genus is stated as established fact and the model is asked only to pick
 * the species inside it - "which Alocasia is this?" rather than "what is this?".
 * The closest species and its score are included and explicitly labelled as
 * unconvincing: without that the model does not know what has already been
 * ruled inadequate, and hiding it invites it to return the same weak answer.
 *
 * It is told it may keep that candidate, so agreement stays available as a real
 * answer rather than something the phrasing pushes it away from - and told that
 * naming a cultivar is in scope, because 'Polly' is exactly the kind of answer
 * a database of species cannot give and a photograph can.
 */
function tiebreakPreamble(hint: IdentifyHint): string {
  return `You are a botanist. A botanical database has confidently placed the plant in this photograph in the genus ${hint.genus}. Treat the genus as settled. Its best guess at the species is ${hint.closestSpecies}, but only at ${hint.closestSpeciesConfidence}% - not enough to show anyone. Your job is to name the species, and where the photo supports it the cultivar or hybrid, within ${hint.genus}.

Keep ${hint.closestSpecies} if the photo really does support it; agreeing is a valid answer. Name a different ${hint.genus} species when the leaf shape, venation, margins, petiole or variegation point somewhere else. Common cultivar and hybrid names are in scope and are often the truest answer for a houseplant - name one when the photo shows it. If the photo cannot separate the species within ${hint.genus}, give your closest species with a low "confidence"; do not invent precision. If the plant is plainly NOT a ${hint.genus} at all, say so by answering with the genus you actually see - a mismatched genus is discarded rather than used, so answer honestly.`;
}

// ─── OpenAI health assessment ─────────────────────────────────────────────────

/*
 * PlantNet has already named the species; we trust that name and send the
 * user's actual photo to GPT-5.5 (vision) so it diagnoses THIS plant - visible
 * disease, pests, deficiency - rather than reciting generic by-name care tips.
 */
export function openAiAssessHealth(apiKey: string) {
  return async function assessHealth(
    image: Buffer,
    id: Identification,
    lang: Lang = 'en'
  ): Promise<HealthAssessment> {
    const res = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-5.6-luna',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt(id, lang) },
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
export async function stubAssessHealth(
  _image: Buffer,
  _id: Identification,
  _lang?: Lang
): Promise<HealthAssessment> {
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

/*
 * What the model may and may not translate.
 *
 * The fields listed as untouchable are the ones the CLIENT BRANCHES ON.
 * `condition` picks a colour and an icon; `scientificName` is botanical Latin,
 * which translating destroys; `product` is a nursery search term; and the JSON
 * keys are the contract itself. Translate any of those and the app keeps
 * working in the sense that it renders - it just renders the wrong colour, or
 * loses the buy button, on a call that was billed and looked successful.
 */
function languageRule(lang: Lang): string {
  if (lang !== 'he') return '';
  return `
LANGUAGE: write every piece of human-readable text in Hebrew - "conditionLabel", "issues", "description", every treatment "title" and "description", and every "carePlan" sentence.
DO NOT TRANSLATE, and return these exactly as specified in English:
- the JSON field names
- "condition", which must stay one of: healthy, mild, moderate, severe, critical
- "scientificName" and the botanical name in "variety", which are Latin
- "product", which is a search term typed into a shop
Numbers and booleans stay as they are.
`;
}

function prompt(id: Identification, lang: Lang = 'en'): string {
  return `You are a plant pathologist. The plant in this photo has been identified as ${id.commonName} (${id.scientificName}) - trust that identification and do NOT re-identify the species. Examine the photo and diagnose the health of THIS specific plant: look for disease, pests, nutrient deficiency, over/under-watering, or damage visible in the image. Base every issue on what you can actually see. If the plant looks healthy, say so. Return a JSON health assessment in this exact shape:
{
  "condition": "healthy",
  "conditionLabel": "Healthy",
  "issues": ["short sentence naming one visible problem", "another one"],
  "treatments": [
    { "title": "string", "description": "string (max 100 chars)", "urgent": false, "product": "string" }
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
Each treatment's "product" is what to search a nursery for - a substance or brand name, IN ENGLISH, e.g. "Neem oil" or "Confidor". Use an EMPTY STRING when the treatment is an action rather than something to buy ("wipe the scale off by hand"). This drives a shop link, so never put a verb or a sentence in it.

condition must be one of: healthy, mild, moderate, severe, critical, reflecting what you see in the photo. "issues" must be an array of PLAIN STRINGS - one short sentence per visible problem, never objects. Use [] if the plant is healthy. Provide 2-3 treatments targeting those problems (or general care tips if healthy).

"variety" is the specific cultivar or variety of ${id.commonName}, e.g. "Thai Constellation" for a Monstera deliciosa, named ONLY from what the photo actually shows - variegation pattern, leaf shape or color distinct from the typical species. Do not guess a popular cultivar name onto a plain, unremarkable specimen. Omit the field entirely (do not include the key) when the photo gives no visual evidence of a specific variety.

"carePlan" is ongoing care for this SPECIES, not a fix for what is wrong today - a healthy plant still gets one. "soil": the potting mix and its drainage. "light": state explicitly whether the plant wants DIRECT or INDIRECT light, how bright, and any exposure to avoid. "water": how often, plus the physical check that says it is time (e.g. top 2cm of soil dry). Those three are required and each must be one short concrete phrase, never a paragraph.

"waterEveryDays" is the SAME interval as a whole number of days, because the app schedules a watering reminder from it - it must agree with the "water" sentence. Give "waterEveryDaysMax" as well when the interval is a range ("every 7-10 days" is 7 and 10); omit it for a single figure. Both are between 1 and 90. Adjust the interval for the season and the plant's condition only if the photo justifies it. Return ONLY valid JSON.${languageRule(lang)}`;
}

// ─── Validation ───────────────────────────────────────────────────────────────

const CONDITIONS: readonly string[] = ['healthy', 'mild', 'moderate', 'severe', 'critical'];

function isTreatment(value: unknown): value is Treatment {
  if (typeof value !== 'object' || value === null) return false;
  const t = value as Record<string, unknown>;
  return (
    typeof t.title === 'string' &&
    typeof t.description === 'string' &&
    typeof t.urgent === 'boolean' &&
    /* Optional: an older model response has no opinion, and the client falls
     * back to parsing the title for those. */
    (t.product === undefined || typeof t.product === 'string')
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
