import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'
import { selectItemCatalog } from '../config/dotaItemCatalog.js'

const items = selectItemCatalog(
  fileURLToPath(new URL('./src/data/dotaItems.json', import.meta.url)),
  fileURLToPath(new URL('./src/data/dotaItems.generated.json', import.meta.url)),
  console.warn,
)

// https://vite.dev/config/
export default defineConfig({
  resolve: { alias: { '@dota-items': items.path } },
  plugins: [
    react(),
    tailwindcss()
  ],
  server: {
    proxy: {
      '/api': {
      target: 'http://localhost:3000',
      changeOrigin: true,
      secure: false,
      }
    },
  },
})
