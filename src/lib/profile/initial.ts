/*
 * The letter shown in the avatar circle when there is no picture.
 *
 * Its own module, and pure, for the same reason every other decision in this
 * app is: it is drawn on three screens and on every launch before a photograph
 * exists, and the ways it can render a broken glyph are worth a test that does
 * not need an Expo runtime to run.
 */

/*
 * The first letter of the name, uppercased, or null when there is nothing to
 * show - in which case the circle falls back to a person glyph.
 *
 * `Array.from` rather than `name[0]`: an emoji or any astral character is two
 * UTF-16 units, and slicing one in half renders as a replacement box, which is
 * the one outcome worse than showing no initial at all. The app also ships in
 * Hebrew, where the first character of a name is just as much its initial.
 */
export function initialOf(name: string | null | undefined): string | null {
  if (typeof name !== 'string') return null;
  const trimmed = name.trim();
  if (trimmed.length === 0) return null;
  return Array.from(trimmed)[0].toUpperCase();
}
