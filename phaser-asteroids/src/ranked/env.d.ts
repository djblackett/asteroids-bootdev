// The project deliberately has no vite/client types; this declares the one build-time variable the ranked client reads.
interface ImportMetaEnv {
  /** Base URL of the leaderboard API baked into a production build, e.g. https://asteroids-leaderboard.example.workers.dev */
  readonly VITE_LEADERBOARD_API_URL?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
