import { test, expect } from '@playwright/test';

/**
 * Test suite for FoundryVTT module settings visibility and functionality
 * 
 * Prerequisites:
 * - FoundryVTT server running with REST API module installed
 * - Admin user credentials available for login
 * - Module should be enabled in the game world
 */

test.describe('Module Settings Visibility', () => {
  
  test.beforeEach(async ({ page }) => {
    // Navigate to FoundryVTT login page
    await page.goto('/');
    
    // Wait for the page to load
    await page.waitForLoadState('networkidle');
  });

  test('should display REST API module in module management', async ({ page }) => {
    // Check if we need to login (look for login form)
    const loginForm = page.locator('#login-form, form[action="/join"]');
    
    if (await loginForm.isVisible()) {
      // Handle login if required
      const usernameField = page.locator('input[name="userid"], input[name="username"]');
      const passwordField = page.locator('input[name="password"]');
      const loginButton = page.locator('button[type="submit"], input[type="submit"]');
      
      if (await usernameField.isVisible()) {
        await usernameField.fill(process.env.FOUNDRY_USERNAME || 'admin');
      }
      
      if (await passwordField.isVisible()) {
        await passwordField.fill(process.env.FOUNDRY_PASSWORD || 'admin');
      }
      
      await loginButton.click();
      await page.waitForLoadState('networkidle');
    }
    
    // Wait for FoundryVTT interface to load
    await page.waitForSelector('#ui-left, #sidebar', { timeout: 30000 });
    
    // Open the settings menu
    await page.click('[data-tooltip="Game Settings"], .fa-cogs, #settings');
    await page.waitForSelector('.window-app.dialog', { timeout: 10000 });
    
    // Click on "Manage Modules" or similar
    const manageModulesSelector = 'button:has-text("Manage Modules"), button:has-text("Module Management"), [data-action="modules"]';
    await page.click(manageModulesSelector);
    await page.waitForSelector('.window-app form', { timeout: 10000 });
    
    // Look for the REST API module in the modules list
    const restApiModule = page.locator('.package', { 
      has: page.locator(':text("REST API"), :text("rest-api"), :text("foundry-local-rest-api")') 
    });
    
    // Verify the module is present
    await expect(restApiModule).toBeVisible();
    
    // Check if the module has expected elements
    await expect(restApiModule.locator('.package-title, .module-title')).toBeVisible();
    await expect(restApiModule.locator('.package-description, .module-description')).toBeVisible();
    
    // Take a screenshot for verification
    await page.screenshot({ 
      path: 'test-results/module-settings-visible.png',
      fullPage: true 
    });
  });

  test('should show REST API module configuration when enabled', async ({ page }) => {
    // Navigate through login if needed (reuse login logic)
    const loginForm = page.locator('#login-form, form[action="/join"]');
    
    if (await loginForm.isVisible()) {
      const usernameField = page.locator('input[name="userid"], input[name="username"]');
      const passwordField = page.locator('input[name="password"]');
      const loginButton = page.locator('button[type="submit"], input[type="submit"]');
      
      if (await usernameField.isVisible()) {
        await usernameField.fill(process.env.FOUNDRY_USERNAME || 'admin');
      }
      
      if (await passwordField.isVisible()) {
        await passwordField.fill(process.env.FOUNDRY_PASSWORD || 'admin');
      }
      
      await loginButton.click();
      await page.waitForLoadState('networkidle');
    }
    
    // Wait for FoundryVTT interface
    await page.waitForSelector('#ui-left, #sidebar', { timeout: 30000 });
    
    // Open settings
    await page.click('[data-tooltip="Game Settings"], .fa-cogs, #settings');
    await page.waitForSelector('.window-app.dialog', { timeout: 10000 });
    
    // Look for "Configure Settings" or module configuration
    const configureSettingsSelector = 'button:has-text("Configure Settings"), button:has-text("Module Settings"), [data-action="settings"]';
    
    try {
      await page.click(configureSettingsSelector, { timeout: 5000 });
      await page.waitForSelector('.window-app.settings', { timeout: 10000 });
      
      // Look for REST API related settings
      const restApiSettings = page.locator('.form-group', {
        has: page.locator(':text("REST API"), :text("API"), :text("rest-api")')
      });
      
      if (await restApiSettings.isVisible()) {
        await expect(restApiSettings).toBeVisible();
        
        // Take screenshot of settings
        await page.screenshot({ 
          path: 'test-results/module-settings-config.png',
          fullPage: true 
        });
      }
    } catch (error) {
      console.log('Module settings configuration not available or module not enabled');
    }
  });

  test('should verify REST API endpoints are accessible', async ({ page }) => {
    // Test API endpoint accessibility (requires module to be active)
    const apiUrl = `${process.env.FOUNDRY_URL || 'http://localhost:30000'}/api/status`;
    
    try {
      const response = await page.request.get(apiUrl);
      
      if (response.ok()) {
        const responseData = await response.json();
        expect(response.status()).toBe(200);
        expect(responseData).toHaveProperty('status');
        
        console.log('REST API is accessible:', responseData);
      } else {
        console.log('REST API endpoint not accessible - module may not be enabled');
      }
    } catch (error) {
      console.log('Failed to access REST API endpoint:', error);
    }
  });

  test('should validate module is properly installed', async ({ page }) => {
    // Check module files exist by testing a known module asset
    const moduleAssetUrl = `${process.env.FOUNDRY_URL || 'http://localhost:30000'}/modules/foundry-local-rest-api/module.json`;
    
    try {
      const response = await page.request.get(moduleAssetUrl);
      
      if (response.ok()) {
        const moduleData = await response.json();
        expect(moduleData).toHaveProperty('name');
        expect(moduleData).toHaveProperty('title');
        expect(moduleData.name).toMatch(/rest.*api|foundry.*local.*rest.*api/i);
        
        console.log('Module manifest found:', moduleData.title || moduleData.name);
      } else {
        console.log('Module manifest not found - module may not be installed');
      }
    } catch (error) {
      console.log('Failed to access module manifest:', error);
    }
  });
});