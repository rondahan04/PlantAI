/*
 * Remove the `aps-environment` entitlement that expo-notifications adds.
 *
 * WHY. `expo-notifications` writes `aps-environment: development` into the
 * entitlements unconditionally (node_modules/expo-notifications/plugin/build/
 * withNotificationsIOS.js) - it cannot tell a project that schedules local
 * reminders from one that receives server-sent pushes. This app is the former,
 * and a personal Apple team cannot sign the latter:
 *
 *     Cannot create a iOS App Development provisioning profile for
 *     "com.rondahan.PlantAI". Personal development teams, including
 *     "Ron Dahan", do not support the Push Notifications capability.
 *
 * So a clean `expo prebuild` produced a project that would not build at all.
 * It was unblocked by hand-emptying ios/PlantAI/PlantAI.entitlements, but that
 * file is generated AND gitignored, so the next clean prebuild put the
 * entitlement straight back - and a fresh clone hit it on the first try. The
 * fix has to live in the config, which is what this is.
 *
 * SAFE BECAUSE THE APP HAS NO REMOTE PUSH. Every notification it sends is
 * scheduled locally in src/services/wateringReminder.ts via
 * `Notifications.scheduleNotificationAsync`, which needs no entitlement.
 * Verified across src/ and server/: zero uses of `getExpoPushToken`,
 * `getDevicePushToken` or `addPushTokenListener`. Watering, repot and
 * fertilizer reminders are unaffected.
 *
 * ORDERING - THE PART THAT IS EASY TO GET BACKWARDS. This must be registered
 * BEFORE expo-notifications in the app.json plugins array, because mods run in
 * REVERSE registration order: the last plugin registered is the first to run.
 * Registered after expo-notifications, this deletes a key that has not been
 * written yet, silently does nothing, and the build fails exactly as before.
 * That failure is invisible in the plugins list, so if `aps-environment` ever
 * comes back, check the order here first:
 *
 *     npx expo config --type introspect | grep -A2 'entitlements:'
 *
 * should print an empty `entitlements: {}`.
 *
 * REVERSING THIS. If PlantAI ever wants remote push - a server telling a phone
 * something, rather than a reminder the phone set for itself - delete this
 * plugin and its app.json entry. That also needs a paid Apple Developer
 * Program membership, at which point the entitlement is legitimate.
 */
const { withEntitlementsPlist } = require('expo/config-plugins');

module.exports = function withNoPushEntitlement(config) {
  return withEntitlementsPlist(config, (c) => {
    delete c.modResults['aps-environment'];
    return c;
  });
};
