import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
  },
  // ⚠️ FIX: Allow Vite to optimize JS libraries (lz4, snappy, fzstd).
  // Only exclude 'brotli-wasm' because it loads a binary file manually.
  optimizeDeps: {
    exclude: ['brotli-wasm'] 
  },
  assetsInclude: ['**/*.wasm']
});