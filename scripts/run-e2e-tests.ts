#!/usr/bin/env tsx

/**
 * E2E Test Runner Script
 * 
 * This script helps orchestrate end-to-end testing by:
 * 1. Ensuring FoundryVTT server is running
 * 2. Running Playwright tests
 * 3. Generating reports
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface TestOptions {
  headed?: boolean;
  debug?: boolean;
  ui?: boolean;
  reporter?: string;
}

class E2ETestRunner {
  private foundryUrl: string;
  
  constructor() {
    this.foundryUrl = process.env.FOUNDRY_URL || 'http://localhost:30000';
  }

  /**
   * Check if FoundryVTT server is accessible
   */
  async checkFoundryServer(): Promise<boolean> {
    try {
      const { stdout } = await execAsync(`curl -s -o /dev/null -w "%{http_code}" ${this.foundryUrl}`);
      const statusCode = parseInt(stdout.trim());
      return statusCode >= 200 && statusCode < 400;
    } catch (error) {
      console.warn('Could not check FoundryVTT server status:', error);
      return false;
    }
  }

  /**
   * Wait for FoundryVTT server to be ready
   */
  async waitForFoundryServer(timeout: number = 60000): Promise<boolean> {
    console.log(`Waiting for FoundryVTT server at ${this.foundryUrl}...`);
    
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      if (await this.checkFoundryServer()) {
        console.log('✅ FoundryVTT server is ready');
        return true;
      }
      
      console.log('⏳ Waiting for server...');
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    console.error('❌ FoundryVTT server not ready within timeout');
    return false;
  }

  /**
   * Run Playwright tests with specified options
   */
  async runTests(options: TestOptions = {}): Promise<void> {
    console.log('🧪 Starting E2E tests...');
    
    // Build Playwright command
    let command = 'npx playwright test';
    
    if (options.headed) command += ' --headed';
    if (options.debug) command += ' --debug';
    if (options.ui) command += ' --ui';
    if (options.reporter) command += ` --reporter=${options.reporter}`;
    
    try {
      console.log(`Running: ${command}`);
      const { stdout, stderr } = await execAsync(command);
      
      if (stdout) console.log(stdout);
      if (stderr) console.error(stderr);
      
      console.log('✅ E2E tests completed');
    } catch (error: any) {
      console.error('❌ E2E tests failed:', error.message);
      process.exit(1);
    }
  }

  /**
   * Generate and display test report
   */
  async showReport(): Promise<void> {
    try {
      console.log('📊 Generating test report...');
      await execAsync('npx playwright show-report');
    } catch (error) {
      console.error('Failed to generate report:', error);
    }
  }
}

/**
 * Main execution
 */
async function main() {
  const runner = new E2ETestRunner();
  
  // Parse command line arguments
  const args = process.argv.slice(2);
  const options: TestOptions = {
    headed: args.includes('--headed'),
    debug: args.includes('--debug'),
    ui: args.includes('--ui'),
  };
  
  // Check if server check should be skipped
  const skipServerCheck = args.includes('--skip-server-check');
  
  try {
    // Wait for FoundryVTT server unless skipped
    if (!skipServerCheck) {
      const serverReady = await runner.waitForFoundryServer();
      if (!serverReady) {
        console.error('Please ensure FoundryVTT server is running with: fvtt launch');
        process.exit(1);
      }
    }
    
    // Run tests
    await runner.runTests(options);
    
    // Show report unless in debug/ui mode
    if (!options.debug && !options.ui) {
      await runner.showReport();
    }
    
  } catch (error) {
    console.error('E2E test execution failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { E2ETestRunner };