/*
 * Translating a diagnosis that was written before the user chose their
 * language.
 *
 * `server/diagnose.ts` already writes Hebrew when the client asks for it, so
 * this is not about new diagnoses - it is about the records already in someone's
 * library. Those were written once, in whatever language the app spoke that
 * day, and switching the setting cannot reach back into them. A user who built
 * a library in English and moved to Hebrew otherwise reads English paragraphs
 * under Hebrew headings forever.
 *
 * WHY A SEPARATE CALL AND NOT A RE-DIAGNOSIS. Re-running the diagnosis would
 * need the photo, cost a vision call, and - the real objection - could come
 * back with a DIFFERENT verdict. The plant has not changed and neither has
 * what the model saw; only the language has. Translating keeps the finding and
 * changes the words, which is the honest description of what the user asked
 * for.
 *
 * SHAPE IN, SAME SHAPE OUT. The request carries only the prose, and the
 * response is rebuilt from the request's own structure rather than from
 * whatever the model chose to return - see `applyTranslation`. A model that
 * drops a treatment or invents a sixth issue cannot corrupt the saved record;
 * at worst a field comes back untranslated.
 */

export type Lang = 'en' | 'he';

export interface TranslatableFields {
  description: string;
  issues: string[];
  /* `productLabel` is the button's WORDS. The search term beside it
   * (`product`) is never sent here - translating it is how the shop link stops
   * finding anything. */
  treatments: { title: string; description: string; productLabel: string }[];
  carePlan?: {
    light: string;
    water: string;
    humidity: string;
    soil: string;
    warnings: string[];
  };
}

export class TranslateError extends Error {
  /* A plain field, not a parameter property: node's type-stripping test runner
   * cannot parse those, and this module is covered by `node --test`. Same
   * shape as CarePlanError for the same reason. */
  readonly detail: string;

  constructor(detail: string) {
    super(detail);
    this.name = 'TranslateError';
    this.detail = detail;
  }
}

export interface TranslateDeps {
  askModel(prompt: string): Promise<string>;
}

/*
 * Caps. This endpoint takes free text from the client and puts it in a prompt,
 * which is the shape of an open text-completion proxy if it is left unbounded.
 * The numbers are generous against a real diagnosis (the model is asked for at
 * most a handful of issues and treatments) and mean nothing to anyone trying
 * to use the app's key to write an essay.
 */
export const MAX_FIELD_CHARS = 2000;
export const MAX_LIST = 12;
const MAX_TOTAL_CHARS = 12000;

const LANGUAGE_NAME: Record<Lang, string> = { en: 'English', he: 'Hebrew' };

export function translatePrompt(fields: TranslatableFields, lang: Lang): string {
  return `Translate the plant-health text below into ${LANGUAGE_NAME[lang]}.

This is an existing diagnosis being shown to a user who has switched the app's language. Translate it; do NOT re-diagnose, do not add findings, do not soften or strengthen anything, and do not add advice that is not already there. Keep the same number of items in every list, in the same order.

DO NOT TRANSLATE, and carry through exactly as they appear:
- botanical names in Latin (genus, species, cultivar)
- units, numbers and pH values
- brand and product names

Return ONLY a JSON object in exactly this shape, with the same array lengths as the input:
${JSON.stringify(skeleton(fields), null, 2)}

The text to translate:
${JSON.stringify(fields, null, 2)}`;
}

/* The shape alone, so the prompt shows the model the contract without paying
 * for the content twice. */
function skeleton(fields: TranslatableFields): unknown {
  return {
    description: 'string',
    issues: fields.issues.map(() => 'string'),
    treatments: fields.treatments.map(() => ({
      title: 'string',
      description: 'string',
      productLabel: 'string',
    })),
    ...(fields.carePlan
      ? {
          carePlan: {
            light: 'string',
            water: 'string',
            humidity: 'string',
            soil: 'string',
            warnings: fields.carePlan.warnings.map(() => 'string'),
          },
        }
      : {}),
  };
}

/*
 * Reject anything that is not a diagnosis-sized request.
 *
 * Returns the reason as a string so the caller can put it in a 400 body, or
 * null when the request is fine - the same shape as a validation helper rather
 * than a thrown error, because this is the client's mistake, not a failure.
 */
export function tooLarge(fields: TranslatableFields): string | null {
  if (fields.issues.length > MAX_LIST) return 'too many issues';
  if (fields.treatments.length > MAX_LIST) return 'too many treatments';
  if ((fields.carePlan?.warnings.length ?? 0) > MAX_LIST) return 'too many warnings';

  const all = [
    fields.description,
    ...fields.issues,
    ...fields.treatments.flatMap((t) => [t.title, t.description, t.productLabel]),
    ...(fields.carePlan
      ? [
          fields.carePlan.light,
          fields.carePlan.water,
          fields.carePlan.humidity,
          fields.carePlan.soil,
          ...fields.carePlan.warnings,
        ]
      : []),
  ];
  if (all.some((s) => s.length > MAX_FIELD_CHARS)) return 'a field is too long';
  if (all.join('').length > MAX_TOTAL_CHARS) return 'the text is too long';
  return null;
}

/*
 * Rebuild the record from OUR structure, taking only strings the model
 * actually returned for slots we actually sent.
 *
 * Every fallback is the original text. A missing, empty or non-string field
 * means that one line stays in the language it was in - visibly imperfect, and
 * the correct outcome: the alternative is a record with a hole in it where a
 * treatment used to be.
 */
export function applyTranslation(
  fields: TranslatableFields,
  raw: unknown
): TranslatableFields {
  const got = (raw ?? {}) as Record<string, any>;
  const str = (v: unknown, fallback: string): string =>
    typeof v === 'string' && v.trim() !== '' ? v.trim() : fallback;

  return {
    description: str(got.description, fields.description),
    issues: fields.issues.map((original, i) => str(got.issues?.[i], original)),
    treatments: fields.treatments.map((original, i) => ({
      title: str(got.treatments?.[i]?.title, original.title),
      description: str(got.treatments?.[i]?.description, original.description),
      productLabel: str(got.treatments?.[i]?.productLabel, original.productLabel),
    })),
    ...(fields.carePlan
      ? {
          carePlan: {
            light: str(got.carePlan?.light, fields.carePlan.light),
            water: str(got.carePlan?.water, fields.carePlan.water),
            humidity: str(got.carePlan?.humidity, fields.carePlan.humidity),
            soil: str(got.carePlan?.soil, fields.carePlan.soil),
            warnings: fields.carePlan.warnings.map((original, i) =>
              str(got.carePlan?.warnings?.[i], original)
            ),
          },
        }
      : {}),
  };
}

export async function translateDiagnosis(
  fields: TranslatableFields,
  deps: TranslateDeps,
  lang: Lang
): Promise<TranslatableFields> {
  const answer = await deps.askModel(translatePrompt(fields, lang));

  let parsed: unknown;
  try {
    parsed = JSON.parse(answer);
  } catch {
    throw new TranslateError(`not JSON: ${answer.slice(0, 300)}`);
  }

  return applyTranslation(fields, parsed);
}

/*
 * The real call. Same shape and the same reasoning as `openAiCarePlan`: JSON
 * mode, a generous token ceiling because the answer is prose rather than two
 * numbers, and an empty message reported as its own failure with
 * `finish_reason` attached - a reasoning model can spend the whole allowance
 * thinking and emit nothing, which is not the same bug as "not JSON" and
 * should not send whoever reads the log looking for a malformed body.
 */
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

export function openAiTranslate(apiKey: string): TranslateDeps {
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
        throw new TranslateError(`translate ${res.status} ${body.slice(0, 300)}`);
      }

      const data: any = await res.json();
      const choice = data?.choices?.[0];
      const content = choice?.message?.content;
      if (typeof content !== 'string' || content.trim() === '') {
        throw new TranslateError(
          `translate: no message content (finish_reason=${String(choice?.finish_reason)}): ${JSON.stringify(data).slice(0, 300)}`
        );
      }
      return content;
    },
  };
}
