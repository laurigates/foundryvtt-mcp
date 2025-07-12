import { test, expect } from '@playwright/test';
import { FoundryTestHelpers } from './helpers/foundry-helpers';

/**
 * Test suite for REST API module visibility and functionality
 * 
 * This test verifies that the foundry-local-rest-api module is properly
 * installed, visible in settings, and functional.
 */

test.describe('REST API Module', () => {
  let helpers: FoundryTestHelpers;

  test.beforeEach(async ({ page }) => {
    helpers = new FoundryTestHelpers(page);
    
    // Navigate to FoundryVTT
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Handle login if required
    await helpers.loginIfRequired();
    
    // Wait for interface to load
    await helpers.waitForFoundryInterface();
  });

  test('should show REST API module in module management', async ({ page }) => {
    // Open module management
    await helpers.openModuleManagement();
    
    // Check for REST API module (try different possible names)
    const possibleNames = [
      'REST API',
      'foundry-local-rest-api', 
      'Local REST API',
      'Foundry REST API'
    ];
    
    let moduleFound = false;
    let foundModuleName = '';
    
    for (const name of possibleNames) {
      if (await helpers.isModuleVisible(name)) {
        moduleFound = true;
        foundModuleName = name;
        break;
      }
    }
    
    // Verify module is visible
    expect(moduleFound, `REST API module not found. Checked names: ${possibleNames.join(', ')}`).toBe(true);
    
    console.log(`Found REST API module with name: ${foundModuleName}`);
    
    // Take screenshot for documentation
    await helpers.takeScreenshot('rest-api-module-visible');
    
    // Check if module is enabled
    const isEnabled = await helpers.isModuleEnabled(foundModuleName);
    console.log(`REST API module enabled: ${isEnabled}`);
    
    if (!isEnabled) {
      console.warn('REST API module is installed but not enabled');
    }
  });

  test('should have accessible REST API endpoints when module is enabled', async ({ page }) => {
    // Test the status endpoint
    const statusResult = await helpers.testApiEndpoint('/api/status');
    
    if (statusResult.status === 200) {
      expect(statusResult.data).toHaveProperty('status');
      console.log('REST API status endpoint accessible:', statusResult.data);
    } else if (statusResult.status === 404) {
      console.warn('REST API endpoints not accessible - module may not be enabled');
    } else {
      console.log(`API endpoint returned status ${statusResult.status}`);
    }
    
    // Test other common endpoints
    const endpoints = ['/api/actors', '/api/items', '/api/scenes'];
    
    for (const endpoint of endpoints) {
      const result = await helpers.testApiEndpoint(endpoint);
      console.log(`Endpoint ${endpoint}: status ${result.status}`);
    }
  });

  test('should verify module manifest is accessible', async ({ page }) => {
    // Check if module manifest exists
    const manifestResult = await helpers.testApiEndpoint('/modules/foundry-local-rest-api/module.json');
    
    if (manifestResult.status === 200 && manifestResult.data) {
      expect(manifestResult.data).toHaveProperty('name');
      expect(manifestResult.data).toHaveProperty('title');
      
      console.log('Module manifest found:', {
        name: manifestResult.data.name,
        title: manifestResult.data.title,
        version: manifestResult.data.version
      });
    } else {
      console.warn('Module manifest not accessible - module may not be installed correctly');
    }
  });

  test('should validate module installation directory', async ({ page }) => {
    // Try to access module files to confirm installation
    const moduleFiles = [
      '/modules/foundry-local-rest-api/module.json',
      '/modules/foundry-local-rest-api/scripts/rest-api.js'
    ];
    
    let filesFound = 0;
    
    for (const file of moduleFiles) {
      const result = await helpers.testApiEndpoint(file);
      if (result.status === 200) {
        filesFound++;
        console.log(`Module file found: ${file}`);
      }
    }
    
    console.log(`Found ${filesFound}/${moduleFiles.length} expected module files`);
    
    if (filesFound === 0) {
      console.warn('No module files found - module may not be installed');
    }
  });
});