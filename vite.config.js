import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const root = path.dirname(fileURLToPath(import.meta.url))

/**
 * Absolute, consistently-cased load paths. Relative ones are resolved against the working
 * directory, and on Windows that can differ in drive-letter case from the path Vite hands Sass.
 * Sass then treats the same file as two modules and emits GOV.UK Frontend twice — once with our
 * $govuk-assets-path and once with the default, which is why the fonts 404 in dev.
 */
const loadPath = (...segments) => path.join(root, ...segments)

export default defineConfig({
  base: '/public',
  build: {
    outDir: '.public',
    manifest: true,
    rolldownOptions: {
      input: {
        htmlAssets: 'src/client/assets.html',
        application: 'src/client/javascripts/application.js',
        applicationCss: 'src/client/stylesheets/application.scss'
      }
    },
    sourcemap: true
  },
  css: {
    preprocessorOptions: {
      scss: {
        api: 'modern-compiler',
        // No NodePackageImporter: Vite's dev CSS pipeline calls findFileUrl on every importer
        // and throws on it. Package imports resolve through loadPaths instead.
        //
        // Our own stylesheets come first so that `@use "govuk-frontend"` picks up the local
        // _govuk-frontend.scss, which applies $govuk-assets-path.
        loadPaths: [
          loadPath('src', 'client', 'stylesheets'),
          loadPath('node_modules'),
          loadPath('src', 'server'),
          loadPath('src', 'server', 'common', 'components'),
          loadPath('src', 'server', 'common', 'templates', 'partials')
        ],
        quietDeps: true,
        sourceMapIncludeSources: true,
        style: 'expanded'
      }
    },
    lightningcss: { errorRecovery: true }
  },
  // Dev server
  server: {
    // Build and test output sits under the project root, so without this a test run triggers
    // hundreds of HMR reloads and can wedge the dev server.
    watch: {
      ignored: ['**/.public/**', '**/coverage/**', '**/.cache/**']
    }
  }
})
