import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative base: every built URL (scripts, favicon) resolves against the page's own URL, and the runtime audio
  // paths in src/audio/audioConfig.ts do too. The same build therefore works at the GitHub Pages project URL
  // (https://<user>.github.io/<repo>/), at a custom domain's root and in `vite preview`, so moving to a custom
  // domain needs no build change. Do not switch this to an absolute path (e.g. '/'): it would break the project URL.
  // `npm run test:pages` checks the build at `/asteroids-bootdev/` and at `/`.
  base: './',
  build: {
    target: 'es2022',
    // Phaser alone is >1 MB minified; keep it in its own cacheable chunk.
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        manualChunks: (id) => (id.includes('node_modules/phaser') ? 'phaser' : undefined),
      },
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
