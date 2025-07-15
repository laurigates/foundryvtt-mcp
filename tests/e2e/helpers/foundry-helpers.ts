import { Page, expect } from '@playwright/test';

/**
 * Helper functions for FoundryVTT Playwright tests
 */

export class FoundryTestHelpers {
  constructor(private page: Page) {}

  /**
   * Handle FoundryVTT login if login form is present
   */
  async loginIfRequired(): Promise<void> {
    const loginForm = this.page.locator('#login-form, form[action="/join"]');
    
    if (await loginForm.isVisible()) {
      const usernameField = this.page.locator('input[name="userid"], input[name="username"]');
      const passwordField = this.page.locator('input[name="password"]');
      const loginButton = this.page.locator('button[type="submit"], input[type="submit"]');
      
      if (await usernameField.isVisible()) {
        await usernameField.fill(process.env.FOUNDRY_USERNAME || 'admin');
      }
      
      if (await passwordField.isVisible()) {
        await passwordField.fill(process.env.FOUNDRY_PASSWORD || 'admin');
      }
      
      await loginButton.click();
      await this.page.waitForLoadState('networkidle');
    }
  }

  /**
   * Wait for FoundryVTT interface to fully load
   */
  async waitForFoundryInterface(): Promise<void> {
    // Wait for main UI elements to be present
    await this.page.waitForSelector('#ui-left, #sidebar', { timeout: 30000 });
    
    // Optional: wait for specific FoundryVTT elements that indicate full load
    try {
      await this.page.waitForSelector('#players, #navigation', { timeout: 10000 });
    } catch {
      // Some elements may not be present depending on FoundryVTT version
    }
  }

  /**
   * Open the FoundryVTT settings dialog
   */
  async openSettings(): Promise<void> {
    await this.page.click('[data-tooltip="Game Settings"], .fa-cogs, #settings');
    await this.page.waitForSelector('.window-app.dialog, .settings-sidebar', { timeout: 10000 });
  }

  /**
   * Navigate to module management
   */
  async openModuleManagement(): Promise<void> {
    await this.openSettings();
    
    const manageModulesSelector = 'button:has-text("Manage Modules"), button:has-text("Module Management"), [data-action="modules"]';
    await this.page.click(manageModulesSelector);
    await this.page.waitForSelector('.window-app form, .package-list', { timeout: 10000 });
  }

  /**
   * Check if a module is visible in the module list
   */
  async isModuleVisible(moduleName: string): Promise<boolean> {
    const moduleSelector = `.package:has-text("${moduleName}"), .module:has-text("${moduleName}")`;
    return await this.page.locator(moduleSelector).isVisible();
  }

  /**
   * Check if a module is enabled
   */
  async isModuleEnabled(moduleName: string): Promise<boolean> {
    const moduleLocator = this.page.locator('.package, .module').filter({ hasText: moduleName });
    const checkbox = moduleLocator.locator('input[type="checkbox"]');
    
    if (await checkbox.isVisible()) {
      return await checkbox.isChecked();
    }
    
    return false;
  }

  /**
   * Take a screenshot with timestamp
   */
  async takeScreenshot(name: string, options?: { fullPage?: boolean }): Promise<void> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `test-results/${name}-${timestamp}.png`;
    
    await this.page.screenshot({ 
      path: filename,
      fullPage: options?.fullPage ?? true 
    });
  }

  /**
   * Test REST API endpoint accessibility
   */
  async testApiEndpoint(endpoint: string): Promise<{ status: number; data?: any; error?: string }> {
    const baseUrl = process.env.FOUNDRY_URL || 'http://localhost:30000';
    const fullUrl = `${baseUrl}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;
    
    try {
      const response = await this.page.request.get(fullUrl);
      const data = response.ok() ? await response.json() : null;
      
      return {
        status: response.status(),
        data
      };
    } catch (error) {
      return {
        status: 0,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Test REST API endpoint and return raw response for JSON parsing validation
   */
  async testApiEndpointRaw(endpoint: string): Promise<{ 
    status: number; 
    rawText: string; 
    parsedData?: any; 
    parseError?: string;
    contentType?: string;
  }> {
    const baseUrl = process.env.FOUNDRY_URL || 'http://localhost:30000';
    const fullUrl = `${baseUrl}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;
    
    try {
      const response = await this.page.request.get(fullUrl);
      const rawText = await response.text();
      const contentType = response.headers()['content-type'] || 'unknown';
      
      let parsedData;
      let parseError;
      
      // Attempt to parse JSON
      if (contentType.includes('application/json') || rawText.trim().startsWith('{') || rawText.trim().startsWith('[')) {
        try {
          parsedData = JSON.parse(rawText);
        } catch (error) {
          parseError = error instanceof Error ? error.message : 'JSON parse error';
        }
      }
      
      return {
        status: response.status(),
        rawText,
        parsedData,
        parseError,
        contentType
      };
    } catch (error) {
      return {
        status: 0,
        rawText: '',
        parseError: error instanceof Error ? error.message : 'Network error'
      };
    }
  }

  /**
   * Validate JSON array format specifically for issue #7 debugging
   */
  async validateJsonArrayFormat(rawJson: string): Promise<{
    isValid: boolean;
    errors: string[];
    patterns: string[];
  }> {
    const errors: string[] = [];
    const patterns: string[] = [];
    
    // Check for malformation patterns that could cause "Expected ',' or ']'" errors
    const malformationChecks = [
      { pattern: /\[\s*,/, description: 'Array starts with comma' },
      { pattern: /,\s*\]/, description: 'Array ends with comma' },
      { pattern: /,\s*,/, description: 'Double commas in array' },
      { pattern: /\}\s*\{/, description: 'Missing comma between objects' },
      { pattern: /\[\s*\{[^}]*$/, description: 'Unclosed object in array' },
      { pattern: /^[^[]*\]/, description: 'Closing bracket without opening' },
      { pattern: /\[\s*[^{\]"]/, description: 'Invalid array start' },
    ];
    
    for (const check of malformationChecks) {
      if (check.pattern.test(rawJson)) {
        errors.push(check.description);
        patterns.push(check.pattern.toString());
      }
    }
    
    // Try to parse and get specific parsing error
    try {
      JSON.parse(rawJson);
    } catch (parseError) {
      if (parseError instanceof Error) {
        errors.push(`Parse error: ${parseError.message}`);
      }
    }
    
    return {
      isValid: errors.length === 0,
      errors,
      patterns
    };
  }

  /**
   * Wait for a specific condition with timeout
   */
  async waitForCondition(
    condition: () => Promise<boolean>, 
    timeout: number = 10000,
    interval: number = 500
  ): Promise<boolean> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      if (await condition()) {
        return true;
      }
      await this.page.waitForTimeout(interval);
    }
    
    return false;
  }
}