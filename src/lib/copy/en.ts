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
  features: {
    /*
     * The three-beat product story. `desc` is the Home card voice (a clause,
     * sized for a row); `blurb` is the onboarding voice (second person, a full
     * sentence under a display headline). Same feature, different space.
     */
    scan: {
      title: 'Snap & Diagnose',
      desc: 'AI identifies what is hurting your plant instantly',
      blurb:
        'Point your camera at a struggling plant. In seconds you get the species, what is wrong, and how to fix it.',
    },
    track: {
      title: 'Track & Water',
      desc: 'A watering schedule tuned to each plant you save',
      blurb:
        'Every plant you save gets a care plan and a watering rhythm, with a reminder so you never guess again.',
    },
    replace: {
      title: 'Find Replacements',
      desc: 'Locate healthy plants at nurseries near you',
      blurb:
        'When a plant is past saving, we find a healthy one at a nursery near you - delivered or ready to collect.',
    },
  },
  portfolio: {
    brand: 'PlantAI',
    greetingNamed: (name: string) => `${name}'s plants`,
    helloNamed: (name: string) => `Hello, ${name}`,
    greetingAnonymous: 'Plant Doctor',
    settingsA11y: 'Account settings',
    title: 'Portfolio',
    filterAll: 'All',
    filterDiagnosed: 'Diagnosed',
    filterAllA11y: 'Show all plants',
    filterDiagnosedA11y: 'Show only plants you have diagnosed',
    dueThisWeek: 'Due this week',
    dueMore: (n: number) => `+${n} more in your plants below`,
    /*
     * A filter matching nothing is not an empty library, and the copy has to
     * say so - otherwise the Diagnosed chip on a hand-built portfolio reads as
     * data loss.
     */
    noneDiagnosed: 'None of your plants have been diagnosed yet. Scan one to see what it needs.',
    /*
     * A damaged library must never be reported as an empty one: "you have no
     * plants" is indistinguishable from a deletion the user never performed.
     * The bytes were preserved, so the copy says recoverable, not lost.
     */
    warnFutureTitle: 'Saved by a newer version',
    warnFutureText: 'Update PlantAI to see this library again. Nothing has been deleted.',
    warnUnreadableTitle: "Some saved plants couldn't be read",
    warnUnreadableText: 'Your data has been set aside, not deleted. New plants save normally.',
    diagnoseAnother: 'Diagnose Another Plant',
    diagnoseAnotherA11y: 'Diagnose another plant - open the camera',
    diagnoseMine: 'Diagnose My Plant',
    diagnoseMineA11y: 'Diagnose my plant - open the camera',
    addPlant: 'Add plant',
    addPlantA11y: 'Add a plant you already own',
    addOwned: 'Add a plant I already own',
    addOwnedA11y: 'Add a plant you already own, without a photo',
    /*
     * The line breaks are hand-placed, not accidental: these two sit on a hero
     * card and are balanced to it. Kept inside the string so each language
     * chooses its own break point - Hebrew word lengths do not fall where
     * English ones do.
     */
    heroTitle: 'Is your plant\nin trouble?',
    heroSub: 'Snap a photo. Get a diagnosis in seconds.\nFind a healthy replacement if needed.',
    howItWorks: 'How it works',
    bottomNote: 'We diagnose 1000+ plant species · fast and accurate',
  },
  plantCard: {
    diagnosedBadge: 'Diagnosed',
    /*
     * ONE label rather than four nodes: a screen reader user wants the plant
     * and its state in a single utterance, not a tour of the row.
     */
    a11y: (p: {
      name: string;
      secondary: string;
      conditionLabel: string;
      when: string;
      watering: string;
    }) =>
      `${p.name}${p.secondary ? `, ${p.secondary}` : ''}` +
      (p.conditionLabel ? `, diagnosed ${p.conditionLabel}` : ', not diagnosed') +
      `, saved ${p.when}` +
      (p.watering ? `, watering ${p.watering.toLowerCase()}` : ''),
  },
  scheduleCard: {
    water: {
      title: 'Watering',
      action: 'Water now',
      start: 'I watered it today',
      done: 'Watered',
    },
    fertilizer: {
      title: 'Feeding',
      action: 'Feed now',
      start: 'I fed it today',
      done: 'Fed',
    },
    repot: {
      title: 'Repotting',
      action: 'Repot now',
      start: 'I repotted it today',
      done: 'Repotted',
    },
    history: 'History',
    historyA11y: (title: string) => `See the ${title.toLowerCase()} history`,
    /*
     * No interval means no interval. A fabricated one here does not stay a
     * line of text - it becomes a due date, then an OS reminder, and the user
     * ends up on a schedule the app invented.
     */
    noSchedule: 'No schedule yet',
    settledA11y: (done: string, label: string) => `${done}. ${label}`,
    actionA11y: (title: string, action: string, label: string) =>
      `${title}: ${action}.${label ? ` ${label}` : ''}`,
    earlyHint: (title: string) => `Double tap and hold to log an early ${title.toLowerCase()}`,
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
