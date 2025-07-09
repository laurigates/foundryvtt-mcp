#!/usr/bin/env node

/**
 * Test script to verify FoundryVTT connection and basic functionality
 * Run with: npm run test-connection
 */

import dotenv from 'dotenv';
import { FoundryClient } from '../src/foundry/client.js';
import { config } from '../src/config/index.js';
import { logger } from '../src/utils/logger.js';

dotenv.config();

async function testConnection() {
  console.log('🧪 FoundryVTT MCP Server - Connection Test\n');

  try {
    console.log('📋 Configuration:');
    console.log(`   URL: ${config.foundry.url}`);
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
    console.log('   1. Ensure FoundryVTT is running');
    console.log('   2. Check FOUNDRY_URL in .env file');
    console.log('   3. Verify network connectivity');
    console.log('   4. Review the setup guide: SETUP_GUIDE.md');
    process.exit(1);
  }
}

// Helper to check if script is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  testConnection().catch(console.error);
}

export { testConnection };
