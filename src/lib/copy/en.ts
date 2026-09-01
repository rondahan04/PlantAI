/*
 * Every word the app itself writes, in English.
 *
 * THIS FILE DEFINES THE SHAPE. `he.ts` is declared as `Copy`, so TypeScript
 * refuses to compile a Hebrew tree that is missing a key, carries an extra
 * one, or whose function arity has drifted. The most likely failure of a
 * two-language app is one file quietly falling behind the other, and this
 * makes that impossible to commit rather than something to catch in review.
 *
 * Plain strings where the copy is fixed; functions where it is not. The
 * function form is the whole reason for choosing this shape over string keys:
 * Hebrew number and gender agreement is Hebrew logic, and it gets to be
 * written as code in `he.ts` instead of squeezed into a placeholder syntax
 * that only ever fits English.
 *
 * Sections are named after the screen or component that reads them, so a
 * string has exactly one home and deleting a screen makes its copy obviously
 * dead.
 *
 * NOT here, and deliberately: anything the model wrote (a diagnosis, a care
 * plan), species names from the catalog, and scraped nursery text. Those are
 * translated at their source - see the Hebrew spec.
 */
export const en = {
  language: {
    title: 'Language',
    /* Each option is labelled in the language it selects. "Hebrew" written in
     * English is no use to someone who only reads Hebrew. */
    english: 'English',
    hebrew: 'עברית',
    relaunchNotice: 'Language changed. Close and reopen PlantAI to finish.',
    ok: 'OK',
    back: 'Back',
  },
  importBanner: {
    title: (n: number) => `Import your ${n} saved plant${n === 1 ? '' : 's'}?`,
    sub: 'They will follow you to any device you log into.',
    partial: (ok: number, failed: number) =>
      `${ok} imported, ${failed} couldn't - tap to retry.`,
    importAction: 'Import',
    importA11y: 'Import saved plants',
    dismissA11y: 'Not now',
  },
};

/*
 * Deliberately NOT `as const`. A const assertion would make every value a
 * literal type, so `he.ts` declared as `Copy` would be required to contain the
 * English words verbatim - the exact opposite of the point. Without it the
 * strings widen to `string` and the functions keep their signatures, which is
 * precisely the contract the Hebrew tree has to satisfy.
 */
export type Copy = typeof en;
