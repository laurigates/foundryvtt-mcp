#!/usr/bin/env node

/**
 * Diagnostic script to test FoundryVTT REST API module endpoints
 * Run with: npx tsx scripts/diagnose-api.ts
 */

import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const FOUNDRY_URL = process.env.FOUNDRY_URL || 'https://dnd.lakuz.com';
const API_KEY = process.env.FOUNDRY_API_KEY;

interface TestResult {
  endpoint: string;
  method: string;
  status: 'PASS' | 'FAIL' | 'SKIP';
  statusCode?: number;
  error?: string;
  response?: any;
  authRequired: boolean;
}

async function testEndpoint(
  endpoint: string,
  method: 'GET' | 'POST' = 'GET',
  data?: any,
  authRequired: boolean = true
): Promise<TestResult> {
  const url = `${FOUNDRY_URL}${endpoint}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'FoundryMCP-Diagnostic/1.0'
  };

  // Add auth header if required and available
  if (authRequired && API_KEY) {
    headers['x-api-key'] = API_KEY;
  }

  try {
    const response = await axios({
      method,
      url,
      headers,
      data,
      timeout: 10000,
      validateStatus: () => true // Don't throw on HTTP error codes
    });

    return {
      endpoint,
      method,
      status: response.status < 400 ? 'PASS' : 'FAIL',
      statusCode: response.status,
      response: response.data,
      authRequired
    };
  } catch (error) {
    return {
      endpoint,
      method,
      status: 'FAIL',
      error: error instanceof Error ? error.message : String(error),
      authRequired
    };
  }
}

async function runDiagnostics() {
  console.log('🔍 FoundryVTT REST API Module Diagnostics\n');
  
  console.log('📋 Configuration:');
  console.log(`   URL: ${FOUNDRY_URL}`);
  console.log(`   API Key: ${API_KEY ? '✅ Configured' : '❌ Not set'}\n`);

  const tests: Array<{
    name: string;
    endpoint: string;
    method: 'GET' | 'POST';
    data?: any;
    authRequired: boolean;
  }> = [
    {
      name: 'Status Endpoint (No Auth)',
      endpoint: '/api/status',
      method: 'GET',
      authRequired: false
    },
    {
      name: 'Actor Search',
      endpoint: '/api/actors',
      method: 'GET',
      authRequired: true
    },
    {
      name: 'Actor Search with Query',
      endpoint: '/api/actors?query=test&limit=1',
      method: 'GET',
      authRequired: true
    },
    {
      name: 'Item Search',
      endpoint: '/api/items',
      method: 'GET',
      authRequired: true
    },
    {
      name: 'Dice Roll',
      endpoint: '/api/dice/roll',
      method: 'POST',
      data: { formula: '1d20', reason: 'Diagnostic test' },
      authRequired: true
    },
    {
      name: 'Current Scene',
      endpoint: '/api/scenes/current',
      method: 'GET',
      authRequired: true
    },
    {
      name: 'World Info',
      endpoint: '/api/world',
      method: 'GET',
      authRequired: true
    },
    {
      name: 'Diagnostics Logs',
      endpoint: '/api/diagnostics/logs?lines=1',
      method: 'GET',
      authRequired: true
    }
  ];

  const results: TestResult[] = [];

  for (const test of tests) {
    if (test.authRequired && !API_KEY) {
      results.push({
        endpoint: test.endpoint,
        method: test.method,
        status: 'SKIP',
        error: 'No API key configured',
        authRequired: true
      });
      continue;
    }

    console.log(`Testing ${test.name}...`);
    const result = await testEndpoint(test.endpoint, test.method, test.data, test.authRequired);
    results.push(result);
    
    // Add small delay between requests
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  console.log('\n📊 Test Results:');
  console.log('================\n');

  let passCount = 0;
  let failCount = 0;
  let skipCount = 0;

  for (const result of results) {
    const icon = result.status === 'PASS' ? '✅' : result.status === 'FAIL' ? '❌' : '⏭️';
    const auth = result.authRequired ? '🔐' : '🔓';
    
    console.log(`${icon} ${auth} ${result.method} ${result.endpoint}`);
    
    if (result.statusCode) {
      console.log(`   Status: ${result.statusCode}`);
    }
    
    if (result.error) {
      console.log(`   Error: ${result.error}`);
    }
    
    if (result.response && result.status === 'PASS') {
      // Show a preview of successful responses
      if (typeof result.response === 'object') {
        const keys = Object.keys(result.response);
        console.log(`   Response keys: ${keys.slice(0, 5).join(', ')}${keys.length > 5 ? '...' : ''}`);
      }
    }
    
    console.log();
    
    if (result.status === 'PASS') passCount++;
    else if (result.status === 'FAIL') failCount++;
    else skipCount++;
  }

  console.log('📈 Summary:');
  console.log(`   ✅ Passed: ${passCount}`);
  console.log(`   ❌ Failed: ${failCount}`);
  console.log(`   ⏭️  Skipped: ${skipCount}`);
  console.log(`   📊 Total: ${results.length}\n`);

  // Analyze results and provide recommendations
  const statusTest = results.find(r => r.endpoint === '/api/status');
  const authTests = results.filter(r => r.authRequired && r.status !== 'SKIP');
  
  console.log('🔍 Analysis:');
  
  if (statusTest?.status === 'PASS') {
    console.log('   ✅ FoundryVTT server is accessible');
    console.log('   ✅ REST API module is likely installed');
  } else if (statusTest?.status === 'FAIL') {
    console.log('   ❌ FoundryVTT server connection issues');
    console.log('   💡 Check if FoundryVTT is running and accessible');
  }
  
  if (authTests.length > 0) {
    const authPassed = authTests.filter(r => r.status === 'PASS').length;
    const authFailed = authTests.filter(r => r.status === 'FAIL').length;
    
    if (authPassed > 0) {
      console.log('   ✅ API authentication is working');
      console.log('   ✅ REST API module is properly configured');
    } else if (authFailed > 0) {
      console.log('   ❌ API authentication issues detected');
      const auth404 = authTests.filter(r => r.statusCode === 404).length;
      const auth401 = authTests.filter(r => r.statusCode === 401).length;
      
      if (auth404 > 0) {
        console.log('   💡 HTTP 404 errors suggest REST API module not enabled');
        console.log('   💡 Check FoundryVTT module settings');
      }
      if (auth401 > 0) {
        console.log('   💡 HTTP 401 errors suggest invalid API key');
        console.log('   💡 Check API key configuration');
      }
    }
  }
  
  if (skipCount > 0) {
    console.log('   ⚠️  Some tests skipped due to missing API key');
    console.log('   💡 Set FOUNDRY_API_KEY environment variable');
  }

  console.log('\n🔧 Troubleshooting Steps:');
  console.log('1. Verify FoundryVTT is running and accessible');
  console.log('2. Check if "Foundry REST API" module is installed');
  console.log('3. Enable "REST API" in module settings');
  console.log('4. Copy API key from module settings');
  console.log('5. Set FOUNDRY_API_KEY environment variable');
  console.log('6. Restart FoundryVTT if needed');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runDiagnostics().catch(console.error);
}

export { runDiagnostics };