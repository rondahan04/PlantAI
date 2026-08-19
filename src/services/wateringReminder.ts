import * as Notifications from 'expo-notifications';

/*
 * OS-level watering reminders.
 *
 * The in-app schedule in `lib/watering.ts` is the source of truth; this is a
 * nudge on top of it. That ordering is the whole design: the user may decline
 * the permission prompt, the OS may drop a scheduled notification, and Expo Go
 * limits what can be scheduled at all — in every one of those cases the plant
 * detail screen still says "3 days overdue" when they open it. Nothing here is
 * allowed to fail loudly, because none of it is load-bearing.
 *
 * Local notifications only. No push token, no server, nothing leaves the phone.
 */

/*
 * How a reminder behaves when it fires while the app is open. Banner and list,
 * no sound: a watering reminder is not urgent enough to interrupt, and a plant
 * app that pings is a plant app that gets its notifications turned off.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

/*
 * Ask once, and only when the user has actually opted in by logging a watering.
 *
 * `getPermissionsAsync` first so a previous "no" is not re-prompted on every
 * tap — iOS only ever shows the system dialog once anyway, and re-asking a user
 * who declined just burns a call and returns the same answer.
 */
export async function ensureNotificationPermission(): Promise<boolean> {
  try {
    const existing = await Notifications.getPermissionsAsync();
    if (existing.granted) return true;
    if (!existing.canAskAgain) return false;

    const requested = await Notifications.requestPermissionsAsync();
    return requested.granted;
  } catch {
    // The module is unavailable in this runtime (an Expo Go limitation, a web
    // build). The in-app schedule covers it.
    return false;
  }
}

/*
 * Schedule one reminder for a due date. Returns the OS identifier to store, or
 * null if nothing was scheduled — no permission, a past due date, or a runtime
 * that cannot schedule. Null is a normal outcome, not an error.
 */
export async function scheduleWateringReminder(args: {
  plantName: string;
  dueAt: number;
  now?: number;
}): Promise<string | null> {
  const now = args.now ?? Date.now();
  // A notification for a date that has passed either fires instantly or is
  // rejected outright, depending on the platform. Neither is a reminder.
  if (args.dueAt <= now) return null;

  if (!(await ensureNotificationPermission())) return null;

  try {
    return await Notifications.scheduleNotificationAsync({
      content: {
        title: `Time to water ${args.plantName}`,
        // The care plan's own instruction, not a command: the interval is an
        // estimate and the soil is the actual test.
        body: 'Check the soil — if the top is dry, give it a drink.',
        data: { kind: 'watering' },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: new Date(args.dueAt),
      },
    });
  } catch {
    return null;
  }
}

/* Cancel a previously scheduled reminder. Safe to call with a stale id. */
export async function cancelWateringReminder(id: string | undefined): Promise<void> {
  if (!id) return;
  try {
    await Notifications.cancelScheduledNotificationAsync(id);
  } catch {
    /* Already fired, already cancelled, or the OS forgot it. Nothing to do. */
  }
}
