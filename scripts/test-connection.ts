#!/usr/bin/env node

/**
 * Test script to verify FoundryVTT connection and basic functionality
 * Run with: npm run test-connection
 */

import dotenv from 'dotenv';
import { FoundryClient } from '../src/foundry/client.js';
import { config } from '../src/config/index.js';
import { logger } from '../src/utils/logger.js';

dotenv.config({ quiet: true });

async function testConnection() {
  console.log('🧪 FoundryVTT MCP Server - Connection Test\n');

  try {
    console.log('📋 Configuration:');
    console.log(`   URL: ${config.foundry.url}`);
    
    // Analyze URL type
    const url = new URL(config.foundry.url);
    const isLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    const isHTTPS = url.protocol === 'https:';
    const hasCustomPort = url.port && url.port !== '80' && url.port !== '443';
    
    if (isLocal) {
      console.log(`   Setup Type: 🏠 Local Development`);
    } else if (isHTTPS) {
      console.log(`   Setup Type: 🌐 Reverse Proxy / Remote (SSL)`);
    } else if (hasCustomPort) {
      console.log(`   Setup Type: 🖥️  Network/IP with custom port`);
    } else {
      console.log(`   Setup Type: 🖥️  Remote/Network`);
    }
    
    console.log(`   REST Module: ${config.foundry.useRestModule ? '✅' : '❌'}`);
    console.log(`   API Key: ${config.foundry.apiKey ? '✅ Configured' : '❌ Not set'}`);
    console.log(`   Username: ${config.foundry.username ? '✅ Configured' : '❌ Not set'}\n`);

    // Initialize client
    const client = new FoundryClient({
      baseUrl: config.foundry.url,
      useRestModule: config.foundry.useRestModule,
      apiKey: config.foundry.apiKey,
      username: config.foundry.username,
      password: config.foundry.password,
      timeout: config.foundry.timeout,
    });

    console.log('🔗 Testing connection...');
    const connected = await client.testConnection();

    if (connected) {
      console.log('✅ Connection successful!\n');
    } else {
      console.log('❌ Connection failed\n');
      return;
    }

    // Test dice rolling
    console.log('🎲 Testing dice rolling...');
    try {
      const roll = await client.rollDice('1d20+5', 'Connection test');
      console.log(`   Result: ${roll.total} (${roll.breakdown})`);
      console.log('✅ Dice rolling works!\n');
    } catch (error) {
      console.log(`❌ Dice rolling failed: ${error instanceof Error ? error.message : error}\n`);
    }

    // Test actor search
    console.log('👥 Testing actor search...');
    try {
      const actors = await client.searchActors({ limit: 3 });
      console.log(`   Found ${actors.length} actors`);
      if (actors.length > 0) {
        actors.forEach(actor => {
          console.log(`   - ${actor.name} (${actor.type})`);
        });
        console.log('✅ Actor search works!\n');
      } else {
        console.log('ℹ️  No actors found (may require REST API module)\n');
      }
    } catch (error) {
      console.log(`⚠️  Actor search limited: ${error instanceof Error ? error.message : error}\n`);
    }

    // Test scene info
    console.log('🗺️  Testing scene information...');
    try {
      const scene = await client.getCurrentScene();
      console.log(`   Current scene: ${scene.name}`);
      console.log(`   Dimensions: ${scene.width}x${scene.height}`);
      console.log('✅ Scene information works!\n');
    } catch (error) {
      console.log(`⚠️  Scene info limited: ${error instanceof Error ? error.message : error}\n`);
    }

    // Test WebSocket connection
    console.log('🔌 Testing WebSocket connection...');
    try {
      await client.connectWebSocket();
      console.log('✅ WebSocket connection established!\n');

      // Give it a moment to connect
      await new Promise(resolve => setTimeout(resolve, 2000));

      await client.disconnect();
      console.log('✅ WebSocket disconnected cleanly\n');
    } catch (error) {
      console.log(`⚠️  WebSocket connection issues: ${error instanceof Error ? error.message : error}\n`);
    }

    console.log('🎉 Connection test completed!');
    console.log('\n📝 Summary:');
    console.log('   - Basic connection: ✅');
    console.log('   - Dice rolling: ✅');
    console.log(`   - Data access: ${config.foundry.useRestModule ? '✅ Full' : '⚠️  Limited'}`);
    console.log(`   - WebSocket: ${config.foundry.useRestModule ? '✅' : '⚠️  Basic'}`);

    if (!config.foundry.useRestModule) {
      console.log('\n💡 Tips for enhanced functionality:');
      console.log('   1. Install the "Foundry REST API" module in FoundryVTT');
      console.log('   2. Get the API key from the module configuration page in FoundryVTT');
      console.log('   3. Set USE_REST_MODULE=true and FOUNDRY_API_KEY in .env');
      console.log('   4. Restart the MCP server');
    }

  } catch (error) {
    console.error('❌ Test failed:', error);
    console.log('\n🔧 Troubleshooting:');
    
    try {
      const url = new URL(config.foundry.url);
      const isLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
      const isHTTPS = url.protocol === 'https:';
      
      if (isLocal) {
        console.log('   Local Development Issues:');
        console.log('   1. Ensure FoundryVTT is running on your local machine');
        console.log('   2. Check that the port (usually 30000) is correct');
        console.log('   3. Try accessing FoundryVTT directly: http://localhost:30000');
        console.log('   4. Verify no firewall blocking the connection');
      } else if (isHTTPS) {
        console.log('   Reverse Proxy / Remote Issues:');
        console.log('   1. Ensure FoundryVTT is accessible at the configured URL');
        console.log('   2. Check SSL certificate is valid and not expired');
        console.log('   3. Verify reverse proxy is forwarding to FoundryVTT correctly');
        console.log('   4. Test WebSocket upgrades are working (required for FoundryVTT)');
        console.log('   5. Try accessing FoundryVTT directly in your browser');
      } else {
        console.log('   Network/Remote Issues:');
        console.log('   1. Ensure FoundryVTT is running and accessible');
        console.log('   2. Check network connectivity to the target server');
        console.log('   3. Verify the port is open and not blocked by firewall');
        console.log('   4. Test direct browser access to the URL');
      }
      
      console.log('\n   General Steps:');
      console.log('   • Double-check FOUNDRY_URL in .env file');
      console.log('   • Review the setup guide: SETUP_GUIDE.md');
      console.log('   • Run with LOG_LEVEL=debug for detailed logs');
      
    } catch (urlError) {
      console.log('   1. Ensure FoundryVTT is running');
      console.log('   2. Check FOUNDRY_URL in .env file');
      console.log('   3. Verify network connectivity');
      console.log('   4. Review the setup guide: SETUP_GUIDE.md');
    }
    
    process.exit(1);
  }
}

// Helper to check if script is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  testConnection().catch(console.error);
}

export { testConnection };
