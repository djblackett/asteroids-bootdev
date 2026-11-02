import type { CapacitorConfig } from '@capacitor/cli';

/**
 * The Android app (see docs/android.md). The web game inside it is the normal build, made by `npm run build:android` into its own
 * folder: the server-only replay verifier in dist/node is never packaged, and the production leaderboard URL is required.
 */
const config: CapacitorConfig = {
  appId: 'ca.davidandrea.spacearcade',
  appName: 'phaser-asteroids',
  webDir: 'dist-android',
  server: {
    // The app's page is https://spacearcade.davidandrea.ca/ (served from the APK, never fetched from the internet). This is the Origin the
    // leaderboard Worker sees, so it is listed in ALLOWED_ORIGINS (server/wrangler.toml). It is not `localhost`, so the game never
    // treats the app as a development machine (src/ranked/api.ts). Changing it later would also lose saved settings and local scores,
    // because localStorage belongs to the origin.
    hostname: 'spacearcade.davidandrea.ca',
    androidScheme: 'https',
  },
  plugins: {
    // Capacitor 8's built-in system bars: hidden for the whole session (the game is landscape and fullscreen), light icons when the
    // user swipes them in, and the real safe-area insets written to the page as --safe-area-inset-* (index.html, src/ui/touch.css).
    SystemBars: {
      hidden: true,
      style: 'DARK',
      insetsHandling: 'css',
    },
  },
};

export default config;
