/*
 * A plant photograph, drawn the way its owner framed it.
 *
 * Every surface that shows a saved photo goes through here - the portfolio
 * card, the detail hero, the Home hero and face row, and the edit sheet. That
 * is the point: the framing is chosen in the editor and has to look identical
 * everywhere else, and five call sites each doing their own arithmetic is five
 * chances for the card to disagree with what the user just set.
 *
 * WHY NOT `contentFit` AND `contentPosition`. Those can only crop INTO an
 * image. There is no way to express "show me all of it, with space around it",
 * which is exactly what zooming out has to mean. So the size and offset are
 * computed from the frame and the image's natural size (`lib/media/photoFocus.ts`)
 * and the image is placed absolutely inside a clipping box.
 *
 * Until the first layout the geometry is unknown, and `photoLayout` answers
 * with the frame itself - which is the old centred fill. So a photo appears
 * immediately rather than flashing from nothing.
 *
 * The image's own size used to be part of that unknown, and it was the visible
 * half: `onLoad` is a callback, so it is a frame late even when the bytes came
 * off local disk instantly, and every photo appeared in the old centred crop
 * and SNAPPED into its framing. A photograph's dimensions never change, so they
 * are learnt once and remembered (`services/media/photoSizes`) and the first
 * frame is already right. `onLoad` is still the source of truth; it is now
 * confirming what was already drawn rather than correcting it.
 */
import { useEffect, useRef, useState } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { photoCacheKey } from '../lib/media/photoCacheKey';
import { photoLayout, type Size } from '../lib/media/photoFocus';
import { usePlantPhoto } from '../hooks/usePlantPhoto';
import { photoSizes } from '../services/media/photoSizes';

export interface FramedPhotoProps {
  uri: string;
  /*
   * The plant this photo belongs to, when there is one. Given it, the photo is
   * drawn from the phone's own copy rather than from a signed url that expires
   * in an hour - see `hooks/usePlantPhoto`. Optional because the editor also
   * draws a photo that is not saved to any plant yet.
   */
  plantId?: string;
  focusY?: number;
  zoom?: number;
  /* The frame. Give it a size and a radius; it clips whatever it is given. */
  style?: StyleProp<ViewStyle>;
  /* Rows are recycled as a list scrolls; without this a reused row shows the
   * previous plant's photo until the new one decodes. */
  recyclingKey?: string;
  transition?: number;
  accessibilityLabel?: string;
  onError?: () => void;
  /* The editor needs the same numbers it is drawing with, to turn a finger's
   * travel into a change in focus. */
  onGeometry?: (geometry: { frame: Size; natural: Size }) => void;
}

const UNKNOWN: Size = { width: 0, height: 0 };

export default function FramedPhoto({
  uri,
  plantId,
  focusY,
  zoom,
  style,
  recyclingKey,
  transition,
  accessibilityLabel,
  onError,
  onGeometry,
}: FramedPhotoProps) {
  /* The local copy when the mirror has one, the given URI otherwise. Swaps
   * under the component the moment a download lands, which costs nothing
   * visible: it is the same photograph. */
  const source = usePlantPhoto(plantId, uri);

  /*
   * The photo's identity, stable across re-signing and across the swap from a
   * signed url to the mirrored file - both are the same picture with the same
   * dimensions. Derived from the PROP rather than from `source` for exactly
   * that reason: the resolved uri changes when a download lands, and a size
   * remembered under the old one would be dropped on the floor.
   */
  const sizeKey = photoCacheKey(uri) ?? uri;
  const remembered = photoSizes.get(sizeKey);

  const [frame, setFrame] = useState<Size>({ width: 0, height: 0 });
  const [natural, setNatural] = useState<Size>(() => remembered ?? UNKNOWN);

  /*
   * Reset when the component is handed a DIFFERENT photo.
   *
   * List rows are recycled, so this component routinely outlives the picture it
   * was mounted for. Without this the new photo would be laid out against the
   * previous plant's dimensions until its own `onLoad` landed - the same snap
   * this is all here to remove, just with a wronger starting point.
   *
   * Assigned during render rather than in an effect: an effect runs AFTER the
   * frame that used the stale size, which is the one frame that had to be
   * right. React handles a set-state-while-rendering on the component's own
   * state by re-running the render before anything is committed.
   */
  const drawnKey = useRef(sizeKey);
  if (drawnKey.current !== sizeKey) {
    drawnKey.current = sizeKey;
    setNatural(remembered ?? UNKNOWN);
  }

  const layout = photoLayout(frame, natural, focusY ?? 0.5, zoom ?? 1);

  /*
   * Reported from an effect rather than from inside the two callbacks.
   *
   * The frame arrives from `onLayout` and the natural size from `onLoad`, in
   * either order, and each callback only sees the other's value as it was at
   * its own render. Reporting from within them meant that when `onLoad` won
   * the race the frame was still zero, the report was skipped, and `onLayout`
   * had already had its turn - so the editor never learned the geometry and
   * the drag quietly did nothing. An effect sees both settled.
   */
  useEffect(() => {
    if (frame.width > 0 && natural.width > 0) onGeometry?.({ frame, natural });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the callback is
    // recreated by callers each render; the measurements are the real trigger.
  }, [frame.width, frame.height, natural.width, natural.height]);

  return (
    <View
      style={[style, { overflow: 'hidden' }]}
      onLayout={(e) => {
        const next = { width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height };
        setFrame((prev) => (prev.width === next.width && prev.height === next.height ? prev : next));
      }}
    >
      <ExpoImage
        source={{ uri: source, cacheKey: photoCacheKey(source) }}
        style={{
          position: 'absolute',
          width: layout.width,
          height: layout.height,
          left: layout.left,
          top: layout.top,
        }}
        /* The box is already the image's own aspect ratio, computed above, so
         * there is nothing left for contentFit to decide. */
        contentFit="fill"
        cachePolicy="memory-disk"
        recyclingKey={recyclingKey}
        transition={transition}
        accessibilityLabel={accessibilityLabel}
        accessibilityIgnoresInvertColors
        onLoad={(e) => {
          const next = { width: e.source.width, height: e.source.height };
          /* Learn it for every future launch. The store ignores a repeat, so
           * this costs nothing on the recycling path that fires it most. */
          photoSizes.remember(sizeKey, next);
          setNatural((prev) => (prev.width === next.width && prev.height === next.height ? prev : next));
        }}
        onError={onError}
      />
    </View>
  );
}
