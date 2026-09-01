import type { Copy } from './en';

/*
 * The Hebrew tree.
 *
 * Declared as `Copy`, which is what turns drift into a compile error rather
 * than a string that silently stays English on someone's screen. See the note
 * at the top of en.ts.
 *
 * On number agreement: Hebrew does not say "1 plants", and in the singular it
 * usually drops the numeral altogether - "the saved plant", not "your 1 saved
 * plant". That is why these are functions rather than templates with a
 * placeholder; the rule is written as an ordinary conditional in the language
 * it applies to.
 */
export const he: Copy = {
  language: {
    title: 'שפה',
    english: 'English',
    hebrew: 'עברית',
    relaunchNotice: 'השפה שונתה. סגרו ופתחו מחדש את PlantAI כדי להשלים את השינוי.',
    ok: 'אישור',
    back: 'חזרה',
  },
  identity: {
    speciesMatch: (percent: number) => `${percent}% התאמה למין`,
    genusMatch: (percent: number) => `${percent}% התאמה לסוג`,
    probably: 'ככל הנראה',
    possibly: 'ייתכן שזה',
    genusLedTitle: 'אנחנו יודעים מהי הקבוצה, אבל לא את המין המדויק',
    genusLedBody: (p: { genus: string; genusPercent: number; plantName: string; percent: number }) =>
      `זהו ${p.genus} (${p.genusPercent}% התאמה). איננו יכולים לקבוע איזה מין בדיוק - ${p.plantName} הוא הקרוב ביותר עם ${p.percent}%. הטיפול המתאים לקבוצה אמין; מה שספציפי למין עשוי שלא להתאים.`,
    moderateTitle: 'איננו בטוחים במין',
    moderateBody: (plantName: string) =>
      `זה נראה כמו ${plantName}, אבל ההתאמה אינה ודאית. ההמלצות שלמטה מניחות שהזיהוי נכון.`,
    lowTitle: 'לא הצלחנו לזהות את הצמח',
    lowBody: (plantName: string) =>
      `${plantName} הוא הניחוש הטוב ביותר שלנו, והוא חלש. התייחסו להמלצות שלמטה כנקודת פתיחה, לא כאבחון. תמונה שבה העלים ממלאים את הפריים, באור יום, בדרך כלל מזהה הרבה יותר טוב.`,
  },
  diagnosis: {
    headerTitle: 'אבחון',
    back: 'חזרה',
    backToHomeA11y: 'חזרה למסך הבית',
    saveA11y: 'שמירה לצמחים שלי',
    savedA11y: 'נשמר לצמחים שלי. הקישו כדי להסיר.',
    saveFailedTitle: 'לא הצלחנו לשמור',
    saveFailedNetwork: 'לא הצלחנו להגיע לחשבון שלכם. בדקו את החיבור ונסו שוב.',
    saveFailedStorage: 'אין מספיק מקום פנוי במכשיר. פנו מקום ונסו שוב.',
    closestSpecies: (name: string) => `המין הקרוב ביותר: ${name}`,
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
        parts.species ? `המין הקרוב ביותר ${parts.species}, ${parts.label}.` : `${parts.label}.`,
        parts.caveat ? `${parts.caveat}.` : '',
      ]
        .filter(Boolean)
        .join(' '),
    retakeA11y: 'לא הצמח שלכם? צילום מחדש',
    retake: 'לא הצמח שלכם? לצלם מחדש',
    issues: 'בעיות שזוהו',
    treatments: 'תוכנית טיפול',
    urgent: 'דחוף',
    findProduct: (product: string) => `למצוא ${product} בסביבה`,
    findProductA11y: (product: string) => `למצוא ${product} במשתלות בסביבתכם`,
    replaceOr: 'או להחליף בצמח בריא',
    replaceTitle: 'למצוא תחליף בריא',
    replaceDesc: (name: string) =>
      `הצמח הזה פגוע מכדי להציל. אפשר למצוא ${name} זהה ובריא במשתלות בסביבתכם.`,
    delivered: 'משלוח היום',
    pickup: 'איסוף עצמי',
    findNurseriesA11y: 'חיפוש משתלות',
    findDelivery: 'אפשרויות משלוח',
    findNearby: 'משתלות בסביבה',
    scanAnother: 'סריקת צמח נוסף',
  },
  camera: {
    notAPlantTitle: 'לא מצאנו צמח בתמונה הזו',
    notAPlantBody: 'כוונו את המצלמה לעלים, לגבעולים או לפרחים, מקרוב מספיק כדי למלא את רוב הפריים.',
    unsupportedTitle: 'לא הצלחנו לקרוא את התמונה',
    unsupportedBody:
      'הקובץ הזה בפורמט שאנחנו לא יודעים לפתוח. תמונה שצולמה במצלמה, או JPEG או PNG מהגלריה, תעבוד.',
    unavailableTitle: 'האבחון אינו זמין',
    unavailableBody: 'הגרסה הזו לא מחוברת לשירות זיהוי צמחים. אין שום בעיה בתמונה או בצמח שלכם.',
    failedTitle: 'לא הצלחנו לסיים את האבחון',
    failedBody: 'שירות הצמחים לא ענה. התמונה שלכם בסדר גמור - זו תקלה אצלנו.',
    captureFailedTitle: 'המצלמה לא צילמה את זה',
    captureFailedBody: 'משהו הפריע לצילום. נסו שוב, או בחרו תמונה קיימת מהגלריה.',
    photoPermissionTitle: 'PlantAI צריך גישה לתמונות שלכם',
    photoPermissionBody: 'אשרו גישה לתמונות בהגדרות כדי לבחור תמונה שכבר צילמתם.',
    tryAgain: 'לנסות שוב',
    takeAnother: 'לצלם תמונה אחרת',
    backToHome: 'חזרה למסך הבית',
    permissionTitle: 'נדרשת גישה למצלמה',
    permissionDesc: 'PlantAI צריך את המצלמה שלכם כדי לאבחן בעיות בריאות בצמחים.',
    allowCamera: 'לאשר מצלמה',
    allowCameraA11y: 'אישור גישה למצלמה',
    orGallery: 'או לבחור מהגלריה',
    close: 'סגירה',
    closeCamera: 'סגירת המצלמה',
    scanTitle: 'סריקת צמח',
    flipCamera: 'החלפת מצלמה',
    hint: 'מרכזו את הצמח בפריים',
    gallery: 'גלריה',
    pickFromGallery: 'בחירה מהגלריה',
    takePhoto: 'צילום',
    analyzingTitle: 'מנתחים את הצמח שלכם',
    analyzingDesc: 'אנחנו בוחנים את הסימפטומים,\nמזהים את המין ואת המצב...',
  },
  careHistory: {
    water: {
      short: 'השקיה',
      title: 'היסטוריית השקיה',
      empty: 'עוד לא תועדו השקיות - הקישו על "להשקות עכשיו" במסך הצמח כדי להתחיל.',
      logged: (n: number) => (n === 1 ? 'תועדה השקיה אחת' : `תועדו ${n} השקיות`),
      noneThisMonth: 'לא תועדו השקיות החודש',
    },
    repot: {
      short: 'עציץ',
      title: 'היסטוריית החלפות עציץ',
      empty: 'עוד לא תועדו החלפות עציץ - הקישו על "להחליף עכשיו" במסך הצמח כדי להתחיל.',
      logged: (n: number) => (n === 1 ? 'תועדה החלפה אחת' : `תועדו ${n} החלפות`),
      noneThisMonth: 'לא תועדו החלפות החודש',
    },
    fertilizer: {
      short: 'דישון',
      title: 'היסטוריית דישון',
      empty: 'עוד לא תועדו דישונים - הקישו על "לדשן עכשיו" במסך הצמח כדי להתחיל.',
      logged: (n: number) => (n === 1 ? 'תועד דישון אחד' : `תועדו ${n} דישונים`),
      noneThisMonth: 'לא תועדו דישונים החודש',
    },
    allTitle: 'היסטוריית טיפול',
    allEmpty: 'עוד לא תועד דבר - השקו, החליפו עציץ או דשנו כדי להתחיל.',
    allLogged: (n: number) => (n === 1 ? 'תועד טיפול אחד' : `תועדו ${n} טיפולים`),
    allNoneThisMonth: 'לא תועד דבר החודש',
    daysOfCare: (n: number) => (n === 1 ? 'יום אחד של טיפול החודש' : `${n} ימי טיפול החודש`),
    filterAll: 'הכל',
    missingTitle: 'הצמח הזה כבר לא שמור',
    goBack: 'חזרה',
    unnamed: 'צמח ללא שם',
    prevMonth: 'החודש הקודם',
    nextMonth: 'החודש הבא',
    nextDue: 'הטיפול הבא',
    recent: 'אחרונים',
    dayA11y: (date: string, done: string, due: string) => `${date}${done}${due}`,
    /* No lowercasing - Hebrew has no letter case. */
    doneSuffix: (kind: string) => `, ${kind} בוצע`,
    dueSuffix: (kind: string) => `, ${kind} נדרש`,
  },
  plantDetail: {
    missingTitle: 'הצמח הזה כבר לא שמור',
    backToPlants: 'חזרה לצמחים שלי',
    backLabel: 'הצמחים שלי',
    removeA11y: 'הסרת הצמח',
    undiagnosed: 'עוד לא בדקתם את הצמח הזה.',
    checkIt: 'לבדוק',
    checkA11y: (name: string) => `בדיקת ${name} עם המצלמה`,
    issues: 'בעיות שזוהו',
    treatments: 'תוכנית טיפול',
    urgent: 'דחוף',
    findProduct: (product: string) => `למצוא ${product} בסביבה`,
    findProductA11y: (product: string) => `למצוא ${product} במשתלות בסביבתכם`,
    careSchedule: 'לוח טיפול',
    findAtNursery: 'למצוא את הצמח במשתלה',
    findingNurseries: 'מחפשים משתלות...',
    findAtNurseryA11y: (name: string) => `למצוא משתלות שמוכרות ${name}`,
    replacementTitle: 'למצוא תחליף בריא',
    replacementNote: (name: string) =>
      `הצמח הזה פגוע מכדי להציל. אפשר למצוא ${name} בריא בסביבתכם.`,
    findNearby: 'למצוא משתלות בסביבה',
    findNearbyA11y: (name: string) => `למצוא ${name} במשתלות בסביבתכם`,
    savedOn: (date: string) => `נשמר ב-${date}`,
    removeTitle: 'להסיר את הצמח?',
    removeBody: (name: string) => `${name} יוסר מרשימת הצמחים שלכם.`,
    cancel: 'ביטול',
    remove: 'הסרה',
    failNotFound: 'הצמח הזה כבר לא שמור.',
    failNetwork: 'לא הצלחנו להגיע לחשבון שלכם. בדקו את החיבור ונסו שוב.',
    failStorage: 'אין מספיק מקום פנוי במכשיר, ולכן שום דבר לא נשמר.',
    saveFailedTitle: 'לא הצלחנו לשמור',
    saveFailedStorage: 'אין מספיק מקום פנוי במכשיר, ולכן מצע הגידול לא נשמר.',
    logFailedTitle: 'לא הצלחנו לתעד',
    waterFailedStorage: 'אין מספיק מקום פנוי במכשיר, ולכן ההשקיה לא נשמרה.',
    removeFailedTitle: 'לא הצלחנו להסיר',
    removeFailedStorage: 'אין מספיק מקום פנוי במכשיר.',
  },
  soilMedia: {
    potting_mix: { label: 'תערובת שתילה', description: 'אדמה רגילה לצמחי בית על בסיס כבול' },
    aroid_mix: { label: 'תערובת לארואידים', description: 'קליפות עץ, פרלית וקוקוס, מנקזת היטב' },
    leca: { label: 'לקה', description: 'כדורי חרס עם מאגר מים' },
    pon: { label: 'פון', description: 'פומיס, זאוליט ולבה עם דשן בשחרור איטי' },
    sphagnum: { label: 'ספגנום', description: 'טחב סיבי שמחזיק הרבה מים' },
    bark: { label: 'קליפות לסחלבים', description: 'קליפות גסות, מאווררת מאוד, מתייבשת מהר' },
    perlite_mix: { label: 'עתיר פרלית', description: 'רובה פרלית, כמעט הידרופוני' },
    water: { label: 'מים', description: 'השרשה או גידול במים בלבד' },
  },
  carePlan: {
    fallbackTitle: 'טיפול',
    title: (genus: string, medium: string) => `${genus} ב${medium}`,
    noteSpecific: 'נכתב עבור הצמח הזה במצע הזה.',
    noteFallback: 'מתוך האבחון, שלא ידע במה הצמח שתול.',
    light: 'אור',
    humidity: 'לחות',
    soil: 'מצע',
    water: 'מים',
    rowA11y: (label: string, text: string) => `${label}: ${text}`,
    warnA11y: (warning: string) => `שימו לב: ${warning}`,
  },
  soilCard: {
    title: 'מצע גידול',
    empty: 'בחרו במה הצמח הזה שתול.',
    optionA11y: (label: string, description: string) => `${label}. ${description}`,
  },
  features: {
    scan: {
      title: 'צילום ואבחון',
      desc: 'הבינה המלאכותית מזהה מיד מה מציק לצמח',
      blurb:
        'כוונו את המצלמה לצמח שנראה לא טוב. תוך שניות תדעו מה המין, מה הבעיה ואיך לטפל בה.',
    },
    track: {
      title: 'מעקב והשקיה',
      desc: 'לוח השקיה שמותאם לכל צמח ששמרתם',
      blurb:
        'כל צמח שתשמרו מקבל תוכנית טיפול וקצב השקיה, עם תזכורת כדי שלא תצטרכו לנחש.',
    },
    replace: {
      title: 'מציאת תחליף',
      desc: 'איתור צמחים בריאים במשתלות בסביבתכם',
      blurb:
        'כשאי אפשר להציל צמח, נמצא לכם אחד בריא במשתלה קרובה - במשלוח או לאיסוף עצמי.',
    },
  },
  portfolio: {
    brand: 'PlantAI',
    greetingNamed: (name: string) => `הצמחים של ${name}`,
    helloNamed: (name: string) => `שלום, ${name}`,
    greetingAnonymous: 'דוקטור צמחים',
    settingsA11y: 'הגדרות חשבון',
    title: 'הצמחים שלי',
    filterAll: 'הכל',
    filterDiagnosed: 'אובחנו',
    filterAllA11y: 'הצגת כל הצמחים',
    filterDiagnosedA11y: 'הצגת הצמחים שאובחנו בלבד',
    dueThisWeek: 'לטיפול השבוע',
    dueMore: (n: number) => `ועוד ${n} ברשימה למטה`,
    noneDiagnosed: 'אף אחד מהצמחים שלכם לא אובחן עדיין. סרקו אחד כדי לראות מה הוא צריך.',
    warnFutureTitle: 'נשמר בגרסה חדשה יותר',
    warnFutureText: 'עדכנו את PlantAI כדי לראות שוב את הרשימה. שום דבר לא נמחק.',
    warnUnreadableTitle: 'חלק מהצמחים השמורים לא נקראו',
    warnUnreadableText: 'המידע שלכם הוזז הצידה, לא נמחק. צמחים חדשים נשמרים כרגיל.',
    diagnoseAnother: 'אבחון צמח נוסף',
    diagnoseAnotherA11y: 'אבחון צמח נוסף - פתיחת המצלמה',
    diagnoseMine: 'אבחון הצמח שלי',
    diagnoseMineA11y: 'אבחון הצמח שלי - פתיחת המצלמה',
    addPlant: 'הוספת צמח',
    addPlantA11y: 'הוספת צמח שכבר יש לכם',
    addOwned: 'הוספת צמח שכבר יש לי',
    addOwnedA11y: 'הוספת צמח שכבר יש לכם, בלי תמונה',
    heroTitle: 'הצמח שלכם\nלא מרגיש טוב?',
    heroSub: 'צלמו תמונה. קבלו אבחון תוך שניות.\nונמצא תחליף בריא אם צריך.',
    howItWorks: 'איך זה עובד',
    bottomNote: 'אנחנו מאבחנים מעל 1000 מיני צמחים · מהר ובדיוק',
  },
  plantCard: {
    diagnosedBadge: 'אובחן',
    a11y: (p: {
      name: string;
      secondary: string;
      conditionLabel: string;
      when: string;
      watering: string;
    }) =>
      `${p.name}${p.secondary ? `, ${p.secondary}` : ''}` +
      (p.conditionLabel ? `, אובחן ${p.conditionLabel}` : ', לא אובחן') +
      `, נשמר ${p.when}` +
      (p.watering ? `, השקיה ${p.watering}` : ''),
  },
  scheduleCard: {
    water: {
      title: 'השקיה',
      action: 'להשקות עכשיו',
      start: 'השקיתי היום',
      done: 'הושקה',
    },
    fertilizer: {
      title: 'דישון',
      action: 'לדשן עכשיו',
      start: 'דישנתי היום',
      done: 'דושן',
    },
    repot: {
      title: 'החלפת עציץ',
      action: 'להחליף עכשיו',
      start: 'החלפתי עציץ היום',
      done: 'הוחלף',
    },
    history: 'היסטוריה',
    /* No lowercasing: Hebrew has no letter case, so the English helper would
     * be a no-op here and reads as a copied line rather than a written one. */
    historyA11y: (title: string) => `היסטוריית ${title}`,
    noSchedule: 'אין לוח זמנים עדיין',
    settledA11y: (done: string, label: string) => `${done}. ${label}`,
    actionA11y: (title: string, action: string, label: string) =>
      `${title}: ${action}.${label ? ` ${label}` : ''}`,
    earlyHint: (title: string) => `הקישו הקשה כפולה והחזיקו כדי לתעד ${title} מוקדם`,
  },
  importBanner: {
    title: (n: number) =>
      n === 1 ? 'לייבא את הצמח השמור שלך?' : `לייבא את ${n} הצמחים השמורים שלך?`,
    sub: 'הם ילוו אותך לכל מכשיר שתתחברו ממנו.',
    partial: (ok: number, failed: number) => `${ok} יובאו, ${failed} נכשלו - הקישו לניסיון נוסף.`,
    importAction: 'ייבוא',
    importA11y: 'ייבוא הצמחים השמורים',
    dismissA11y: 'לא עכשיו',
  },
};
