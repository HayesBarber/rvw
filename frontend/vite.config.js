import process from 'node:process'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiUrl =
    env.RVW_API_URL ??
    (env.RVW_PORT ? `http://127.0.0.1:${env.RVW_PORT}` : undefined)

  return {
    plugins: [react()],
    server: apiUrl
      ? {
          proxy: {
            '/api': apiUrl,
          },
        }
      : undefined,
  }
})
