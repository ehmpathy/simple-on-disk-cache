module.exports = {
  globals: {
    'ts-jest': {
      tsConfig: 'tsconfig.json',
    },
  },
  moduleFileExtensions: ['ts', 'js'],
  transform: {
    '^.+\\.(ts|tsx)$': 'ts-jest',
  },
  testMatch: [
    '**/*.test.ts',
    '!**/*.integration.test.ts',
    '!**/*.acceptance.test.ts',
  ],
  testEnvironment: 'node',
};
