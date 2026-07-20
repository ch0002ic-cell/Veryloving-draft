module.exports = {
  rootDir: '.',
  testEnvironment: 'node',
  testMatch: [
    '<rootDir>/server/src/{models,memory,edge,orchestration,scenarios}/**/__tests__/**/*.test.ts',
    '<rootDir>/server/tests/integration/**/*.test.ts'
  ],
  transform: {
    '^.+\\.tsx?$': ['babel-jest', {
      configFile: false,
      babelrc: false,
      presets: ['babel-preset-expo']
    }]
  },
  collectCoverageFrom: [
    'server/src/{models,memory,edge,orchestration,scenarios}/**/*.ts',
    '!server/src/**/__tests__/**',
    '!server/src/scenarios/index.ts'
  ],
  coverageProvider: 'v8',
  coverageDirectory: '<rootDir>/coverage/ai-native',
  coverageReporters: ['text', 'json-summary'],
  coverageThreshold: {
    global: {
      branches: 85,
      functions: 85,
      lines: 85,
      statements: 85
    }
  },
  clearMocks: true,
  restoreMocks: true
};
