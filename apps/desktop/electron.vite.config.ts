import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import pkg from './package.json'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ['nanoid', 'zod', '@ai-sdk/anthropic', '@ai-sdk/openai', '@ai-sdk/provider', '@ai-sdk/provider-utils', '@ai-sdk/gateway', 'ai'] })],
    resolve: {
      alias: {
        '@main': resolve('src/main')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@': resolve('src/renderer/src')
      }
    },
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version)
    },
    plugins: [react()]
  }
})
