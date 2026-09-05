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
  /*
   * Injected into the pure schedule/stock modules, which decide WHAT is true
   * and leave the words to the caller. English here mirrors each module's own
   * default; the copy test asserts they have not drifted apart.
   */
  watering: {
    everyNDays: (min: number) => `Every ${min} days`,
    everyRange: (min: number, max: number) => `Every ${min}-${max} days`,
    everyDay: 'Every day',
    tapToStart: (interval: string) => `${interval} · tap to start`,
    overdue: (days: number) => `${days} ${days === 1 ? 'day' : 'days'} overdue`,
    dueNowRange: 'Due now - check the soil',
    dueToday: 'Due today',
    nextTomorrow: 'Next water tomorrow',
    nextInDays: (days: number) => `Next water in ${days} ${days === 1 ? 'day' : 'days'}`,
  },
  care: {
    tapToStart: (interval: string) => `Every ${interval} · tap to start`,
    dueNowRepot: 'Due now - check the roots',
    dueNow: 'Due now',
    nextTomorrow: (kind: 'repot' | 'fertilizer') =>
      `Next ${kind === 'repot' ? 'repot' : 'feed'} tomorrow`,
    nextInDays: (kind: 'repot' | 'fertilizer', days: number) =>
      `Next ${kind === 'repot' ? 'repot' : 'feed'} in ${days} days`,
    months: (n: number) => (n === 1 ? 'month' : `${n} months`),
    weeks: (n: number) => (n === 1 ? 'week' : `${n} weeks`),
    days: (n: number) => (n === 1 ? 'day' : `${n} days`),
  },
  availability: {
    likely: 'Likely has it',
    maybe: 'Might have it',
    unlikely: 'Probably not',
    inStock: (shipsToHome: boolean) =>
      `In stock now · ${shipsToHome ? 'ships to home' : 'local pickup'}`,
    notFound: "Didn't find the product",
    estimate: (bandLabel: string, confidence: number) => `${bandLabel} · ${confidence}%`,
    /* We found the product and its price; the page never stated stock. Says
     * what we know first - "Listed" is the evidence - and is honest about the
     * half we do not. */
    stockUnknown: 'Listed · stock not stated',
    unknown: 'Availability unknown',
    unknownCallToConfirm: 'Availability unknown - call to confirm',
  },
  freshness: {
    justNow: 'Stock checked just now',
    minutesAgo: (minutes: number) => `Stock checked ${minutes} min ago`,
    hoursAgo: (hours: number) => `Stock checked ${hours} ${hours === 1 ? 'hour' : 'hours'} ago`,
    yesterday: 'Stock checked yesterday',
    daysAgo: (days: number) => `Stock checked ${days} days ago`,
  },
  triage: {
    attention: 'Needs attention',
    watching: 'Watching',
    healthy: 'Healthy',
  },
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
  auth: {
    back: 'Back',
    email: 'Email',
    password: 'Password',
    loginTitle: 'Log in',
    loginSubtitle: 'Access your profile and settings.',
    loginCta: 'Log In',
    loginA11y: 'Log in',
    forgotPassword: 'Forgot password?',
    signupLink: 'Sign up',
    loginLink: 'Log in',
    wrongCredentials: 'Incorrect email or password.',
    generic: 'Something went wrong. Please try again.',
    signupTitle: 'Create account',
    signupSubtitle: 'Optional - diagnosis works fine without one.',
    signupCta: 'Create Account',
    signupA11y: 'Create account',
    fullName: 'Full name',
    username: 'Username',
    usernameTaken: 'That username is taken.',
    emailTaken: 'An account with that email already exists.',
    signupFailed: 'Could not create your account.',
    resetTitle: 'Reset password',
    resetCta: 'Send Reset Link',
    resetA11y: 'Send reset link',
    newPassword: 'New password',
    currentPassword: 'Current password',
    setPasswordTitle: 'Set new password',
    setPasswordSubtitle: 'Choose a new password for your account.',
    setPasswordCta: 'Set Password',
    setPasswordA11y: 'Set new password',
    passwordUpdated: 'Your password has been updated.',
    goToLogin: 'Log In',
    goToLoginA11y: 'Go to login',
    linkExpired: 'That reset link has expired or was already used. Request a new one.',
    changePasswordTitle: 'Change password',
    changePasswordCta: 'Update Password',
    changePasswordA11y: 'Update password',
    currentPasswordWrong: 'Current password is incorrect.',
  },
  settings: {
    title: 'Settings',
    back: 'Back',
    loginPrompt: 'Log In / Sign Up',
    loginPromptA11y: 'Log in or sign up',
    loggedOutBlurb:
      'Create an account to save your profile and manage your details. Diagnosis works fine without one.',
    deviceSection: 'This device',
    profileSettings: 'Profile settings',
    fullName: 'Full name',
    username: 'Username',
    emailAddress: 'Email address',
    bio: 'Bio',
    notifications: 'Notifications',
    manageAccount: 'Manage account',
    save: 'Save',
    saveFailed: 'Could not save. Please try again.',
    usernameTaken: 'That username is taken.',
    changePassword: 'Change password',
    logOut: 'Log out',
    deleteAccount: 'Delete account',
    deleting: 'Deleting…',
    deleteTitle: 'Delete account?',
    /* Every consequence named, because there is no undo to fall back on. */
    deleteBody:
      'This permanently deletes your account and every plant on this device, including any saved before you signed in. There is no grace period and no undo.',
    deleteFailedTitle: 'Delete failed',
    deleteFailedBody: 'Something went wrong deleting your account. Try again.',
    cancel: 'Cancel',
    pushNotifications: 'Push notifications',
    wateringReminder: 'Watering reminder',
    pushOffNote:
      'Push notifications are off at the system level. Turn them on in iOS Settings to get watering reminders.',
  },
  onboarding: {
    skip: 'Skip',
    skipA11y: 'Skip onboarding and go to the app',
    namePrompt: 'Hello,\nwhat should we call you?',
    namePlaceholder: 'Your name',
    nameA11y: 'Your name, optional',
    continue: 'Continue',
    notNow: 'Not now',
    notNowNameA11y: 'Continue without giving a name',
    next: 'Next',
    getStarted: 'Get Started',
    cameraTitle: (name: string) => (name ? `One thing, ${name}` : 'One last thing'),
    cameraBlurb:
      'A diagnosis starts with a photo of your plant, so PlantAI needs the camera. Photos are used for the diagnosis and stay with the plant in your library.',
    allowCamera: 'Allow camera',
    waiting: 'Waiting…',
    notNowCameraA11y: 'Continue without camera access for now',
  },
  addPlant: {
    close: 'Close',
    title: 'Add a plant',
    photo: 'Photo',
    photoHint: 'Optional. You can add one later.',
    removePhoto: 'Remove photo',
    camera: 'Camera',
    library: 'Library',
    takePhoto: 'Take a photo',
    takeDifferent: 'Take a different photo',
    choosePhoto: 'Choose a photo from your library',
    chooseDifferent: 'Choose a different photo',
    photoDenied:
      'PlantAI cannot open your photos yet. Allow photo access in Settings, or add the plant without a picture and attach one later.',
    cameraDenied:
      'PlantAI cannot use the camera yet. Allow camera access in Settings, or pick a photo you already took.',
    species: 'Species',
    chooseSpecies: 'Choose a species',
    speciesChosenA11y: (name: string, scientific: string) =>
      `Species, ${name}, ${scientific}. Change species`,
    nickname: 'Nickname',
    nicknameHint: 'Optional. Useful when you own three of the same species.',
    nicknamePlaceholder: 'Big Bertha',
    nicknameA11y: 'Plant nickname',
    save: 'Add plant',
    /* Said out loud rather than left as a greyed button the user has to reason
     * about. */
    saveHint: 'Choose a species first',
    saveFailedTitle: "Couldn't save",
    saveFailedNetwork: "We couldn't reach your account. Check your connection and try again.",
    saveFailedStorage: 'Your device is out of storage space. Free some space and try again.',
  },
  editPlant: {
    close: 'Close',
    title: 'Edit plant',
    /* The plant's own name under the title, so the sheet is unambiguous when it
     * is reached from a list of twelve. */
    subtitle: (name: string) => `Editing ${name}`,
    photo: 'Photo',
    photoHint: 'Replace the picture, or leave it as it is.',
    camera: 'Camera',
    library: 'Library',
    takePhoto: 'Take a new photo',
    choosePhoto: 'Choose a photo from your library',
    noPhotoYet: 'No photo yet',
    photoDenied:
      'PlantAI cannot open your photos yet. Allow photo access in Settings, or keep the current picture.',
    cameraDenied:
      'PlantAI cannot use the camera yet. Allow camera access in Settings, or pick a photo you already took.',
    nickname: 'Nickname',
    nicknameHint: 'Leave it empty to go back to the species name.',
    nicknamePlaceholder: 'Big Bertha',
    nicknameA11y: 'Plant nickname',
    save: 'Save changes',
    saving: 'Saving...',
    /* Said out loud rather than shown as a greyed button with no explanation. */
    saveHintUnchanged: 'Nothing to save yet',
    saveFailedTitle: "Couldn't save",
    saveFailedNetwork: "We couldn't reach your account. Check your connection and try again.",
    saveFailedStorage: 'Your device is out of storage space. Free some space and try again.',
    saveFailedMissing: 'That plant is no longer in your library.',
    editA11y: (name: string) => `Edit ${name}`,
  },
  bulkCare: {
    diagnoseAll: 'Diagnose all',
    waterAll: 'Water all',
    /* Said before anything is spent, because both buttons act on many plants
     * at once and the count is the thing the user is agreeing to. */
    diagnoseConfirmTitle: 'Diagnose all plants?',
    diagnoseConfirmBody: (n: number, skipped: number) =>
      skipped === 0
        ? `This checks ${n} ${n === 1 ? 'plant' : 'plants'} that have never been diagnosed. It runs in the background and takes about a minute per five plants.`
        : `This checks ${n} ${n === 1 ? 'plant' : 'plants'} that have never been diagnosed. ${skipped} more ${skipped === 1 ? 'has' : 'have'} no photo, so ${skipped === 1 ? 'it' : 'they'} cannot be checked. It runs in the background and takes about a minute per five plants.`,
    diagnoseNothingTitle: 'Nothing to diagnose',
    diagnoseNothingBody: 'Every plant with a photo has already been checked.',
    diagnoseNoPhotos: (n: number) =>
      `${n} ${n === 1 ? 'plant has' : 'plants have'} no photo yet, so there is nothing to send. Add a photo from the plant's edit screen.`,
    diagnoseRunning: (done: number, total: number) => `Diagnosing ${done} of ${total}`,
    diagnoseDone: (done: number) => `Diagnosed ${done} ${done === 1 ? 'plant' : 'plants'}`,
    diagnoseDoneWithFailures: (done: number, failed: number) =>
      `Diagnosed ${done}, ${failed} could not be checked`,
    diagnoseDoneSkipped: (skipped: number) =>
      `${skipped} skipped, no photo`,
    cancel: 'Stop',
    dismiss: 'Dismiss',
    /* Water-all names the plants it will NOT touch, because the surprise is
     * always that it did less than "all". */
    waterConfirmTitle: 'Water the plants that need it?',
    waterConfirmBody: (n: number, total: number) =>
      n === total
        ? `This marks all ${n} ${n === 1 ? 'plant' : 'plants'} as watered now.`
        : `${n} of your ${total} plants are due or overdue. Only those are marked, so the rest keep their real schedule.`,
    waterNothingTitle: 'Nothing is due',
    waterNothingBody: 'No plant needs watering today. Marking one early would reset its schedule and record water it did not get.',
    waterDone: (n: number) => `Watered ${n} ${n === 1 ? 'plant' : 'plants'}`,
    waterFailed: 'Some plants could not be updated. Check your connection and try again.',
    confirm: 'Do it',
    cancelAction: 'Cancel',
    a11yDiagnoseAll: 'Diagnose all undiagnosed plants',
    a11yWaterAll: 'Water all plants that are due',
  },
  speciesPicker: {
    title: 'Choose a species',
    close: 'Close species picker',
    placeholder: 'Monstera, Thai Constellation, hoya',
    searchA11y: 'Search species',
    clear: 'Clear search',
    rowA11y: (name: string, scientific: string) => `${name}, ${scientific}`,
    emptyTitle: (query: string) => `No species match "${query}"`,
    emptyBody:
      'Try just the genus - "alocasia", "hoya", "monstera" - or a shorter spelling, then browse the list.',
  },
  plantSearch: {
    title: 'Find a plant',
    subtitle: 'Search nurseries near you for a plant you want to buy, and compare prices.',
    placeholder: 'Alocasia Regal Shield',
    inputA11y: 'Plant to search for',
    clear: 'Clear search',
    deliver: 'Deliver',
    pickUp: 'Pick Up',
    submit: 'Search nurseries',
    fromYourPlants: 'From your plants',
    suggestionA11y: (name: string) => `Search nurseries for ${name}`,
    /* Sets expectations rather than letting a 90s wait look like a hang. */
    note: "Searching reads each nursery's site live, so it can take a minute.",
  },
  statusView: {
    a11y: (title: string, body: string) => `${title}. ${body}`,
  },
  nurseries: {
    unreachableTitle: "We couldn't reach the nursery service",
    unreachableBody:
      'The search did not come back. Nothing is wrong with your plant or your location.',
    timeoutTitle: 'The search took too long',
    timeoutBody:
      'Checking live stock across nearby nurseries can run past our limit. Trying again often works.',
    back: 'Back',
    countNearby: (n: number) => `${n} ${n === 1 ? 'nursery' : 'nurseries'} nearby`,
    searching: 'Searching…',
    searchFailed: 'Search failed',
    showMap: 'Show map',
    showList: 'Show list',
    refresh: 'Refresh',
    refreshA11y: 'Check stock again now',
    deliverToday: 'Deliver Today',
    pickUp: 'Pick Up',
    searchingTitle: 'Searching nearby nurseries',
    searchingBody: (plantName: string) =>
      `Discovering shops within 10km and checking live stock for ${plantName}. This can take 30–60 seconds.`,
    tryAgain: 'Try again',
    backToHome: 'Back to home',
    emptyTitle: 'No nurseries found nearby',
    emptyBody: (plantName: string) =>
      `No shop within 10km came back with ${plantName} in stock. Stock changes often, so it is worth another look later.`,
    searchAgain: 'Search again',
    diagnoseAnother: 'Diagnose another plant',
    diagnoseAnotherCta: 'Diagnose Another Plant',
    reviews: (n: number) => `(${n} reviews)`,
    inStock: 'In stock',
    /* A price we did not trust reads as "See price" rather than a number: the
     * shop does stock the plant, we just would not stand behind the figure. */
    seePrice: 'See price',
    call: 'Call',
    callA11y: 'Call nursery',
    directions: 'Directions',
    order: 'Order',
    unavailable: 'Unavailable',
    visitStore: 'Visit Store',
    noContact: 'No website or phone number available for this nursery.',
    pillA11y: (text: string, detail: string) => `${text}. ${detail}`,
    pillHint: 'Shows why',
    mapCallout: (distance: string, price: string) => `${distance}${price ? ` · ${price} · in stock` : ''}`,
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
    /* Names the size AND the limit: "too large" alone invites the same photo
     * again. The action is concrete - the camera's own capture is compressed
     * and always fits, so it is the fix, not a workaround. */
    tooLargeTitle: 'That photo is too large to send',
    tooLargeBody: (size: string, limit: string) =>
      `That image is ${size} and the limit is ${limit}. Take the photo with the camera instead - those are compressed and always fit.`,
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
    filterNeedsCare: 'Needs care',
    filterDiagnosed: 'Diagnosed',
    /* The count rides inside the chip - "All (12)" - so a user can see the size
     * of each slice before spending a tap finding out. */
    filterCount: (label: string, n: number): string => `${label} (${n})`,
    filterAllA11y: 'Show all plants',
    filterNeedsCareA11y: 'Show only plants that are due or overdue for care',
    filterDiagnosedA11y: 'Show only plants you have diagnosed',
    dueThisWeek: 'Due this week',
    dueMore: (n: number) => `+${n} more in your plants below`,
    /*
     * A filter matching nothing is not an empty library, and the copy has to
     * say so - otherwise the Diagnosed chip on a hand-built portfolio reads as
     * data loss.
     */
    noneNeedCare: 'Nothing is due right now. Every plant is on schedule.',
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
  schedule: {
    today: 'Today',
    tomorrow: 'Tomorrow',
    overdue: 'Overdue',
    inDays: (days: number): string => `In ${days} days`,
    every: (interval: string): string => `Every ${interval}`,
    none: 'Not set',
  },
  tabs: {
    home: 'Home',
    portfolio: 'Portfolio',
    scan: 'Scan',
    find: 'Find',
  },
  home: {
    /*
     * The greeting is split from the name so Hebrew can put them in its own
     * order - and so a user who skipped onboarding gets a clean "Good morning"
     * with no trailing comma left dangling where a name should be.
     */
    greeting: {
      morning: 'Good morning',
      afternoon: 'Good afternoon',
      evening: 'Good evening',
    },
    greetingWithName: (greeting: string, name: string) => `${greeting}, ${name}`,
    heroEyebrow: 'Your garden at a glance',
    heroTitle: 'Keep your plants\nthriving today.',
    heroEmptyTitle: 'Start your garden\nwith one photo.',
    heroCta: 'Diagnose a plant',
    plantCount: (n: number): string => (n === 1 ? '1 plant' : `${n} plants`),
    tasksTitle: 'Upcoming tasks',
    tasksSeeAll: 'See all',
    tasksEmpty: 'Nothing due this week. Your plants are set.',
    taskOthers: (n: number): string => (n === 1 ? '+ 1 other' : `+ ${n} others`),
    taskKind: {
      water: 'Water plants',
      fertilizer: 'Fertilize',
      repot: 'Repot',
    },
    plantsTitle: 'My plants',
    plantsSeeAll: 'View portfolio',
    needsCare: (n: number): string => (n === 1 ? 'needs a little care' : 'need a little care'),
    allHealthy: 'all doing well',
    emptyStrip: 'No plants yet. Diagnose one to get started.',
    a11yHero: 'Diagnose a plant with the camera',
    a11yTask: (kind: string, plants: string, when: string) => `${kind}, ${plants}, ${when}`,
  },
  relativeDay: {
    /*
     * Compact by necessity - this sits under a plant name on a card, so it has
     * roughly six characters. Hebrew abbreviates differently: 'ד' for days,
     * 'ש' for weeks, 'ש' for years would collide, so weeks and years are
     * spelled out rather than initialised.
     */
    today: 'today',
    yesterday: 'yesterday',
    daysAgo: (n: number) => `${n}d ago`,
    weeksAgo: (n: number) => `${n}w ago`,
    yearsAgo: (n: number) => `${n}y ago`,
  },
  plantCard: {
    needsWatering: 'Needs watering',
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
