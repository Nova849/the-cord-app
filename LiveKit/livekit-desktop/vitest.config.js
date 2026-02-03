const { defineConfig } = require('vitest/config');

module.exports = defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.js']
  }
});
