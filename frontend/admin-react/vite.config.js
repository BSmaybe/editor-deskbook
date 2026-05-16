import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API_URL = 'http://localhost:8000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5175,
    proxy: {
      '/api': {
        target: API_URL,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
});
