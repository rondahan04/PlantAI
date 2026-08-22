/*
 * E5: the WhatsApp handoff.
 *
 * Israeli nurseries answer WhatsApp, not web forms - `onOrder` opening a
 * website and otherwise dead-ending in an alert was leaving the transact half
 * of the thesis on the floor for every nursery scraped without a site.
 *
 * `nursery.phone` comes from Google Places' `nationalPhoneNumber` (E5 uses
 * `scraper/places.ts`), which is a local Israeli format like "050-123 4567" -
 * `wa.me` needs the full international digit string with no separators and no
 * leading 0, so every number is normalized before it becomes a link.
 */

const MIN_PHONE_DIGITS = 8;
const IL_COUNTRY_CODE = '972';

/** null when the input has too few digits to plausibly be a phone number. */
export function toWhatsAppNumber(phone: string): string | null {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < MIN_PHONE_DIGITS) return null;

  if (digits.startsWith(IL_COUNTRY_CODE)) return digits;
  if (digits.startsWith('0')) return `${IL_COUNTRY_CODE}${digits.slice(1)}`;
  return `${IL_COUNTRY_CODE}${digits}`;
}

export function waMeLink(phone: string, message: string): string | null {
  const number = toWhatsAppNumber(phone);
  if (!number) return null;
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}
