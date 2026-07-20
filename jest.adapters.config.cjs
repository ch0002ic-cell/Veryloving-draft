module.exports = {
  rootDir: '.',
  testEnvironment: 'node',
  testMatch: [
    '<rootDir>/server/src/adapters/**/__tests__/**/*.test.ts',
    '<rootDir>/server/mocks/**/__tests__/**/*.test.ts'
  ],
  transform: {
    '^.+\\.tsx?$': ['babel-jest', {
      configFile: false,
      babelrc: false,
      presets: ['babel-preset-expo']
    }]
  },
  collectCoverageFrom: [
    'server/src/adapters/**/*.ts',
    '!server/src/adapters/RobotAdapter.ts',
    '!server/src/adapters/index.ts'
  ],
  coverageProvider: 'v8',
  coverageDirectory: '<rootDir>/coverage/adapters',
  coverageReporters: ['text', 'json-summary'],
  coverageThreshold: {
    global: {
      branches: 90,
      functions: 90,
      lines: 90,
      statements: 90
    }
  },
  clearMocks: true,
  restoreMocks: true
};
