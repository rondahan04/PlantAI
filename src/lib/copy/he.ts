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
