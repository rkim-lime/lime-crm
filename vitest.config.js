import { defineConfig } from 'vitest/config';

// Frontend unit tests only. The ingestion pipeline has its own vitest suite
// (ingestion/) run separately in CI; keep the two from overlapping.
export default defineConfig({
  test: {
    include: ['src/**/*.{test,spec}.{js,jsx}'],
    environment: 'node',
  },
});
