import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    restoreMocks: true,
    clearMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
      reportsDirectory: './coverage',
      // Ratchet: raise these, never lower them to make CI pass.
      thresholds: {
        statements: 63,
        branches: 57,
        functions: 62,
        lines: 64,
      },
    },
  },
})
