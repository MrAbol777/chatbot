import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/video-generation/**/*.test.{ts,tsx}', 'src/admin/ai-routing/**/*.test.{ts,tsx}', 'src/noa/**/*.test.{ts,tsx}', 'src/AdminPanel.test.tsx', 'src/Landing.test.tsx'],
    clearMocks: true,
    restoreMocks: true,
    coverage: { provider: 'v8', include: ['src/video-generation/**/*.{ts,tsx}'], exclude: ['src/video-generation/**/*.test.{ts,tsx}'], thresholds: { statements: 80, branches: 70, functions: 80, lines: 80 } }
  }
});
