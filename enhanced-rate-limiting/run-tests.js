/**
 * Test Runner for Durable Object Rate Limiter
 * 
 * Simple Node.js runner that executes the comprehensive test suite
 * and provides formatted output for validation of the refactoring.
 * 
 * Usage:
 *   node run-tests.js
 *   node run-tests.js --verbose
 *   node run-tests.js --suite integration
 * 
 * @version 1.0.0
 * @since 2025-06-24
 */

import { runAllTests, testDurableObjectIntegration, testRaceConditionElimination, testFallbackMechanism, testBackwardCompatibility, testFactoryFunctions, testIntegration } from './test-durable-object-rate-limiter.js';

// Parse command line arguments
const args = process.argv.slice(2);
const verbose = args.includes('--verbose') || args.includes('-v');
const suiteArg = args.find(arg => arg.startsWith('--suite='));
const specificSuite = suiteArg ? suiteArg.split('=')[1] : null;

// Test suite mapping
const testSuites = {
  'integration': testDurableObjectIntegration,
  'race-condition': testRaceConditionElimination,
  'fallback': testFallbackMechanism,
  'compatibility': testBackwardCompatibility,
  'factory': testFactoryFunctions,
  'end-to-end': testIntegration
};

async function main() {
  console.log('🔧 Durable Object Rate Limiter Test Runner');
  console.log('=' .repeat(50));
  
  if (verbose) {
    console.log('Verbose mode enabled');
  }
  
  if (specificSuite) {
    if (testSuites[specificSuite]) {
      console.log(`Running specific test suite: ${specificSuite}`);
      try {
        await testSuites[specificSuite]();
        console.log(`\n✅ Suite '${specificSuite}' completed successfully`);
      } catch (error) {
        console.error(`\n❌ Suite '${specificSuite}' failed:`, error.message);
        process.exit(1);
      }
    } else {
      console.error(`\n❌ Unknown test suite: ${specificSuite}`);
      console.log('Available suites:', Object.keys(testSuites).join(', '));
      process.exit(1);
    }
  } else {
    console.log('Running all test suites...\n');
    await runAllTests();
  }
}

// Handle errors gracefully
process.on('uncaughtException', (error) => {
  console.error('\n💥 Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('\n💥 Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Run the tests
main().catch(error => {
  console.error('\n💥 Test runner failed:', error);
  process.exit(1);
});