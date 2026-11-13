import type { Config } from 'jest';

// sanitize-html >= 2.18 depends on the ESM-only htmlparser2 family; Jest 29 runs
// CommonJS, so those packages (and only those) are compiled to CJS for tests.
const ESM_DEPS = '(sanitize-html|escape-string-regexp|is-plain-object|htmlparser2|domhandler|domutils|domelementtype|dom-serializer|entities)';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.ts$': 'ts-jest',
    [`node_modules/\\.pnpm/${ESM_DEPS}@.+\\.js$`]: ['ts-jest', { tsconfig: { allowJs: true }, isolatedModules: true }],
  },
  transformIgnorePatterns: [`^(?!.*/node_modules/\\.pnpm/${ESM_DEPS}@).*/node_modules/`],
  collectCoverageFrom: [
    '**/*.service.ts',
    '**/*.guard.ts',
    '**/*.pipe.ts',
    '!**/node_modules/**',
    '!**/dist/**',
  ],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
};

export default config;
