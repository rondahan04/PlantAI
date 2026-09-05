import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { resizePlan } from '../lib/imagePolicy';

/*
 * Bring a photo down to a sane size before the app takes ownership of it.
 *
 * The thin native-bound half of `lib/imagePolicy.ts`. Everything with a rule
 * in it lives there and is tested; this file only calls the manipulator.
 *
 * SDK 56's contextual API (`ImageManipulator.manipulate(...).renderAsync()`),
 * not the deprecated `manipulateAsync` - the same reason this project moved
 * off the functional FileSystem API in 54e65ed.
 */

/*
 * Returns a URI to use from here on: the resized copy, or the original when
 * nothing needed doing.
 *
 * NEVER THROWS, and never returns nothing. A photo the manipulator cannot
 * process is still a photo the user just took of a plant they are worried
 * about - failing the capture over an optimisation would trade the whole
 * feature for a smaller file. The upload-size guard downstream still catches
 * anything genuinely too large to send, so the failure mode here is a slow
 * path, not a broken one.
 */
export async function shrinkForStorage(
  uri: string,
  width: number,
  height: number
): Promise<string> {
  const plan = resizePlan(width, height);
  if (!plan) return uri;

  try {
    const rendered = await ImageManipulator.manipulate(uri).resize(plan).renderAsync();
    const result = await rendered.saveAsync({
      format: SaveFormat.JPEG,
      /*
       * 0.8 rather than the 0.7 used at capture: this is a re-encode of an
       * already-compressed image, and stacking the same compression twice is
       * where visible artefacts come from. The resize is doing the real work.
       */
      compress: 0.8,
    });
    return result.uri || uri;
  } catch {
    return uri;
  }
}
