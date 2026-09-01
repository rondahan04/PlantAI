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
