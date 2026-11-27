# Hush

A tiny sleep-noise player for Android: pink, brown and white noise, a volume slider, a sleep timer, and background playback with a media notification. It's sideloaded as an APK (no Play Store).

Built with Expo SDK 58, TypeScript and `expo-audio`.

## Features

- **Sounds:** pink, brown and white noise. Switching while playing does a quick fade-out/fade-in (about 250 ms each way), so there's no click.
- **Seamless looping:** 30 s WAV loops with the last 0.5 s crossfaded into the start at generation time.
- **Volume:** defaults to 30 %. White noise is trimmed so it isn't louder than the others.
- **Sleep timer:** 15 / 30 / 45 / 60 min (default 30). A timer is always active, so there is no "off". In the last 30 s the sound fades out, then stops. The remaining time shows under the play button. The timer starts when you press play, restarts if you change it, and is cancelled by pause.
- **Background playback:** keeps playing with the screen off. A media notification (with play/pause) keeps Android from killing it.
- **Remembers** the last sound, volume and timer.

### Adding a sound

1. Put a seamlessly looping file in `assets/sounds/` (or add a generator to `scripts/generate-noise.ts`).
2. Add one line to `SOUNDS` in `src/sounds.ts`.

## Generating the noise files

```sh
npm run generate:sounds
```

This writes `assets/sounds/{white,pink,brown}.wav` (44.1 kHz, 16-bit, mono, 30 s, −3 dBFS peak):

- **white:** uniform random samples (seeded, so output is reproducible)
- **pink:** Paul Kellet's refined filter applied to white noise
- **brown:** leaky integrator over white noise, DC removed

Each file is rendered 0.5 s longer than needed. That extra tail is then crossfaded (equal-power) into the first 0.5 s, so the end of the file runs straight into its start. WAV is used on purpose: MP3/AAC encoders add padding that causes a gap at the loop point.

The script runs with Node's built-in TypeScript support (Node ≥ 22.18), so no extra tooling is needed.

## App icons

```sh
npm run generate:icons
```

`scripts/generate-icons.ts` draws the icon (a muted crescent moon with a rising "zZz" on a dark navy glow) with signed distance functions and writes the PNGs into `assets/`: `icon.png`, the Android adaptive icon layers (`android-icon-foreground/background/monochrome.png`), `splash-icon.png` and `favicon.png`. It uses no dependencies. The art is fitted automatically inside Android's adaptive-icon safe zone, so circle or squircle launcher masks don't clip it. Tweak the shapes or colors at the top of the script and re-run it.

## Development on your phone

Background audio relies on native config from `app.json` (a media-playback foreground service and permissions). **Expo Go doesn't apply your app's config plugins**, so you need a development build. Expo Go would play the sound in the foreground, but it isn't a valid test of background playback or the notification.

One-time setup:

```sh
npm install -g eas-cli    # or prefix the commands below with: npx eas-cli@latest
eas login
eas init                  # links the project to your Expo account (writes projectId into app.json)
```

Build and install the dev client (in the cloud, about 10–15 min):

```sh
eas build --profile development --platform android
```

Open the link or QR code it prints on your phone, then download and install the APK. You'll need to allow installing from unknown sources.

Then, any time you develop:

```sh
npx expo start --dev-client
```

Open the **Hush** dev app on the phone and pick the server, or scan the QR code. The phone and PC must be on the same Wi-Fi; otherwise use `npx expo start --dev-client --tunnel`. JS changes reload instantly. Only rebuild the dev client when native config or native packages change.

**Local alternative** (no cloud): `npx expo run:android` with the phone connected over USB (USB debugging on). This needs Android Studio (Android SDK + `ANDROID_HOME`) and JDK 17. Java 8 isn't enough.

## Building the installable APK

### Cloud (recommended on Windows)

```sh
eas build --profile preview --platform android
```

Download the `.apk` from the link it prints and send it to the phone. The `preview` profile uses `buildType: "apk"`. EAS creates and stores a signing key for you, so future builds install as updates over the existing app.

### Local on Windows

`eas build --local` only runs on macOS/Linux, so use it from WSL or skip it. On plain Windows you can build with Gradle directly (needs Android Studio + JDK 17):

```powershell
npx expo prebuild --platform android
cd android
.\gradlew assembleRelease
```

The APK lands in `android/app/build/outputs/apk/release/app-release.apk`. By default it's signed with the template's debug key, which is fine for sideloading. Android won't install an update signed with a different key, though, so stick with one method (EAS _or_ local) for a given install, or uninstall first.

## Notes

- On first play, Android 13+ asks for notification permission. Allow it so the media controls appear in the notification shade.
- Package name: `com.thavixt.hush`.
- Checks: `npx tsc --noEmit`, `npx expo lint`, `npx expo-doctor`.
