import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  base: '/weblink/',
  plugins: [react()],
  publicDir: false,
})
