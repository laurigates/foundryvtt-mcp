import { test, expect } from '@playwright/test';
import { FoundryTestHelpers } from './helpers/foundry-helpers';

/**
 * Test suite to reproduce and debug issue #7: JSON parsing errors
 * 
 * This test specifically targets the malformed JSON error reported by user:
 * "Expected ',' or ']' after array element in JSON at position 5 (line 1 column 6)"
 * 
 * GitHub Issue: https://github.com/laurigates/foundryvtt-mcp/issues/7
 */

test.describe('Issue #7: JSON Parsing Errors', () => {
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

  test('should detect malformed JSON responses from REST API', async ({ page }) => {
    console.log('🔍 Testing for JSON parsing errors in REST API responses...');
    
    // Test common endpoints that might return malformed JSON
    const problematicEndpoints = [
      '/api/actors',
      '/api/items', 
      '/api/scenes',
      '/api/users',
      '/api/world',
      '/api/status'
    ];
    
    const jsonErrors: Array<{endpoint: string, error: string, response: string}> = [];
    
    for (const endpoint of problematicEndpoints) {
      try {
        console.log(`Testing endpoint: ${endpoint}`);
        
        const result = await helpers.testApiEndpoint(endpoint);
        
        // Check if we got a response
        if (result.status === 200) {
          // Try to verify the response is valid JSON by re-parsing it
          try {
            if (typeof result.data === 'string') {
              JSON.parse(result.data);
            } else if (result.data) {
              // Data was already parsed by Playwright, but let's get raw response
              const baseUrl = process.env.FOUNDRY_URL || 'http://localhost:30000';
              const fullUrl = `${baseUrl}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;
              
              const rawResponse = await page.request.get(fullUrl);
              const rawText = await rawResponse.text();
              
              console.log(`Raw response for ${endpoint} (first 100 chars):`, rawText.substring(0, 100));
              
              // Try parsing the raw response
              JSON.parse(rawText);
            }
          } catch (parseError) {
            console.error(`❌ JSON parsing error for ${endpoint}:`, parseError);
            
            // Get raw response for debugging
            const baseUrl = process.env.FOUNDRY_URL || 'http://localhost:30000';
            const fullUrl = `${baseUrl}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;
            
            const rawResponse = await page.request.get(fullUrl);
            const rawText = await rawResponse.text();
            
            jsonErrors.push({
              endpoint,
              error: parseError instanceof Error ? parseError.message : String(parseError),
              response: rawText.substring(0, 200) // First 200 chars for debugging
            });
          }
        } else if (result.status === 0) {
          console.warn(`⚠️ Network error for ${endpoint}: ${result.error}`);
        } else {
          console.log(`ℹ️ Non-200 response for ${endpoint}: ${result.status}`);
        }
        
        // Small delay between requests to avoid overwhelming the server
        await page.waitForTimeout(500);
        
      } catch (error) {
        console.error(`❌ Error testing ${endpoint}:`, error);
        jsonErrors.push({
          endpoint,
          error: error instanceof Error ? error.message : String(error),
          response: 'Failed to get response'
        });
      }
    }
    
    // Report findings
    if (jsonErrors.length > 0) {
      console.log('\n🚨 JSON Parsing Errors Detected:');
      for (const error of jsonErrors) {
        console.log(`\nEndpoint: ${error.endpoint}`);
        console.log(`Error: ${error.error}`);
        console.log(`Response Preview: ${error.response}`);
      }
      
      // Take screenshot for debugging
      await helpers.takeScreenshot('json-parsing-errors');
      
      // This test should fail if we detect JSON errors, as they indicate the bug from issue #7
      expect(jsonErrors.length, `Found ${jsonErrors.length} endpoints with JSON parsing errors. This reproduces issue #7.`).toBe(0);
    } else {
      console.log('✅ No JSON parsing errors detected in REST API responses');
    }
  });

  test('should validate specific array response formats', async ({ page }) => {
    console.log('🔍 Testing array response formats that might cause parsing errors...');
    
    // The error message suggests issues with array formatting: "Expected ',' or ']' after array element"
    const arrayEndpoints = [
      '/api/actors',
      '/api/items',
      '/api/scenes'
    ];
    
    for (const endpoint of arrayEndpoints) {
      const result = await helpers.testApiEndpoint(endpoint);
      
      if (result.status === 200) {
        // Get raw response to check for malformed arrays
        const baseUrl = process.env.FOUNDRY_URL || 'http://localhost:30000';
        const fullUrl = `${baseUrl}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;
        
        const rawResponse = await page.request.get(fullUrl);
        const rawText = await rawResponse.text();
        
        console.log(`\nTesting ${endpoint}:`);
        console.log(`Response length: ${rawText.length} characters`);
        console.log(`Starts with: ${rawText.substring(0, 50)}`);
        console.log(`Ends with: ${rawText.substring(rawText.length - 50)}`);
        
        // Check for common JSON array malformation patterns
        const malformationPatterns = [
          /\[\s*,/,              // Array starting with comma
          /,\s*\]/,              // Array ending with comma  
          /,\s*,/,               // Double commas
          /\}\s*\{/,             // Missing comma between objects
          /\[\s*\{[^}]*$/,       // Unclosed object in array
          /^[^[]*\]/,            // Closing bracket without opening
        ];
        
        for (const pattern of malformationPatterns) {
          if (pattern.test(rawText)) {
            console.error(`❌ Malformed array pattern detected in ${endpoint}: ${pattern}`);
            await helpers.takeScreenshot(`malformed-array-${endpoint.replace('/', '-')}`);
            
            expect(false, `Malformed array pattern detected in ${endpoint}: ${pattern.toString()}`).toBe(true);
          }
        }
        
        // Verify it's actually a valid JSON array
        try {
          const parsed = JSON.parse(rawText);
          if (Array.isArray(parsed)) {
            console.log(`✅ ${endpoint} returned valid JSON array with ${parsed.length} items`);
          } else {
            console.log(`ℹ️ ${endpoint} returned valid JSON but not an array: ${typeof parsed}`);
          }
        } catch (error) {
          console.error(`❌ JSON parsing failed for ${endpoint}:`, error);
          throw error;
        }
      }
      
      await page.waitForTimeout(300);
    }
  });

  test('should test REST API during module initialization timing', async ({ page }) => {
    console.log('🔍 Testing REST API responses during module initialization...');
    
    // Navigate to module management to trigger potential timing issues
    await helpers.openModuleManagement();
    
    // Look for the REST API module
    const restApiModuleNames = [
      'REST API',
      'foundry-local-rest-api',
      'Local REST API',
      'Foundry REST API'
    ];
    
    let foundModule = false;
    let moduleEnabled = false;
    
    for (const name of restApiModuleNames) {
      if (await helpers.isModuleVisible(name)) {
        foundModule = true;
        moduleEnabled = await helpers.isModuleEnabled(name);
        console.log(`Found REST API module: ${name}, enabled: ${moduleEnabled}`);
        break;
      }
    }
    
    if (!foundModule) {
      console.warn('⚠️ REST API module not found - skipping timing test');
      return;
    }
    
    if (moduleEnabled) {
      // Test API immediately after finding enabled module
      console.log('Testing API response timing while module is already enabled...');
      
      // Make rapid successive calls to test for timing issues
      const rapidTestPromises = [
        helpers.testApiEndpoint('/api/status'),
        helpers.testApiEndpoint('/api/actors'),
        helpers.testApiEndpoint('/api/items')
      ];
      
      try {
        const results = await Promise.all(rapidTestPromises);
        
        results.forEach((result, index) => {
          const endpoints = ['/api/status', '/api/actors', '/api/items'];
          console.log(`Rapid test ${index + 1} (${endpoints[index]}): Status ${result.status}`);
          
          if (result.error) {
            console.error(`❌ Error in rapid test ${index + 1}:`, result.error);
          }
        });
        
      } catch (error) {
        console.error('❌ Rapid API testing failed:', error);
        await helpers.takeScreenshot('rapid-api-test-failure');
        
        // This might be the timing issue from the GitHub issue
        expect(false, `Rapid API testing failed - potential timing issue: ${error}`).toBe(true);
      }
    }
  });

  test('should capture console errors related to REST API', async ({ page }) => {
    console.log('🔍 Monitoring console for REST API related errors...');
    
    const restApiErrors: string[] = [];
    
    // Listen for console errors
    page.on('console', msg => {
      if (msg.type() === 'error') {
        const text = msg.text();
        
        // Look for errors related to REST API or JSON parsing
        if (text.includes('REST API') || 
            text.includes('JSON') || 
            text.includes('Cannot read properties of undefined') ||
            text.includes('Expected') && text.includes('JSON')) {
          
          console.error(`🚨 Console Error: ${text}`);
          restApiErrors.push(text);
        }
      }
    });
    
    // Navigate around to trigger potential console errors
    await helpers.openSettings();
    await page.waitForTimeout(2000);
    
    await helpers.openModuleManagement();
    await page.waitForTimeout(2000);
    
    // Test a few API endpoints
    await helpers.testApiEndpoint('/api/status');
    await page.waitForTimeout(1000);
    
    await helpers.testApiEndpoint('/api/actors');
    await page.waitForTimeout(1000);
    
    // Report any REST API related errors found
    if (restApiErrors.length > 0) {
      console.log('\n🚨 REST API Console Errors Detected:');
      restApiErrors.forEach((error, index) => {
        console.log(`${index + 1}. ${error}`);
      });
      
      await helpers.takeScreenshot('rest-api-console-errors');
      
      // Document the errors but don't fail the test unless they're critical
      console.warn(`Found ${restApiErrors.length} REST API related console errors`);
    } else {
      console.log('✅ No REST API related console errors detected');
    }
  });
});