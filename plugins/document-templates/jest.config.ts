import type { Config } from 'jest';

// Saving an email template runs @saas/backend's sanitizer, whose sanitize-html is
// ESM-only (with ESM-only htmlparser2 deps); Jest 29 runs CommonJS, so those
// packages (and only those) are compiled to CJS for tests — as in packages/backend.
const ESM_DEPS = '(sanitize-html|escape-string-regexp|is-plain-object|htmlparser2|domhandler|domutils|domelementtype|dom-serializer|entities)';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    // Type-check against @saas/backend *source*, matching the runtime
    // moduleNameMapper below (otherwise ts-jest reads the possibly stale dist
    // typings and rejects exports that exist in src but are not built yet).
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: {
          baseUrl: '.',
          paths: {
            '@saas/backend': ['../../packages/backend/src'],
            '@saas/backend/*': ['../../packages/backend/src/*'],
          },
        },
      },
    ],
    [`node_modules/\\.pnpm/${ESM_DEPS}@.+\\.js$`]: ['ts-jest', { tsconfig: { allowJs: true }, isolatedModules: true }],
  },
  transformIgnorePatterns: [`^(?!.*/node_modules/\\.pnpm/${ESM_DEPS}@).*/node_modules/`],
  collectCoverageFrom: [
    '**/*.controller.ts',
    '**/*.service.ts',
    '!**/node_modules/**',
    '!**/dist/**',
  ],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@saas/backend$': '<rootDir>/../../../packages/backend/src',
    '^@saas/backend/(.*)$': '<rootDir>/../../../packages/backend/src/$1',
    '^@saas/database$': '<rootDir>/../../../packages/database/src',
  },
};

export default config;
