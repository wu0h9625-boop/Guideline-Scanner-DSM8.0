import { defineConfig } from 'vite'
import { resolve } from 'path'
import { readFileSync } from 'fs'

// UI must be built first (npm run build:ui) so dist/index.html exists here.
const uiHtml = readFileSync(resolve(__dirname, 'dist/index.html'), 'utf-8')

export default defineConfig({
  define: {
    // Replaces the `declare const __html__: string` in main.ts with the actual HTML.
    // JSON.stringify produces a double-quoted string with all special chars escaped.
    __html__: JSON.stringify(uiHtml),
  },
  build: {
    // Minification must be OFF: esbuild converts double-quoted strings to template
    // literals, and the HTML content contains backticks (from the inlined React
    // bundle) that would break the template literal string.
    minify: false,
    // Target ES2017 so Figma's plugin sandbox (which doesn't support ES2019+
    // features like optional catch binding) can parse the output correctly.
    target: 'es2017',
    rollupOptions: {
      input: resolve(__dirname, 'src/plugin/main.ts'),
      output: {
        format: 'iife',
        entryFileNames: 'plugin.js',
        inlineDynamicImports: true,
      },
    },
    outDir: 'dist',
    emptyOutDir: false,
  },
})
