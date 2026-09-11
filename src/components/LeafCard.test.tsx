/**
 * The rendered half of new-growth tracking. The rules about what a tap does
 * live in lib/leaves.test.ts; what is asserted here is what the user can see
 * and press - which is precisely what those tests structurally cannot reach.
 *
 * The case that matters most: one row per leaf still opening. A toggle would
 * pass every logic test and still be the wrong feature the moment a plant
 * pushes two leaves at once.
 *
 * RNTL 14: `render` is async and must be awaited.
 */
import { describe, it, expect, jest } from '@jest/globals';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import LeafCard from './LeafCard';
import { copy } from '../services/language';
import type { LeafEvent } from '../lib/leaves';

const DAY = 86_400_000;
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

const card = (leaves: LeafEvent[], over: Partial<React.ComponentProps<typeof LeafCard>> = {}) => (
  <LeafCard
    leaves={leaves}
    plantName="Steve"
    onLogNew={() => {}}
    onMarkGrown={() => {}}
    onHistory={() => {}}
    {...over}
  />
);

describe('LeafCard', () => {
  it('invites a first leaf when nothing is tracked', async () => {
    await render(card([]));
    expect(screen.getByText(copy.leafCard.empty)).toBeTruthy();
    expect(screen.getByText(copy.leafCard.logNew)).toBeTruthy();
  });

  it('gives every opening leaf its own "fully grown" button', async () => {
    const leaves: LeafEvent[] = [
      { id: 'a', emergedAt: iso(2 * DAY) },
      { id: 'b', emergedAt: iso(9 * DAY) },
    ];
    await render(card(leaves));

    expect(screen.getByText(copy.leafCard.opening(2))).toBeTruthy();
    expect(screen.getAllByText(copy.leafCard.markGrown)).toHaveLength(2);
  });

  it('marks the leaf that was pressed, not the newest one', async () => {
    const onMarkGrown = jest.fn();
    const leaves: LeafEvent[] = [
      { id: 'newer', emergedAt: iso(1 * DAY) },
      { id: 'older', emergedAt: iso(30 * DAY) },
    ];
    await render(card(leaves, { onMarkGrown }));

    /* The rows are drawn newest first, so the SECOND button is the older
     * leaf - the one a toggle-shaped feature could never reach. */
    fireEvent.press(screen.getAllByText(copy.leafCard.markGrown)[1]);
    expect(onMarkGrown).toHaveBeenCalledWith('older');
  });

  it('says how long a leaf has been opening, in days', async () => {
    await render(card([{ id: 'a', emergedAt: iso(5 * DAY) }]));
    expect(screen.getByText(copy.leafCard.appearedDaysAgo(5))).toBeTruthy();
  });

  it('summarises finished leaves and how long they took', async () => {
    const leaves: LeafEvent[] = [
      { id: 'a', emergedAt: iso(40 * DAY), maturedAt: iso(20 * DAY) },
      { id: 'b', emergedAt: iso(80 * DAY), maturedAt: iso(60 * DAY) },
    ];
    await render(card(leaves));
    expect(screen.getByText(`${copy.leafCard.grown(2)} · ${copy.leafCard.average(20)}`)).toBeTruthy();
  });

  it('offers no undo until there is something to undo', async () => {
    const onUndo = jest.fn();
    await render(card([], { onUndo }));
    expect(screen.queryByText(copy.leafCard.undo)).toBeNull();

    await render(card([{ id: 'a', emergedAt: iso(DAY) }], { onUndo }));
    fireEvent.press(screen.getByText(copy.leafCard.undo));
    expect(onUndo).toHaveBeenCalled();
  });

  it('refuses a second tap while a write is in flight', async () => {
    const onLogNew = jest.fn();
    await render(card([], { onLogNew, busy: true }));
    fireEvent.press(screen.getByText(copy.leafCard.logNew));
    expect(onLogNew).not.toHaveBeenCalled();
  });
});
