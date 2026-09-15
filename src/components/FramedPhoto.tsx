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
 * Until the first layout and the first `onLoad` the geometry is unknown, and
 * `photoLayout` answers with the frame itself - which is the old centred fill.
 * So a photo appears immediately and settles into its framing, rather than
 * flashing from nothing.
 */
import { useEffect, useState } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { photoCacheKey } from '../lib/media/photoCacheKey';
import { photoLayout, type Size } from '../lib/media/photoFocus';

export interface FramedPhotoProps {
  uri: string;
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

export default function FramedPhoto({
  uri,
  focusY,
  zoom,
  style,
  recyclingKey,
  transition,
  accessibilityLabel,
  onError,
  onGeometry,
}: FramedPhotoProps) {
  const [frame, setFrame] = useState<Size>({ width: 0, height: 0 });
  const [natural, setNatural] = useState<Size>({ width: 0, height: 0 });

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
        source={{ uri, cacheKey: photoCacheKey(uri) }}
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
          setNatural((prev) => (prev.width === next.width && prev.height === next.height ? prev : next));
        }}
        onError={onError}
      />
    </View>
  );
}
