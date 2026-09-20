import { useCallback, useMemo, useRef, useState } from 'react';
import { Gesture } from 'react-native-gesture-handler';
import {
  photoLayout,
  focusForTop,
  clampZoom,
  DEFAULT_FOCUS_Y,
  DEFAULT_ZOOM,
  type Size,
} from '../lib/media/photoFocus';

/*
 * Drag to move a photograph inside its frame, pinch to zoom.
 *
 * The same interaction EditPlantScreen gives a plant photograph, as a hook, so
 * the account avatar is framed with the same two fingers. It is the same
 * problem twice over: a face is no better centred in the picture it came from
 * than a plant is, and a circle is the least forgiving frame in the app.
 *
 * NOT YET SHARED WITH EditPlantScreen, which still holds its own copy of this.
 * That screen also clears its geometry when the photograph is replaced, which
 * needs surface this hook does not have yet, and it is a gesture that can only
 * be verified by hand - so moving it over is its own change with its own test
 * pass, rather than a passenger on the avatar feature. Until then the two must
 * be edited together; that is the cost, and it is why this note is here.
 *
 * THE DRAG IS ONE-TO-ONE with the photograph rather than some chosen
 * sensitivity: the geometry gives the image's drawn height, so a finger moving
 * 40px moves the picture 40px and stops dead at the edge. A tuned multiplier
 * feels like dragging something slightly slippery. It falls out of the zoom for
 * free, because a zoomed-in image is drawn taller.
 */

export interface PhotoFraming {
  focusY: number;
  zoom: number;
  /* Hand to a GestureDetector wrapping the frame - not the image. Below a zoom
   * of 1 the picture no longer fills the frame, and a drag started on the
   * background is still a drag. */
  /* Typed off the composer itself rather than as `ComposedGesture`: the
   * concrete class carries private members, so the base type is not structurally
   * assignable from it. */
  gesture: ReturnType<typeof Gesture.Simultaneous>;
  /* Wire to FramedPhoto's `onGeometry`; nothing can be dragged until it fires. */
  onGeometry: (geometry: { frame: Size; natural: Size }) => void;
  /* Somewhere to put a framing back that went wrong, without hunting for 1x by
   * pinch. */
  reset: () => void;
  /* True once the user has moved it away from where it started, so a caller can
   * decide whether there is anything to save. */
  changed: boolean;
}

export function usePhotoFraming(
  initialFocusY: number = DEFAULT_FOCUS_Y,
  initialZoom: number = DEFAULT_ZOOM
): PhotoFraming {
  const [focusY, setFocusY] = useState(initialFocusY);
  const [zoom, setZoom] = useState(initialZoom);
  const [geometry, setGeometry] = useState<{ frame: Size; natural: Size } | null>(null);

  /* The drawn image, in frame pixels - the same numbers FramedPhoto is using. */
  const drawn = useMemo(
    () => (geometry ? photoLayout(geometry.frame, geometry.natural, focusY, zoom) : null),
    [geometry, focusY, zoom]
  );

  /* Read by the gestures, which must not be rebuilt on every frame of a drag. */
  const live = useRef({ focusY, zoom, drawn, geometry });
  live.current = { focusY, zoom, drawn, geometry };
  const start = useRef({ focusY, zoom });

  const reframe = useMemo(
    () =>
      Gesture.Pan()
        /* On the JS thread on purpose: this sets React state that the layout is
         * computed from, not an animated style, so a worklet would have to cross
         * back on every frame anyway. */
        .runOnJS(true)
        .onBegin(() => {
          start.current.focusY = live.current.focusY;
        })
        .onUpdate((e) => {
          const { drawn: d, geometry: g } = live.current;
          if (!d || !g || d.height <= g.frame.height) return;
          /*
           * Where the image WOULD sit if the finger dragged it, then asked back
           * as a focus. Going through the same geometry in both directions is
           * what keeps the clamping honest at the edges.
           */
          const from = photoLayout(g.frame, g.natural, start.current.focusY, live.current.zoom);
          setFocusY(focusForTop(g.frame, d.height, from.top + e.translationY));
        }),
    []
  );

  const pinch = useMemo(
    () =>
      Gesture.Pinch()
        .runOnJS(true)
        .onBegin(() => {
          start.current.zoom = live.current.zoom;
        })
        .onUpdate((e) => {
          setZoom(clampZoom(start.current.zoom * e.scale));
        }),
    []
  );

  /* Both at once: a pinch almost always carries some drift, and making the user
   * choose one gesture at a time is how a photo editor feels broken. */
  const gesture = useMemo(() => Gesture.Simultaneous(reframe, pinch), [reframe, pinch]);

  const reset = useCallback(() => {
    setFocusY(DEFAULT_FOCUS_Y);
    setZoom(DEFAULT_ZOOM);
  }, []);

  const onGeometry = useCallback((next: { frame: Size; natural: Size }) => {
    setGeometry(next);
  }, []);

  return {
    focusY,
    zoom,
    gesture,
    onGeometry,
    reset,
    changed: focusY !== initialFocusY || zoom !== initialZoom,
  };
}
