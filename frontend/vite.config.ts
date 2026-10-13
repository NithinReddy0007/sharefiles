import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
// GitHub Pages project site base path is /sharefile/
export default defineConfig({
  plugins: [react()],
  base: '/sharefile/',
  server: {
    port: 5173,
    host: true
  }
})
