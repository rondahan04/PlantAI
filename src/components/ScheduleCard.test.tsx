/**
 * The first component test in the project, and it exists to prove the seam
 * works on something that actually needed it.
 *
 * When the repot card was taught to collapse (Trello #78) the rule could only
 * be tested from the state-machine side - "an overdue repot is not `ok`" - and
 * the part that matters to a user, that the button is still on screen, was
 * verified by eye. That is the gap this stack closes: these assert what is
 * RENDERED, which is the half `node --test` structurally cannot reach.
 *
 * TWO RUNNERS, SPLIT BY EXTENSION. `node --test` owns *.test.ts (pure logic,
 * no transform, 720 of them) and provably does not discover *.test.tsx. Jest
 * owns *.test.tsx and nothing else, via `testMatch` in package.json. Run them
 * with `npm test` and `npm run test:components`, or both with `npm run
 * test:all`.
 *
 * Globals are IMPORTED rather than ambient, and @types/jest is deliberately not
 * installed: its ambient `test`/`expect` would bleed into the 720 files that
 * import those names from `node:test`, and the two mean different things. This
 * mirrors how those files declare their own runner.
 *
 * RNTL 14 NOTE: `render` is async and must be awaited. v13 tutorials showing a
 * synchronous `render()` are wrong for this version, and the failure is a
 * confusing one - queries run against an empty tree.
 */
import { describe, it, expect } from '@jest/globals';
import React from 'react';
import { render, screen } from '@testing-library/react-native';
import ScheduleCard from './ScheduleCard';
import { copy } from '../services/language';
import { REPOT_EVERY_DAYS } from '../lib/care';
import { DAY_MS } from '../lib/watering';

const daysAgo = (n: number) => new Date(Date.now() - n * DAY_MS).toISOString();

/* Only the interval matters to these cases; the prose satisfies CarePlan. */
const plan = { soil: '', light: '', water: '', waterEveryDays: 7 };

const repot = (lastAt: string | undefined, collapsible = true) => (
  <ScheduleCard
    kind="repot"
    carePlan={plan}
    soilPlan={undefined}
    lastAt={lastAt}
    collapsible={collapsible}
    onLog={() => {}}
    onHistory={() => {}}
  />
);

describe('ScheduleCard, collapsed repot row', () => {
  it('collapses to a row with no action button once the repot is settled', async () => {
    await render(repot(daysAgo(30)));

    // The row still names the schedule, so the plant screen does not simply
    // lose a third of its content.
    expect(screen.getByText(new RegExp(copy.scheduleCard.repot.title))).toBeTruthy();

    // The point of collapsing: no action, no history link, no interval line.
    expect(screen.queryByText(copy.scheduleCard.repot.done)).toBeNull();
    expect(screen.queryByText(copy.scheduleCard.repot.action)).toBeNull();
    expect(screen.queryByText(copy.scheduleCard.history)).toBeNull();
  });

  it('stays a full card with its button when the repot is overdue', async () => {
    // THE CASE THAT MATTERS. A collapsed row here would hide a repot the user
    // needed to see, which is the one failure this feature must never have.
    await render(repot(daysAgo(REPOT_EVERY_DAYS + 21)));

    expect(screen.getByText(copy.scheduleCard.repot.action)).toBeTruthy();
    expect(screen.getByText(copy.scheduleCard.history)).toBeTruthy();
  });

  it('stays a full card when the plant has never been repotted', async () => {
    // The tap that STARTS the schedule has to be reachable, and a collapsed
    // row carries no button at all.
    await render(repot(undefined));

    expect(screen.getByText(copy.scheduleCard.repot.start)).toBeTruthy();
  });

  it('never collapses a kind the screen did not permit to', async () => {
    // Watering is settled here too, so only `collapsible` separates this from
    // the first case. Feeding and watering must keep their cards whatever
    // their state.
    await render(
      <ScheduleCard
        kind="water"
        carePlan={plan}
        soilPlan={undefined}
        lastAt={daysAgo(1)}
        onLog={() => {}}
        onHistory={() => {}}
      />
    );

    expect(screen.getByText(copy.scheduleCard.water.done)).toBeTruthy();
  });
});

describe('ScheduleCard, the reminder confirmation', () => {
  it('shows the note it was given, under the footer', async () => {
    // Trello #77. The note is the only proof the OS reminder exists.
    await render(
      <ScheduleCard
        kind="water"
        carePlan={plan}
        soilPlan={undefined}
        lastAt={daysAgo(1)}
        note={copy.scheduleCard.reminderSet}
        onLog={() => {}}
        onHistory={() => {}}
      />
    );

    expect(screen.getByText(copy.scheduleCard.reminderSet)).toBeTruthy();
  });

  it('says nothing when there is no reminder', async () => {
    // An absent nudge is not news: the in-app countdown is unaffected, so a
    // line explaining the absence would read as an error.
    await render(
      <ScheduleCard
        kind="water"
        carePlan={plan}
        soilPlan={undefined}
        lastAt={daysAgo(1)}
        onLog={() => {}}
        onHistory={() => {}}
      />
    );

    expect(screen.queryByText(copy.scheduleCard.reminderSet)).toBeNull();
  });
});
