import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
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
