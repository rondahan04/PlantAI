/*
 * One plant's growth journal, newest first.
 *
 * WHY A SCREEN AND NOT A GRID. A grid of squares answers "how many photos do I
 * have"; nobody asks that. The question this feature exists for is "what did it
 * look like before", and answering it needs the photograph big enough to see a
 * leaf in, with its date and the note next to it. So this is a column of large
 * pictures, and the scroll itself is the passage of time.
 *
 * EVERYTHING HERE IS LOCAL. The journal index lives in its own storage key and
 * its files in their own directory (`services/plants/growthStore.ts`,
 * `services/media/photos.ts`) - nothing is uploaded, for signed-in users
 * either, so every failure this screen can report is a full disk. That is why
 * there is no network branch in any of the alerts below, unlike the plant's own
 * save path.
 *
 * The writes are SYNCHRONOUS - `growthJournal` is bound to the same kv-store
 * the library uses - so the list is re-read from storage after each one rather
 * than being patched in memory. One source of truth, and a failed write leaves
 * the screen showing what is actually on disk.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import FramedPhoto from '../../components/FramedPhoto';
import { RootStackParamList } from '../../types/index';
import { Theme, useTheme } from '../../theme/index';
import { directionalIconStyle, iconRow } from '../../lib/i18n/rtl';
import { copy, localeTag } from '../../services/language';
import { plantRepo } from '../../services/plants/plantRepoInstance';
import { plantDisplayName } from '../../lib/portfolio';
import { growthJournal } from '../../services/plants/growthJournal';
import { growthPhotos } from '../../services/media/photos';
import { shrinkForStorage } from '../../services/media/imageResize';
import {
  MAX_NOTE_LENGTH,
  entryAgeDays,
  growthSpanDays,
  type GrowthEntry,
} from '../../lib/care/growth';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'GrowthJournal'>;
  route: RouteProp<RootStackParamList, 'GrowthJournal'>;
};

/* How long ago, in the words the user reads. Whole days, floored - a photo
 * taken this morning says "today", not "1 day ago". */
function whenLabel(entry: GrowthEntry, now: number): string {
  const days = entryAgeDays(entry, now);
  if (days <= 0) return copy.growthJournal.today;
  if (days === 1) return copy.growthJournal.yesterday;
  return copy.growthJournal.daysAgo(days);
}

export default function GrowthJournalScreen({ navigation, route }: Props) {
  const t = useTheme();
  const s = useMemo(() => makeStyles(t), [t]);
  const { plantId, add: addOnOpen } = route.params;

  const [entries, setEntries] = useState<GrowthEntry[]>(() => growthJournal.entriesFor(plantId));
  const [plantName, setPlantName] = useState('');
  const [busy, setBusy] = useState(false);
  /* Which entry's note is open for editing, and the text as typed. Held here
   * rather than per row so only one editor can be open: two open editors is two
   * unsaved drafts, and the second Save would look like it saved both. */
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);

  /*
   * The plant is read for its NAME only, and the screen works without one - the
   * journal is keyed by id and does not need the record to exist. A plant
   * deleted from another screen while this one is open leaves the photographs
   * readable rather than throwing the user out mid-scroll; the launch sweep is
   * what eventually clears them.
   */
  useEffect(() => {
    const found = plantRepo.loadLocal().plants.find((p) => p.id === plantId);
    if (found) setPlantName(plantDisplayName(found));
  }, [plantId]);

  const refresh = useCallback(() => setEntries(growthJournal.entriesFor(plantId)), [plantId]);

  const reportFailure = useCallback(() => {
    Alert.alert(copy.growthJournal.failTitle, copy.growthJournal.failStorage);
  }, []);

  const addFrom = useCallback(
    async (from: 'camera' | 'library') => {
      if (busy) return;
      setBusy(true);
      try {
        const permission =
          from === 'camera'
            ? await ImagePicker.requestCameraPermissionsAsync()
            : await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) {
          Alert.alert(
            copy.growthJournal.failTitle,
            from === 'camera'
              ? copy.growthJournal.cameraDenied
              : copy.growthJournal.libraryDenied
          );
          return;
        }

        const result =
          from === 'camera'
            ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.7 })
            : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
        if (result.canceled || !result.assets?.[0]) return;
        const asset = result.assets[0];

        /*
         * Shrunk before the record is written, unlike a plant's main photo
         * which is shrunk at capture. A journal fills up with photographs of
         * the same plant by design, so the size policy matters more here than
         * anywhere else in the app: fifty full-resolution gallery picks is
         * hundreds of megabytes the user never chose to spend.
         */
        const shrunk = await shrinkForStorage(asset.uri, asset.width ?? 0, asset.height ?? 0);

        /*
         * The record first, pointing at the picker's cache URI, then the copy
         * into the document directory. Same order and same reason as
         * AddPlantScreen: killed between the two, the user loses the picture
         * and keeps the entry, which is recoverable - the other order loses
         * both.
         */
        const added = growthJournal.add(plantId, { photoUri: shrunk });
        if (!added.ok || !added.entry) {
          reportFailure();
          return;
        }
        refresh();

        const entryId = added.entry.id;
        const persisted = await growthPhotos.adopt(entryId, shrunk);
        /*
         * A copy that could not be made leaves the entry pointing at the cache
         * URI, which works until iOS empties that directory. Not worth an
         * alert: the photo is on screen, and the timeline explains itself if it
         * later goes missing.
         */
        if (persisted && growthJournal.setPhotoUri(plantId, entryId, persisted).ok) refresh();
      } finally {
        setBusy(false);
      }
    },
    [busy, plantId, refresh, reportFailure]
  );

  /*
   * Two sources, asked for as a dialog rather than drawn as two buttons: the
   * choice is made once per photo and would otherwise sit on screen forever
   * above a list that is the actual content.
   */
  const promptForSource = useCallback(() => {
    Alert.alert(copy.growthJournal.sourceTitle, undefined, [
      { text: copy.growthJournal.sourceCamera, onPress: () => void addFrom('camera') },
      { text: copy.growthJournal.sourceLibrary, onPress: () => void addFrom('library') },
      { text: copy.growthJournal.cancel, style: 'cancel' },
    ]);
  }, [addFrom]);

  /*
   * Arrived from the card's "Add a photo": open the picker straight away, and
   * clear the flag first so a screen restored from persisted params - or a
   * re-render while the picker is up - cannot fire it a second time.
   */
  useEffect(() => {
    if (!addOnOpen) return;
    navigation.setParams({ add: undefined });
    promptForSource();
  }, [addOnOpen, navigation, promptForSource]);

  const confirmRemove = useCallback(
    (entry: GrowthEntry) => {
      Alert.alert(copy.growthJournal.removeTitle, copy.growthJournal.removeBody, [
        { text: copy.growthJournal.cancel, style: 'cancel' },
        {
          text: copy.growthJournal.removeConfirm,
          style: 'destructive',
          onPress: () => {
            const result = growthJournal.remove(plantId, entry.id);
            if (!result.ok) {
              reportFailure();
              return;
            }
            /*
             * The file goes only after the record did. A failed write with the
             * file already deleted would leave a row pointing at nothing - the
             * same order PlantDetailScreen uses when removing a plant.
             */
            growthPhotos.discard(entry.id);
            if (editing?.id === entry.id) setEditing(null);
            refresh();
          },
        },
      ]);
    },
    [editing, plantId, refresh, reportFailure]
  );

  const saveNote = useCallback(() => {
    if (!editing) return;
    const result = growthJournal.editNote(plantId, editing.id, editing.text);
    if (!result.ok) {
      reportFailure();
      return;
    }
    /*
     * Clearing the note of an entry whose photo is already gone removes the row
     * entirely (there would be nothing left to draw), so the file is swept here
     * too. Harmless when the entry survived: `discard` only deletes files it
     * finds, and an entry that is still listed still owns its own.
     */
    if (!result.entries.some((e) => e.id === editing.id)) growthPhotos.discard(editing.id);
    setEditing(null);
    refresh();
  }, [editing, plantId, refresh, reportFailure]);

  const span = growthSpanDays(entries);
  const summary = [
    entries.length > 0 ? copy.growthJournal.count(entries.length) : '',
    span !== undefined && span > 0 ? copy.growthJournal.span(span) : '',
  ]
    .filter(Boolean)
    .join(' · ');

  const now = Date.now();

  return (
    <SafeAreaView style={s.container} edges={['top', 'bottom']}>
      <View style={s.header}>
        <Pressable
          style={s.backBtn}
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel={copy.growthJournal.backA11y}
          hitSlop={8}
        >
          <Ionicons
            name="chevron-back"
            size={22}
            color={t.color.primary}
            style={directionalIconStyle}
          />
          <Text style={s.backText}>{copy.growthJournal.back}</Text>
        </Pressable>
        {busy && <ActivityIndicator size="small" color={t.color.primary} />}
      </View>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        <Text style={s.title}>{copy.growthJournal.title}</Text>
        {/* The plant's name, once it is known. Absent rather than a placeholder
            while it loads, and absent for good on a plant that was deleted. */}
        {plantName !== '' && <Text style={s.subtitle}>{plantName}</Text>}
        {summary !== '' && <Text style={s.summary}>{summary}</Text>}

        <Pressable
          style={({ pressed }) => [s.addBtn, pressed && s.addBtnPressed, busy && s.busy]}
          onPress={promptForSource}
          disabled={busy}
          accessibilityRole="button"
          accessibilityState={{ disabled: busy }}
          accessibilityLabel={copy.growthJournal.addA11y}
        >
          <Ionicons name="camera-outline" size={18} color={t.color.onPrimary} />
          <Text style={s.addText}>{copy.growthJournal.add}</Text>
        </Pressable>

        {entries.length === 0 ? (
          <View style={s.empty}>
            <Ionicons name="images-outline" size={28} color={t.color.textMuted} />
            <Text style={s.emptyTitle}>{copy.growthJournal.emptyTitle}</Text>
            <Text style={s.emptyBody}>{copy.growthJournal.emptyBody}</Text>
          </View>
        ) : (
          entries.map((entry) => {
            const when = whenLabel(entry, now);
            const date = new Date(entry.takenAt).toLocaleDateString(localeTag(), {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            });
            const isEditing = editing?.id === entry.id;

            return (
              <View key={entry.id} style={s.entry}>
                {entry.photoUri !== '' ? (
                  /* No `plantId` - see the note in GrowthCard: that prop would
                     swap in the plant's mirrored main photograph. */
                  <FramedPhoto
                    uri={entry.photoUri}
                    style={s.photo}
                    recyclingKey={entry.id}
                    transition={160}
                    accessibilityLabel={copy.growthCard.thumbA11y(date)}
                  />
                ) : (
                  <View style={s.photoMissing}>
                    <Ionicons name="image-outline" size={24} color={t.color.textMuted} />
                    <Text style={s.photoMissingText}>{copy.growthJournal.photoMissing}</Text>
                  </View>
                )}

                <View style={s.metaRow}>
                  <View style={s.meta}>
                    <Text style={s.when}>{when}</Text>
                    <Text style={s.date}>{date}</Text>
                  </View>
                  <Pressable
                    style={({ pressed }) => [s.removeBtn, pressed && { opacity: 0.6 }]}
                    onPress={() => confirmRemove(entry)}
                    accessibilityRole="button"
                    accessibilityLabel={copy.growthJournal.removeA11y}
                    hitSlop={8}
                  >
                    <Ionicons name="trash-outline" size={18} color={t.color.danger} />
                  </Pressable>
                </View>

                {isEditing ? (
                  <View style={s.editor}>
                    <TextInput
                      style={s.input}
                      value={editing.text}
                      onChangeText={(text) => setEditing({ id: entry.id, text })}
                      placeholder={copy.growthJournal.notePlaceholder}
                      placeholderTextColor={t.color.textMuted}
                      accessibilityLabel={copy.growthJournal.noteA11y}
                      multiline
                      /* The store bounds it anyway; doing it here too means the
                       * user never types words that are silently dropped. */
                      maxLength={MAX_NOTE_LENGTH}
                      autoFocus
                    />
                    <View style={s.editorActions}>
                      <Pressable
                        style={({ pressed }) => [s.editorBtn, pressed && { opacity: 0.6 }]}
                        onPress={() => setEditing(null)}
                        accessibilityRole="button"
                      >
                        <Text style={s.editorCancel}>{copy.growthJournal.noteCancel}</Text>
                      </Pressable>
                      <Pressable
                        style={({ pressed }) => [s.editorBtn, pressed && { opacity: 0.6 }]}
                        onPress={saveNote}
                        accessibilityRole="button"
                      >
                        <Text style={s.editorSave}>{copy.growthJournal.noteSave}</Text>
                      </Pressable>
                    </View>
                  </View>
                ) : (
                  <Pressable
                    style={({ pressed }) => [s.noteBtn, pressed && { opacity: 0.6 }]}
                    onPress={() => setEditing({ id: entry.id, text: entry.note ?? '' })}
                    accessibilityRole="button"
                    accessibilityLabel={
                      entry.note ? copy.growthJournal.noteEdit : copy.growthJournal.noteAdd
                    }
                  >
                    {entry.note ? (
                      <Text style={s.note}>{entry.note}</Text>
                    ) : (
                      <Text style={s.noteAdd}>{copy.growthJournal.noteAdd}</Text>
                    )}
                  </Pressable>
                )}
              </View>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: t.color.background },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: t.space.lg,
      paddingVertical: t.space.sm,
    },
    backBtn: { ...iconRow, alignItems: 'center', gap: 2, minHeight: 44 },
    backText: { ...t.type.body, color: t.color.primary },

    scroll: { paddingHorizontal: t.space.lg, paddingBottom: t.space.xl },
    title: { ...t.type.title, color: t.color.foreground, writingDirection: 'auto' },
    subtitle: {
      ...t.type.body,
      color: t.color.textSecondary,
      marginTop: 2,
      writingDirection: 'auto',
    },
    summary: {
      ...t.type.caption,
      color: t.color.textMuted,
      marginTop: t.space.xs,
      writingDirection: 'auto',
    },

    addBtn: {
      ...iconRow,
      alignItems: 'center',
      justifyContent: 'center',
      gap: t.space.sm,
      backgroundColor: t.color.primary,
      borderRadius: t.radius.lg,
      marginTop: t.space.lg,
      paddingVertical: t.space.md,
      minHeight: 48,
      ...t.elevation.raised,
    },
    addBtnPressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
    addText: { ...t.type.label, color: t.color.onPrimary },
    busy: { opacity: 0.6 },

    empty: { alignItems: 'center', gap: t.space.xs, marginTop: t.space.xl },
    emptyTitle: { ...t.type.heading, color: t.color.foreground, writingDirection: 'auto' },
    emptyBody: {
      ...t.type.body,
      color: t.color.textSecondary,
      textAlign: 'center',
      writingDirection: 'auto',
    },

    entry: {
      backgroundColor: t.color.surface,
      borderRadius: t.radius.lg,
      borderWidth: 1,
      borderColor: t.color.border,
      padding: t.space.md,
      marginTop: t.space.lg,
      ...t.elevation.card,
    },
    /*
     * A tall-ish rectangle rather than a square. Plants are photographed
     * portrait, in the shape a phone is already held, and a square crop of a
     * portrait shot cuts off exactly the new growth at the top that the picture
     * was taken for.
     */
    photo: { width: '100%', aspectRatio: 3 / 4, borderRadius: t.radius.md },
    photoMissing: {
      width: '100%',
      aspectRatio: 3 / 4,
      borderRadius: t.radius.md,
      backgroundColor: t.color.surfaceMuted,
      alignItems: 'center',
      justifyContent: 'center',
      gap: t.space.xs,
      paddingHorizontal: t.space.lg,
    },
    photoMissingText: {
      ...t.type.caption,
      color: t.color.textMuted,
      textAlign: 'center',
      writingDirection: 'auto',
    },

    metaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: t.space.sm,
      gap: t.space.sm,
    },
    meta: { flexShrink: 1 },
    when: { ...t.type.label, color: t.color.foreground, writingDirection: 'auto' },
    date: { ...t.type.caption, color: t.color.textMuted, writingDirection: 'auto' },
    removeBtn: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' },

    noteBtn: { marginTop: t.space.xs, minHeight: 32, justifyContent: 'center' },
    note: { ...t.type.body, color: t.color.textSecondary, writingDirection: 'auto' },
    noteAdd: { ...t.type.caption, color: t.color.primary, fontWeight: '700' },

    editor: { marginTop: t.space.xs, gap: t.space.xs },
    input: {
      ...t.type.body,
      color: t.color.foreground,
      backgroundColor: t.color.background,
      borderWidth: 1,
      borderColor: t.color.border,
      borderRadius: t.radius.md,
      padding: t.space.sm,
      minHeight: 72,
      textAlignVertical: 'top',
      writingDirection: 'auto',
    },
    editorActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: t.space.md },
    editorBtn: { minHeight: 36, justifyContent: 'center', paddingHorizontal: t.space.xs },
    editorCancel: { ...t.type.caption, color: t.color.textMuted, fontWeight: '700' },
    editorSave: { ...t.type.caption, color: t.color.primary, fontWeight: '700' },
  });
