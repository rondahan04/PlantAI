/*
 * Care guidance for a whole plant GENUS, in every growing medium at once.
 *
 * WHY A GENUS AND NOT A PLANT. Alocasia zebrina and Alocasia frydek want the
 * same care to within the noise between two growers, so a user with nine
 * Alocasias would otherwise pay for nine near-identical calls. The genus is
 * also the one identity the catalog, PlantNet and the vision model actually
 * agree on, which makes it the only key a client cache can be built on without
 * fragmenting into near-duplicates. See src/lib/genusCarePlan.ts, which caches
 * the response of this module forever.
 *
 * WHY ALL EIGHT MEDIA IN ONE ANSWER. The user changes medium by tapping a
 * picker, often at a sink with bad reception, and the schedule has to
 * reschedule on the same frame. Asking per medium would put a network call at
 * exactly the moment the app must feel instant. Eight plans up front cost one
 * call, once, and turn a repot into a local lookup.
 *
 * The structure mirrors server/diagnose.ts on purpose: an injected `askModel`
 * seam so the prompt and the parser are exercised by `node --test` with no key
 * and no network, plus a real OpenAI-backed implementation wired in by
 * server/index.ts.
 */

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

/*
 * The growing media, DUPLICATED from src/lib/soilMedia.ts rather than imported.
 *
 * Server code cannot import from src/: pulling an app module into the
 * tsconfig.node.json program redefines React Native globals and breaks the
 * build (see the note on RootStackParamList in src/types/index.ts). The
 * duplication is deliberate and it is guarded - carePlan.test.ts reads the
 * client list off disk and asserts these are the same eight, because a drift
 * here means the client asks about a medium the server never writes a plan for,
 * the response fails the client's all-or-nothing validator, and genus care
 * plans silently stop working with no error anywhere.
 */
export const SOIL_MEDIUM_IDS = [
  'potting_mix',
  'aroid_mix',
  'leca',
  'pon',
  'sphagnum',
  'bark',
  'perlite_mix',
  'water',
] as const;

export type SoilMediumId = (typeof SOIL_MEDIUM_IDS)[number];

/* What each medium physically is, so the model advises on the substrate rather
 * than on the word. "Pon" in particular is a brand name a model can misread as
 * a generic soil unless it is told what is in the bag. */
const MEDIUM_DESCRIPTIONS: Record<SoilMediumId, string> = {
  potting_mix: 'standard peat-based houseplant soil, water-retentive',
  aroid_mix: 'chunky bark, perlite and coco coir, free-draining',
  leca: 'inert expanded clay balls, semi-hydroponic, sitting in a water reservoir',
  pon: 'inert pumice, zeolite and lava rock with a slow-release mineral fertilizer, usually with a reservoir',
  sphagnum: 'long-fibre sphagnum moss, holds a great deal of water and stays damp',
  bark: 'coarse orchid bark, very airy, dries out quickly',
  perlite_mix: 'mostly perlite, near-hydroponic, very fast draining',
  water: 'roots sitting in plain water, no substrate at all',
};

/* Mirrors `SoilCarePlan` in src/lib/genusCarePlan.ts. The client validates this
 * shape again on arrival - it treats our response as untrusted input like any
 * other - so the two definitions must stay in step. */
export interface SoilCarePlan {
  water: string;
  waterEveryDays: number;
  waterEveryDaysMax?: number;
  fertilizer: string;
  fertilizeEveryDays: number;
  light: string;
  humidity: string;
  warnings?: string[];
}

export interface GenusCarePlanBody {
  bySoil: Record<SoilMediumId, SoilCarePlan>;
}

/*
 * Thrown when the model fails or answers in a shape we cannot use.
 *
 * `detail` is for the log ONLY and must never leave this process, exactly as in
 * DiagnosisServiceError: provider bodies echo request payloads and account
 * state, and a 429 that reads "you have no credits remaining" is a sentence
 * about our billing, not about the user's plant.
 *
 * Unlike DiagnosisServiceError the detail is ALSO the `message`, rather than a
 * fixed code. Eight media fail in eight indistinguishable ways, and a thrown
 * "CARE_PLAN_ERROR" sends whoever reads a stack trace back through the whole
 * response to work out which block was wrong. The route below is what keeps
 * that out of the user's response: it maps this type to a neutral sentence and
 * logs the detail, so a readable message here costs nothing at the boundary.
 */
export class CarePlanError extends Error {
  readonly detail: string;

  constructor(detail: string) {
    super(detail);
    this.name = 'CarePlanError';
    this.detail = detail;
  }
}

/* Anything outside this is a model mistake, not a plant. Same bounds as the
 * diagnosis care plan uses for its watering interval. */
const MIN_INTERVAL_DAYS = 1;
const MAX_INTERVAL_DAYS = 365;

export function carePlanPrompt(genus: string, family: string): string {
  const media = SOIL_MEDIUM_IDS.map((id) => `  "${id}": ${MEDIUM_DESCRIPTIONS[id]}`).join('\n');

  return `You are a horticulturist writing care guidance for the genus ${genus}${
    family ? ` (family ${family})` : ''
  }. Write it for the genus as a whole, not for one species - advice that holds across the ${genus} a houseplant grower is likely to own.

Cover EVERY ONE of these growing media, using exactly these keys:
${media}

Return ONLY valid JSON in this exact shape, with all ${SOIL_MEDIUM_IDS.length} keys present:
{
  "bySoil": {
${SOIL_MEDIUM_IDS.map(
  (id) => `    "${id}": {
      "water": "one or two plain sentences",
      "waterEveryDays": 7,
      "waterEveryDaysMax": 10,
      "fertilizer": "one or two plain sentences",
      "fertilizeEveryDays": 21,
      "light": "one or two plain sentences",
      "humidity": "one or two plain sentences",
      "warnings": ["short sentence naming a trap specific to this medium"]
    }`
).join(',\n')}
  }
}

RULES.
Every field must be specific to BOTH ${genus} AND that medium. Generic houseplant advice repeated eight times is a failed answer.
"waterEveryDays" is when the plant is DUE for water; "waterEveryDaysMax" is when it is LATE. Both are whole numbers of days greater than zero, between ${MIN_INTERVAL_DAYS} and ${MAX_INTERVAL_DAYS}, and the maximum can never be below the minimum. Omit "waterEveryDaysMax" entirely if the interval is a single figure rather than a range.
"fertilizeEveryDays" is a whole number of days greater than zero.
The inert media differ SHARPLY from peat and must not be written as if they were soil. LECA, pon and plain water hold no nutrients at all, so feeding is continuous and dilute rather than occasional, and the watering rhythm is about topping up or changing a reservoir rather than about a substrate drying out. Pon carries its own slow-release mineral feed, which changes what and how often you add.
"warnings" holds traps specific to THAT medium - flushing accumulated salts out of LECA, filling a pon reservoir from below rather than top-watering, root rot from a reservoir that is never changed, sphagnum that was packed too tightly. Use an empty array when a medium genuinely has none; do not invent one.
The prose fields are one or two plain sentences each. No markdown, no bullet points, no headings, no asterisks.
IDENTICAL INTERVALS ACROSS EVERY MEDIUM MEAN YOU HAVE NOT DONE THE TASK. A ${genus} in bark and the same ${genus} in sphagnum are watered on visibly different schedules; if your numbers do not reflect that, the answer is wrong.

Return ONLY the JSON object.`;
}

/*
 * Turn a model response into a body, REBUILT from the ids we know rather than
 * copied from the object the model sent.
 *
 * Rebuilding is the point. A missing medium THROWS, because the client caches
 * this forever: a plan covering seven of eight media is a hit, so the miss that
 * would have refetched it never happens again, and the one user who moves a
 * plant to pon gets an empty care screen for the life of the install. An
 * invented medium is DROPPED rather than passed through, because a key nothing
 * can ever select is dead weight in a cache entry and an invitation for the
 * client's validator to start disagreeing with ours.
 */
export function parseCarePlanBody(value: unknown): GenusCarePlanBody {
  if (typeof value !== 'object' || value === null) {
    throw new CarePlanError(`not an object: ${String(value)}`);
  }
  const raw = (value as Record<string, unknown>).bySoil;
  if (typeof raw !== 'object' || raw === null) {
    throw new CarePlanError(`bySoil missing or not an object: ${JSON.stringify(value).slice(0, 300)}`);
  }
  const bySoilRaw = raw as Record<string, unknown>;

  const bySoil = {} as Record<SoilMediumId, SoilCarePlan>;
  for (const id of SOIL_MEDIUM_IDS) {
    bySoil[id] = parseSoilCarePlan(id, bySoilRaw[id]);
  }
  return { bySoil };
}

/* Every message names the medium, because "an interval was not a number" sends
 * whoever reads the log back through eight near-identical blocks to find out
 * which one, and the tests assert on the id for the same reason. */
function parseSoilCarePlan(id: SoilMediumId, value: unknown): SoilCarePlan {
  if (typeof value !== 'object' || value === null) {
    throw new CarePlanError(`${id}: missing from the response`);
  }
  const p = value as Record<string, unknown>;

  // Non-empty on purpose: `{"light": ""}` renders a labelled row with nothing
  // beside it, which the user reads as a broken screen rather than as advice
  // we did not get.
  const prose = (key: 'water' | 'fertilizer' | 'light' | 'humidity'): string => {
    const s = typeof p[key] === 'string' ? (p[key] as string).trim() : '';
    if (!s) throw new CarePlanError(`${id}: "${key}" was empty or not a string`);
    return s;
  };

  /*
   * Rounded rather than rejected when fractional - "every 6.5 days" is a real
   * answer badly expressed, and the schedule works in whole days. Anything
   * non-finite or non-positive is a different class of problem: it makes the
   * client's `daysUntilDue` NaN or due-forever, which drops a plant out of the
   * watering rota with no visible error at all.
   */
  const interval = (key: 'waterEveryDays' | 'fertilizeEveryDays'): number => {
    const n = Number(p[key]);
    if (!Number.isFinite(n) || n <= 0) {
      throw new CarePlanError(`${id}: "${key}" was not a positive number (${String(p[key])})`);
    }
    return Math.max(MIN_INTERVAL_DAYS, Math.min(MAX_INTERVAL_DAYS, Math.round(n)));
  };

  const waterEveryDays = interval('waterEveryDays');
  const plan: SoilCarePlan = {
    water: prose('water'),
    waterEveryDays,
    fertilizer: prose('fertilizer'),
    fertilizeEveryDays: interval('fertilizeEveryDays'),
    light: prose('light'),
    humidity: prose('humidity'),
  };

  /*
   * The upper end is an enhancement, so a bad one is dropped rather than fatal.
   * Below the minimum it is worse than absent: "due at day 10, late at day 4"
   * is a backwards window that the client renders straight onto the schedule,
   * leaving a plant both due and overdue at once. Equal to the minimum it is
   * not a range at all and renders as "every 7-7 days".
   */
  const max = Number(p.waterEveryDaysMax);
  if (Number.isFinite(max) && max > 0) {
    const rounded = Math.min(MAX_INTERVAL_DAYS, Math.round(max));
    if (rounded > waterEveryDays) plan.waterEveryDaysMax = rounded;
  }

  // Absent is the common case and perfectly valid; a non-list, or a list with
  // junk in it, is filtered rather than refused - warnings never justify losing
  // seven correct plans.
  if (Array.isArray(p.warnings)) {
    const warnings = p.warnings
      .filter((w): w is string => typeof w === 'string' && w.trim() !== '')
      .map((w) => w.trim());
    if (warnings.length > 0) plan.warnings = warnings;
  }

  return plan;
}

/* The network seam, mirroring `DiagnosisDeps`: the real call is wired in by the
 * caller, tests pass a stub and never touch a key. */
export interface CarePlanDeps {
  askModel(prompt: string): Promise<string>;
}

export async function buildCarePlan(
  genus: string,
  family: string,
  deps: CarePlanDeps
): Promise<GenusCarePlanBody> {
  const answer = await deps.askModel(carePlanPrompt(genus, family));

  let parsed: unknown;
  try {
    parsed = JSON.parse(answer);
  } catch {
    throw new CarePlanError(`care plan: not JSON: ${answer.slice(0, 300)}`);
  }

  return parseCarePlanBody(parsed);
}

/*
 * The real call.
 *
 * `max_completion_tokens` is large because the answer is eight blocks of prose
 * rather than the name-and-two-numbers `openAiIdentify` asks for, and a
 * truncated JSON body does not parse - which surfaces as a service error on a
 * call that actually worked, the same way the health assessment ran into its
 * 800-token cap once carePlan was added to it. The other half of that lesson is
 * that a reasoning model can spend its entire allowance thinking and emit no
 * content at all, so an empty or absent message is reported as its own thing
 * with `finish_reason` attached rather than falling through to "not JSON",
 * which would send whoever reads the log looking for a malformed answer that
 * was never written.
 */
export function openAiCarePlan(apiKey: string): CarePlanDeps {
  return {
    async askModel(prompt: string): Promise<string> {
      const res = await fetch(OPENAI_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: 'gpt-5.6-luna',
          messages: [{ role: 'user', content: prompt }],
          response_format: { type: 'json_object' },
          max_completion_tokens: 6000,
        }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new CarePlanError(`care plan ${res.status} ${body.slice(0, 300)}`);
      }

      const data: any = await res.json();
      const choice = data?.choices?.[0];
      const content = choice?.message?.content;
      if (typeof content !== 'string' || content.trim() === '') {
        throw new CarePlanError(
          `care plan: no message content (finish_reason=${String(choice?.finish_reason)}): ${JSON.stringify(data).slice(0, 300)}`
        );
      }
      return content;
    },
  };
}
