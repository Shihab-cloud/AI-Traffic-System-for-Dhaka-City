import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // Vitest sizes its worker pool off the CPU count, which is the wrong axis
    // on a memory-constrained machine — a 32-core box with 16GB gets 32 workers
    // holding a full module graph each. Cap it so the pool is bounded by what
    // the machine can actually hold.
    maxWorkers: 4,
  },
});
