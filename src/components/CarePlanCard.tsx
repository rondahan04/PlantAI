import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Theme, useTheme } from '../theme';
import type { CarePlan } from '../types';
import type { SoilCarePlan } from '../lib/genusCarePlan';
import { soilMediumById, type SoilMediumId } from '../lib/soilMedia';

/*
 * The standing care advice, and WHOSE advice it is.
 *
 * Two different answers can fill this card and they are not better and worse
 * versions of the same thing, which is why the header names the source rather
 * than always saying "Care plan":
 *
 *   - the genus plan's entry for the medium this plant is actually in. Advice
 *     for Alocasia in LECA, written knowing it is in LECA.
 *   - the diagnosis's own care plan. Advice for this species with NO idea what
 *     the plant is potted in - the model was shown a photo of leaves.
 *
 * A user who has just told the app their plant lives in pon and is then shown
 * peat-shaped advice under a neutral "Care" heading has no way to tell that the
 * app ignored them; they will either follow it and rot the roots, or stop
 * believing the medium picker does anything. So "Alocasia in Pon" versus a
 * plain "Care" is not decoration, it is the only signal that separates the two.
 *
 * WHAT IS NOT HERE. The genus branch prints light and humidity and nothing
 * about water or feeding, because the watering and feeding prose from the SAME
 * soil plan is already printed inside their own ScheduleCards, next to the
 * interval it explains. Repeating it here would put the identical sentence on
 * screen twice, and the copy further from the schedule would be the one that
 * looked authoritative. The diagnosis branch does print water, because in that
 * branch there is no soil plan and so the schedule cards show no prose at all.
 */

export interface CarePlanCardProps {
  /* The genus plan's entry for this plant's medium, when one is cached. */
  soilPlan: SoilCarePlan | undefined;
  /* The diagnosis's own plan, used only when there is no soil plan. */
  fallback: CarePlan | undefined;
  medium: SoilMediumId | undefined;
  /* Names the advice in the header. Absent on a plant we could never place -
   * hand-added with a typed species, or an older diagnosis from before the
   * server sent a genus. */
  genus: string | undefined;
}

interface Row {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
}

export default function CarePlanCard({ soilPlan, fallback, medium, genus }: CarePlanCardProps) {
  const t = useTheme();
  const s = useMemo(() => makeStyles(t), [t]);

  const mediumLabel = soilMediumById(medium)?.label;

  /*
   * A fixed order rather than a loop over whatever keys arrived: soil, then
   * light, then water is the order a person actually sets a plant up in, and a
   * stable layout is what makes this skimmable on a plant opened twenty times.
   * The genus branch keeps that order minus the rows that moved elsewhere.
   */
  const rows: Row[] = soilPlan
    ? [
        { key: 'light', label: 'Light', icon: 'sunny-outline', text: soilPlan.light },
        { key: 'humidity', label: 'Humidity', icon: 'thermometer-outline', text: soilPlan.humidity },
      ]
    : fallback
      ? [
          { key: 'soil', label: 'Soil', icon: 'layers-outline', text: fallback.soil },
          { key: 'light', label: 'Light', icon: 'sunny-outline', text: fallback.light },
          { key: 'water', label: 'Water', icon: 'water-outline', text: fallback.water },
        ]
      : [];

  /*
   * NEITHER SOURCE, NOTHING RENDERED. A heading over three empty rows reads as
   * a screen that failed to load rather than as advice the app was never given,
   * and the second is the truth for a hand-added plant whose genus call has not
   * landed yet.
   */
  if (rows.length === 0) return null;

  /*
   * The header names the plant and the pot only when BOTH are known. "Alocasia
   * in LECA" is a promise that this text was written for that combination, so a
   * half-known version ("Alocasia in" / a genus with no medium) must not be
   * made - it would claim a specificity the advice does not have.
   */
  const title = soilPlan && genus && mediumLabel ? `${genus} in ${mediumLabel}` : 'Care';
  const note = soilPlan
    ? 'Written for this plant in this growing medium.'
    : 'From the diagnosis, which did not know what it is potted in.';

  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>{title}</Text>
      <Text style={s.sectionNote}>{note}</Text>

      {rows.map(({ key, label, icon, text }) => (
        <View
          key={key}
          style={s.careCard}
          /* One node per row: a screen reader should say "Light: bright
             indirect", not read the icon and the label as separate stops. */
          accessible
          accessibilityLabel={`${label}: ${text}`}
        >
          <View style={s.careIconWrap}>
            <Ionicons name={icon} size={20} color={t.color.primary} />
          </View>
          <View style={s.careBody}>
            <Text style={s.careLabel}>{label}</Text>
            <Text style={s.careText}>{text}</Text>
          </View>
        </View>
      ))}

      {/*
        Warnings are drawn in the warning palette rather than as another care
        row because they are a different KIND of sentence: the rows describe the
        good state, these describe the specific way THIS medium goes wrong -
        salts building up in pon, a reservoir left standing in LECA. They only
        exist per medium, which is why they hang off the soil plan and vanish
        with it; most combinations have none, and an empty block would read as a
        missing feature rather than as good news.
      */}
      {!!soilPlan?.warnings?.length && (
        <View style={s.warnBlock}>
          {soilPlan.warnings.map((w, i) => (
            <View key={i} style={s.warnRow} accessible accessibilityLabel={`Watch out: ${w}`}>
              <Ionicons name="alert-circle-outline" size={16} color={t.color.warning} />
              <Text style={s.warnText}>{w}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    section: { marginTop: t.space.xl },
    sectionTitle: { ...t.type.heading, color: t.color.foreground, writingDirection: 'auto' },
    sectionNote: {
      ...t.type.caption,
      color: t.color.textMuted,
      marginTop: 2,
      marginBottom: t.space.sm,
    },

    /*
     * Same card shell as a treatment on the detail screen, deliberately: both
     * are advice about this plant. The icon column is what separates them at a
     * glance - no urgency colour here, because ongoing care is never the thing
     * to act on first.
     */
    careCard: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      backgroundColor: t.color.surface,
      borderRadius: t.radius.lg,
      padding: t.space.md,
      marginBottom: t.space.sm,
      ...t.elevation.card,
    },
    careIconWrap: {
      width: 36,
      height: 36,
      borderRadius: t.radius.md,
      backgroundColor: t.color.surfaceMuted,
      alignItems: 'center',
      justifyContent: 'center',
      marginEnd: t.space.md,
    },
    careBody: { flex: 1 },
    careLabel: {
      ...t.type.caption,
      color: t.color.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
    },
    careText: { ...t.type.body, color: t.color.foreground, marginTop: 2, writingDirection: 'auto' },

    warnBlock: {
      backgroundColor: t.color.warningWash,
      borderRadius: t.radius.lg,
      borderWidth: 1,
      borderColor: t.color.warning,
      padding: t.space.md,
      marginTop: t.space.xs,
      /* Gap on the container rather than a margin on the row: a margin would
       * have to be suppressed on the first child, and a plan with exactly one
       * warning is the common case. */
      gap: t.space.sm,
    },
    warnRow: { flexDirection: 'row', alignItems: 'flex-start', gap: t.space.sm },
    warnText: {
      ...t.type.body,
      color: t.color.foreground,
      flex: 1,
      writingDirection: 'auto',
    },
  });
