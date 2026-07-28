import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalizedId = id.replace(/\\/g, '/');
          if (normalizedId.includes('/node_modules/recharts/')) {
            return 'recharts-vendor';
          }
          if (
            normalizedId.includes('/node_modules/victory-vendor/') ||
            normalizedId.includes('/node_modules/d3-')
          ) {
            return 'chart-math-vendor';
          }
          return undefined;
        },
      },
    },
  },
  server: {
    host: true,
    proxy: {
      '/api': 'http://127.0.0.1:3000',
    },
  },
});
