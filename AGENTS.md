# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v56.0.0/ before writing any code.

## iOS build fails at link with `facebook::react::Sealable` undefined

Stale prebuilt React core in `ios/Pods` (Release flavor, built with `NDEBUG`, symbols stripped).
Not an ABI bug, not RNGestureHandler/RNScreens, not the `SwiftUICore` warning above it. Fix:

```
rm -rf ios/Pods ios/build ios/Podfile.lock && (cd ios && pod install)
rm -rf ~/Library/Developer/Xcode/DerivedData/PlantAI-*
```

Do NOT set `RCT_USE_PREBUILT_RNCORE=0` or `buildReactNativeFromSource` - that trades a one-off
reset for a source compile of RN on every clean build. See TODOS.md item 29.
