import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        // three.js num arquivo próprio: muda raramente, então fica em cache entre deploys.
        manualChunks: { three: ['three'] },
      },
    },
  },
});
