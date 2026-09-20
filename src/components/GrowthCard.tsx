/*
 * The growth journal, on the plant's own screen.
 *
 * A STRIP OF PICTURES, not another bordered action card. It sits directly under
 * LeafCard and the three schedules, all of which are tinted blocks asking for a
 * tap, and a fifth one of those would make the screen read as five equal
 * demands. This one is the opposite kind of thing: nothing is due, nothing is
 * late, and what it has to show is photographs. So it is a plain surface with
 * the pictures themselves doing the work, and the only coloured element is the
 * button that adds one.
 *
 * It shows the newest few and nothing else. The comparison a user actually
 * wants - what it looked like in March against what it looks like now - needs a
 * screen with room to scroll, which is what the chevron opens. Trying to serve
 * that here would turn a card into a gallery and push the care plan off the
 * bottom of the screen.
 */
import { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import FramedPhoto from './FramedPhoto';
import { Theme, useTheme } from '../theme';
import { copy, localeTag } from '../services/language';
import { directionalIconStyle, iconRow } from '../lib/i18n/rtl';
import { growthSpanDays, type GrowthEntry } from '../lib/care/growth';

export interface GrowthCardProps {
  /* Already normalized by the store, newest first. */
  entries: GrowthEntry[];
  /* Named in the add button's accessibility label, so a screen reader user
   * tracking several plants hears which one they are on. */
  plantName: string;
  onAdd: () => void;
  onOpen: () => void;
  /* The photo picker takes a moment to come up, and a second tap in that gap
   * would open two of them. Dims rather than spins, matching the cards above. */
  busy?: boolean;
}

/*
 * How many thumbnails the strip holds.
 *
 * Four rather than "as many as fit": the row is fixed-width squares, and a
 * count that changes with the screen means the same plant looks different on a
 * phone and on a tablet for no reason the user can see. Four fills a phone row
 * with the gaps this app uses everywhere else.
 */
const STRIP_LIMIT = 4;

export default function GrowthCard({
  entries,
  plantName,
  onAdd,
  onOpen,
  busy = false,
}: GrowthCardProps) {
  const t = useTheme();
  const s = useMemo(() => makeStyles(t), [t]);

  /* Only entries that still have a file. A row whose photo was purged belongs
   * in the timeline, where it can explain itself, not in a strip of squares
   * where it would be an unexplained grey one. */
  const withPhotos = entries.filter((e) => e.photoUri !== '');
  const strip = withPhotos.slice(0, STRIP_LIMIT);
  const span = growthSpanDays(entries);

  /*
   * Assembled from the parts that are true, the same rule LeafCard follows. A
   * journal with one photo has a count and no span, and "1 photo over 0 days"
   * is how that gets said by accident.
   */
  const summary = [
    entries.length > 0 ? copy.growthCard.count(entries.length) : '',
    span !== undefined && span > 0 ? copy.growthCard.span(span) : '',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <View style={s.card}>
      <View style={s.headerRow}>
        <View style={s.heading}>
          <Ionicons name="images-outline" size={14} color={t.color.primary} />
          <Text style={s.headingText}>{copy.growthCard.title}</Text>
        </View>
        {/* Only once there is something to see. A "See all" leading to an empty
            screen is a promise the card cannot keep. */}
        {entries.length > 0 && (
          <Pressable
            style={({ pressed }) => [s.openBtn, pressed && { opacity: 0.6 }]}
            onPress={onOpen}
            accessibilityRole="button"
            accessibilityLabel={copy.growthCard.openA11y}
            hitSlop={8}
          >
            <Text style={s.openText}>{copy.growthCard.open}</Text>
            <Ionicons
              name="chevron-forward"
              size={14}
              color={t.color.primary}
              style={directionalIconStyle}
            />
          </Pressable>
        )}
      </View>

      <Text style={s.note}>{copy.growthCard.note}</Text>

      {strip.length > 0 && (
        <View style={s.strip}>
          {strip.map((entry) => (
            <Pressable
              key={entry.id}
              style={({ pressed }) => [s.thumbBtn, pressed && { opacity: 0.7 }]}
              onPress={onOpen}
              accessibilityRole="imagebutton"
              accessibilityLabel={copy.growthCard.thumbA11y(
                new Date(entry.takenAt).toLocaleDateString(localeTag(), {
                  day: 'numeric',
                  month: 'long',
                })
              )}
            >
              {/*
                No `plantId`: that prop swaps the picture for the plant's
                MIRRORED cloud copy, and a journal photo has no cloud copy to
                swap to - it is a local file for every user. Handing over the
                plant's id would draw the plant's main photograph here.
              */}
              <FramedPhoto uri={entry.photoUri} style={s.thumb} recyclingKey={entry.id} transition={120} />
            </Pressable>
          ))}
        </View>
      )}

      <Text style={s.summary}>{entries.length === 0 ? copy.growthCard.empty : summary}</Text>

      <Pressable
        style={({ pressed }) => [s.addBtn, pressed && s.addBtnPressed, busy && s.busy]}
        onPress={onAdd}
        disabled={busy}
        accessibilityRole="button"
        accessibilityState={{ disabled: busy }}
        accessibilityLabel={copy.growthCard.addA11y(plantName)}
      >
        <Ionicons name="camera-outline" size={18} color={t.color.primary} />
        <Text style={s.addText}>{copy.growthCard.add}</Text>
      </Pressable>
    </View>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    card: {
      backgroundColor: t.color.surface,
      borderRadius: t.radius.lg,
      borderWidth: 1,
      borderColor: t.color.border,
      padding: t.space.lg,
      marginBottom: t.space.sm,
      ...t.elevation.card,
    },
    headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    heading: { ...iconRow, alignItems: 'center', gap: 5 },
    headingText: {
      ...t.type.caption,
      color: t.color.primary,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
    },
    openBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: 28 },
    openText: { ...t.type.caption, color: t.color.primary, fontWeight: '700' },

    note: { ...t.type.caption, color: t.color.textSecondary, marginTop: 2, writingDirection: 'auto' },

    /*
     * `row` rather than a horizontal ScrollView. The strip holds four at most,
     * so there is nothing to scroll, and a scroll view nested inside the
     * screen's own vertical one is a gesture conflict bought for no gain.
     */
    strip: { flexDirection: 'row', gap: t.space.xs, marginTop: t.space.md },
    /* Squares that share the row evenly, so three photos are not three
     * differently-sized rectangles. */
    thumbBtn: { flex: 1, aspectRatio: 1 },
    thumb: { width: '100%', height: '100%', borderRadius: t.radius.md },

    summary: {
      ...t.type.caption,
      color: t.color.textSecondary,
      marginTop: t.space.sm,
      writingDirection: 'auto',
    },

    /*
     * Outlined, not filled. Every filled button on this screen is a care action
     * with a schedule behind it; adding a photograph is an invitation, and it
     * must not compete with "Water now" on a plant that is three days overdue.
     */
    addBtn: {
      ...iconRow,
      alignItems: 'center',
      justifyContent: 'center',
      gap: t.space.sm,
      borderRadius: t.radius.lg,
      borderWidth: 1,
      borderColor: t.color.primary,
      marginTop: t.space.md,
      paddingVertical: t.space.md,
      minHeight: 48,
    },
    addBtnPressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
    addText: { ...t.type.label, color: t.color.primary },

    busy: { opacity: 0.6 },
  });
