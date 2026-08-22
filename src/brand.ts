/*
 * The app mark, in the two forms the UI needs.
 *
 * One module rather than a `require` at each call site so the in-app logo and
 * the launcher icon can never drift apart: `icon.png` is the exact file
 * `app.json` ships as the iOS/Android app icon, so the badge in the header is
 * literally the icon on the user's home screen.
 *
 * `LOGO_GLYPH` is the Android monochrome layer - the same leaf as alpha on a
 * transparent canvas - reused here because a tintable silhouette is what a
 * placeholder needs. A full-colour logo behind a photo slot competes with the
 * photo; the glyph recedes at whatever `tintColor` the caller passes. It is
 * drawn with the adaptive-icon safe zone around it, so render it larger than
 * the icon it replaces or the mark itself comes out small.
 */
export const APP_LOGO = require('../assets/icon.png');
export const LOGO_GLYPH = require('../assets/android-icon-monochrome.png');
