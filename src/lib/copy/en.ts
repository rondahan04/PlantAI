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
  /*
   * Display names for the growing media. `src/lib/soilMedia.ts` stays the
   * structural source - ids and the watering multipliers that are physics, not
   * language - and this is the translation overlay keyed by its ids. A test
   * asserts the overlay covers every SOIL_MEDIUM_ID, so adding a ninth medium
   * fails until its Hebrew exists rather than silently rendering English.
   */
  /*
   * Injected into `identityConfidence` (lib/confidence.ts), which decides WHICH
   * message applies but must not know the language. English here duplicates
   * EN_IDENTITY_COPY in that module, which is its default for pre-Hebrew
   * callers and its tests; the copy test asserts the two agree.
   */
  identity: {
    speciesMatch: (percent: number) => `${percent}% species match`,
    genusMatch: (percent: number) => `${percent}% genus match`,
    probably: 'Probably',
    possibly: 'Possibly',
    genusLedTitle: 'We know the plant group, not the exact species',
    genusLedBody: (p: { genus: string; genusPercent: number; plantName: string; percent: number }) =>
      `This is a ${p.genus} (${p.genusPercent}% match). We cannot tell which species - ${p.plantName} is the closest at ${p.percent}%. Care for the group is reliable; anything species-specific may not be.`,
    moderateTitle: 'We are not certain of the species',
    moderateBody: (plantName: string) =>
      `This looks like ${plantName}, but it is not a confident match. The advice below assumes that identification is right.`,
    lowTitle: 'We could not identify this plant',
    lowBody: (plantName: string) =>
      `${plantName} is our best guess and it is a weak one. Treat the advice below as a starting point, not a diagnosis. A photo with the leaves filling the frame, in daylight, usually identifies much better.`,
  },
  diagnosis: {
    headerTitle: 'Diagnosis',
    back: 'Back',
    backToHomeA11y: 'Back to home',
    saveA11y: 'Save to my plants',
    savedA11y: 'Saved to my plants. Tap to remove.',
    saveFailedTitle: "Couldn't save",
    saveFailedNetwork: "Couldn't reach your account. Check your connection and try again.",
    saveFailedStorage: 'Your device is out of storage space. Free some space and try again.',
    closestSpecies: (name: string) => `Closest species: ${name}`,
    /* The confidence bar can carry two numbers, and a screen reader gets none
     * of that from geometry - so the label states both explicitly. */
    identityA11y: (parts: {
      prefix: string;
      headline: string;
      genusLabel: string;
      species: string;
      label: string;
      caveat: string;
    }) =>
      [
        parts.prefix,
        `${parts.headline}.`,
        parts.genusLabel ? `${parts.genusLabel}.` : '',
        parts.species
          ? `Closest species ${parts.species}, ${parts.label}.`
          : `${parts.label}.`,
        parts.caveat ? `${parts.caveat}.` : '',
      ]
        .filter(Boolean)
        .join(' '),
    retakeA11y: 'Not your plant? Retake the photo',
    retake: 'Not your plant? Retake photo',
    issues: 'Issues detected',
    treatments: 'Treatment plan',
    urgent: 'URGENT',
    findProduct: (product: string) => `Find ${product} nearby`,
    findProductA11y: (product: string) => `Find ${product} at nurseries near you`,
    replaceOr: 'Or replace with a healthy one',
    replaceTitle: 'Find a healthy replacement',
    replaceDesc: (name: string) =>
      `This plant is too damaged to save. Find an identical, healthy ${name} at nurseries near you.`,
    delivered: 'Get it delivered today',
    pickup: 'Pick it up',
    findNurseriesA11y: 'Find nurseries',
    findDelivery: 'Find Delivery Options',
    findNearby: 'Find Nearby Nurseries',
    scanAnother: 'Scan Another Plant',
  },
  camera: {
    /*
     * `describeFailure` is the single source of failure copy on this screen
     * (E9) - the reason there is one voice here instead of three. Each entry is
     * a title the user can act on plus a body that says what to do next, never
     * a status code.
     */
    notAPlantTitle: "We couldn't find a plant in that photo",
    notAPlantBody:
      'Point the camera at leaves, stems, or flowers, close enough to fill most of the frame.',
    unsupportedTitle: "We can't read that image",
    unsupportedBody:
      'That file is in a format we cannot open. A photo taken with the camera, or a JPEG or PNG from your library, will work.',
    unavailableTitle: 'Diagnosis is unavailable',
    unavailableBody:
      'This build is not pointed at a plant identification service. Nothing is wrong with your photo or your plant.',
    failedTitle: "We couldn't finish the diagnosis",
    failedBody: 'The plant service did not answer. Your photo is fine - this one is on us.',
    captureFailedTitle: "The camera didn't capture that",
    captureFailedBody: 'Something interrupted the shot. Try again, or pick an existing photo instead.',
    photoPermissionTitle: 'PlantAI needs access to your photos',
    photoPermissionBody: 'Allow photo access in Settings to pick a picture you already took.',
    tryAgain: 'Try again',
    takeAnother: 'Take another photo',
    backToHome: 'Back to home',
    permissionTitle: 'Camera access needed',
    permissionDesc: 'PlantAI needs your camera to diagnose plant health issues.',
    allowCamera: 'Allow Camera',
    allowCameraA11y: 'Allow camera access',
    orGallery: 'Or pick from gallery instead',
    close: 'Close',
    closeCamera: 'Close camera',
    scanTitle: 'Scan Plant',
    flipCamera: 'Flip camera',
    hint: 'Center your plant in the frame',
    gallery: 'Gallery',
    pickFromGallery: 'Pick from gallery',
    takePhoto: 'Take photo',
    analyzingTitle: 'Analyzing your plant',
    /* Break kept inside the string so each language chooses where it falls. */
    analyzingDesc: "We're examining the symptoms,\nidentifying the species and condition...",
  },
  careHistory: {
    /*
     * `logged` and `noneThisMonth` are functions, not templates with a plural
     * suffix: Hebrew agreement does not decompose into "noun + s", and the
     * count word changes shape rather than gaining a letter.
     */
    water: {
      short: 'Water',
      title: 'Watering history',
      empty: 'No waterings logged yet - tap Water now on the plant to start.',
      logged: (n: number) => `${n} ${n === 1 ? 'watering' : 'waterings'} logged`,
      noneThisMonth: 'No waterings this month',
    },
    repot: {
      short: 'Repot',
      title: 'Repotting history',
      empty: 'No repotting logged yet - tap Log repot on the plant to start.',
      logged: (n: number) => `${n} ${n === 1 ? 'repot' : 'repots'} logged`,
      noneThisMonth: 'No repots this month',
    },
    fertilizer: {
      short: 'Feed',
      title: 'Fertilizer history',
      empty: 'No feeding logged yet - tap Log feed on the plant to start.',
      logged: (n: number) => `${n} ${n === 1 ? 'feed' : 'feeds'} logged`,
      noneThisMonth: 'No feeds this month',
    },
    allTitle: 'Care history',
    allEmpty: 'Nothing logged yet - water, repot or feed the plant to start.',
    allLogged: (n: number) => `${n} care ${n === 1 ? 'entry' : 'entries'} logged`,
    allNoneThisMonth: 'Nothing logged this month',
    daysOfCare: (n: number) => `${n} ${n === 1 ? 'day' : 'days'} of care this month`,
    filterAll: 'All',
    missingTitle: 'This plant is no longer saved',
    goBack: 'Go back',
    unnamed: 'Unnamed plant',
    prevMonth: 'Previous month',
    nextMonth: 'Next month',
    nextDue: 'Next due',
    recent: 'Recent',
    dayA11y: (date: string, done: string, due: string) => `${date}${done}${due}`,
    doneSuffix: (kind: string) => `, ${kind.toLowerCase()} logged`,
    dueSuffix: (kind: string) => `, ${kind.toLowerCase()} due`,
  },
  plantDetail: {
    missingTitle: 'This plant is no longer saved',
    backToPlants: 'Back to my plants',
    backLabel: 'My Plants',
    removeA11y: 'Remove this plant',
    undiagnosed: 'You have not had this plant checked yet.',
    checkIt: 'Check it',
    checkA11y: (name: string) => `Check ${name} with the camera`,
    issues: 'Issues detected',
    treatments: 'Treatment plan',
    urgent: 'URGENT',
    findProduct: (product: string) => `Find ${product} nearby`,
    findProductA11y: (product: string) => `Find ${product} at nurseries near you`,
    careSchedule: 'Care schedule',
    findAtNursery: 'Find this plant at a nursery',
    findingNurseries: 'Finding nurseries...',
    findAtNurseryA11y: (name: string) => `Find nurseries selling ${name}`,
    replacementTitle: 'Find a healthy replacement',
    replacementNote: (name: string) =>
      `This plant is too damaged to save. Find a healthy ${name} near you.`,
    findNearby: 'Find nearby nurseries',
    findNearbyA11y: (name: string) => `Find ${name} at nurseries near you`,
    savedOn: (date: string) => `Saved ${date}`,
    removeTitle: 'Remove this plant?',
    removeBody: (name: string) => `${name} will be removed from your plants.`,
    cancel: 'Cancel',
    remove: 'Remove',
    /*
     * Why a write did not land, in the user's terms. `network` only reaches a
     * logged-in user, and telling them to free disk space for a request that
     * never left the phone sends them after the wrong problem.
     */
    failNotFound: 'This plant is no longer saved.',
    failNetwork: "We couldn't reach your account. Check your connection and try again.",
    failStorage: 'Your device is out of storage space, so nothing was saved.',
    saveFailedTitle: "Couldn't save that",
    saveFailedStorage: 'Your device is out of storage space, so the growing medium was not saved.',
    logFailedTitle: "Couldn't record that",
    waterFailedStorage: 'Your device is out of storage space, so the watering was not saved.',
    removeFailedTitle: "Couldn't remove",
    removeFailedStorage: 'Your device is out of storage space.',
  },
  soilMedia: {
    potting_mix: { label: 'Potting mix', description: 'Standard peat-based houseplant soil' },
    aroid_mix: { label: 'Aroid mix', description: 'Chunky bark, perlite and coco, free-draining' },
    leca: { label: 'LECA', description: 'Clay balls with a water reservoir' },
    pon: { label: 'Pon', description: 'Pumice, zeolite and lava with slow-release feed' },
    sphagnum: { label: 'Sphagnum moss', description: 'Long-fibre moss, holds a lot of water' },
    bark: { label: 'Orchid bark', description: 'Coarse bark, very airy, dries quickly' },
    perlite_mix: { label: 'Perlite heavy', description: 'Mostly perlite, near-hydroponic' },
    water: { label: 'Water', description: 'Rooting or growing in plain water' },
  },
  carePlan: {
    fallbackTitle: 'Care',
    /* "Alocasia in LECA" promises the text was written for that combination,
     * so a half-known version must not be built - it would claim a specificity
     * the advice does not have. */
    title: (genus: string, medium: string) => `${genus} in ${medium}`,
    noteSpecific: 'Written for this plant in this growing medium.',
    noteFallback: 'From the diagnosis, which did not know what it is potted in.',
    light: 'Light',
    humidity: 'Humidity',
    soil: 'Soil',
    water: 'Water',
    rowA11y: (label: string, text: string) => `${label}: ${text}`,
    warnA11y: (warning: string) => `Watch out: ${warning}`,
  },
  soilCard: {
    title: 'Growing medium',
    empty: 'Pick what this plant is growing in.',
    optionA11y: (label: string, description: string) => `${label}. ${description}`,
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
