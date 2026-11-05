/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' keeps asset paths relative so the build works on GitHub Pages / Netlify subpaths.
export default defineConfig({
  base: './',
  build: { chunkSizeWarningLimit: 800 },
  plugins: [react()],
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 60000,
  },
});
