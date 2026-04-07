import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  base: '/',
  build: {
    rollupOptions: {
      input: {
        controller: resolve(__dirname, 'src/controller/index.html'),
        display: resolve(__dirname, 'src/display/index.html'),
      },
    },
    outDir: 'dist',
  },
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
    },
  },
})
