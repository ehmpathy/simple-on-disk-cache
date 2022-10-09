// For a detailed explanation regarding each configuration property, visit:
// https://jestjs.io/docs/en/configuration.html

module.exports = {
  // define globals that we will need defined
  globals: {
    'ts-jest': {
      tsConfig: 'tsconfig.json',
    },
  },

  // define module file extensions
  moduleFileExtensions: ['ts', 'js'],

  // describe transformation
  transform: {
    '^.+\\.(js|jsx)$': 'babel-jest',
    '^.+\\.(ts|tsx)$': 'ts-jest',
  },

  // The test environment that will be used for testing
  testEnvironment: 'node',

  // The glob patterns Jest uses to detect test files
  testMatch: ['**/*.integration.test.ts'],

  // An array of regexp pattern strings that are matched against all test paths, matched tests are skipped
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],

  verbose: true, // Indicates whether each individual test should be reported during the run

  setupFilesAfterEnv: ['./jest.integration.env.js'],
};
