import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    strictPort: true,
    proxy: {
      '/api': 'http://localhost:5174',
    },
  },
})
