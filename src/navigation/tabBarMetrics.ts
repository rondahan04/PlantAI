/*
 * The tab bar's size, in one place.
 *
 * Its own module rather than an export from Tabs.tsx because Tabs.tsx imports
 * the tab screens - anything of theirs that reads a number from it would close
 * an import cycle.
 *
 * WHY THERE IS NO LONGER A `TAB_BAR_CLEARANCE`. The bar used to be a detached
 * pill floating over the content, which meant every scrolling tab had to end
 * its content above the bar by hand or the last row was unreachable. It is now
 * anchored to the bottom edge and laid out as a sibling of the scene, so the
 * navigator reserves its space and the screens do not pad for it at all. A
 * leftover clearance would now be a second bar's worth of dead space under the
 * last card.
 */

/*
 * The bar's own height, ABOVE the home-indicator inset. The inset is added on
 * top of this at render, so the touchable row is this tall on every device
 * rather than being squeezed by the hardware.
 */
export const TAB_BAR_HEIGHT = 66;
