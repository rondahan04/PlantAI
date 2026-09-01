/*
 * The floating tab bar's size, in one place.
 *
 * Its own module rather than an export from Tabs.tsx because the scrolling tab
 * screens need the clearance and Tabs.tsx imports those same screens - reading
 * the constant from there would close an import cycle for a number.
 */

export const TAB_BAR_HEIGHT = 66;
export const TAB_BAR_MARGIN = 16;

/*
 * The bar floats over the content instead of sitting under it, so every
 * scrolling tab has to end its content above the bar or the last row is
 * unreachable. This is that clearance, in points, measured from the bottom
 * safe-area inset.
 */
export const TAB_BAR_CLEARANCE = TAB_BAR_HEIGHT + TAB_BAR_MARGIN * 2;
