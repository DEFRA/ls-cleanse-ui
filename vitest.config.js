import { defineConfig, configDefaults } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    clearMocks: true,
    // Set here rather than as a shell prefix in package.json, which only works on a POSIX shell.
    env: {
      AWS_EMF_ENVIRONMENT: 'Local',
      TZ: 'UTC',
      // Ephemeral port, so the suite never collides with a dev server already on 3000.
      PORT: '0'
    },
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.js'],
      exclude: [
        ...configDefaults.exclude,
        '.public',
        'coverage',
        'postcss.config.js',
        'stylelint.config.js',
        'vitest.config.js',
        '.sonarlint',
        'babel.config.cjs'
      ]
    }
  }
})
