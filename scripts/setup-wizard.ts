#!/usr/bin/env node

/**
 * Interactive setup wizard for FoundryVTT MCP Server
 * 
 * This wizard helps users configure their environment and test connectivity
 * to reduce setup friction and improve the onboarding experience.
 */

import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import { config } from '../src/config/index.js';

interface WizardConfig {
  foundryUrl: string;
  apiKey?: string;
  username?: string;
  password?: string;
  authMethod: 'api-key' | 'credentials';
}

class SetupWizard {
  private rl: readline.Interface;
  private config: Partial<WizardConfig> = {};

  constructor() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
  }

  /**
   * Run the complete setup wizard
   */
  async run(): Promise<void> {
    console.log('🧙‍♂️ FoundryVTT MCP Setup Wizard\n');
    console.log('This wizard will help you configure your MCP server connection to FoundryVTT.\n');

    try {
      // Step 1: Detect or configure FoundryVTT URL
      await this.detectFoundryVTT();

      // Step 2: Test basic connectivity
      const isReachable = await this.testConnectivity();
      if (!isReachable) {
        console.log('⚠️ Cannot reach FoundryVTT. Please ensure it\'s running and try again.');
        process.exit(1);
      }

      // Step 3: Choose authentication method
      await this.chooseAuthMethod();

      // Step 4: Configure authentication
      await this.configureAuthentication();

      // Step 5: Test authentication
      await this.testAuthentication();

      // Step 6: Generate .env file
      await this.generateEnvFile();

      // Step 7: Run final validation
      await this.runFinalValidation();

      console.log('\n🎉 Setup completed successfully!');
      console.log('\n📚 Next steps:');
      console.log('   1. Run: npm run build');
      console.log('   2. Run: npm start');
      console.log('   3. Connect your AI client to the MCP server');
      console.log('\n💡 For enhanced features, consider installing the Foundry Local REST API module.');

    } catch (error) {
      console.error('\n❌ Setup failed:', error instanceof Error ? error.message : error);
      console.log('\n📚 For help, see: SETUP_GUIDE.md');
      process.exit(1);
    } finally {
      this.rl.close();
    }
  }

  /**
   * Detect FoundryVTT server or prompt for URL
   */
  private async detectFoundryVTT(): Promise<void> {
    console.log('🔍 Step 1: FoundryVTT Server Detection\n');

    // Ask about setup type first
    console.log('What type of FoundryVTT setup are you connecting to?');
    console.log('1. Local FoundryVTT (running on this machine)');
    console.log('2. Remote FoundryVTT (reverse proxy, cloud hosting, or remote server)');
    console.log('3. I want to enter a custom URL\n');

    const setupType = await this.question('Enter your choice (1, 2, or 3): ');
    
    switch (setupType.trim()) {
      case '1':
        await this.detectLocalFoundryVTT();
        break;
      case '2':
        await this.configureRemoteFoundryVTT();
        break;
      case '3':
        await this.configureCustomFoundryVTT();
        break;
      default:
        console.log('❌ Invalid choice. Defaulting to custom URL entry.\n');
        await this.configureCustomFoundryVTT();
    }
  }

  /**
   * Auto-detect local FoundryVTT installations
   */
  private async detectLocalFoundryVTT(): Promise<void> {
    console.log('🔍 Scanning for local FoundryVTT servers...\n');

    const commonUrls = [
      'http://localhost:30000',
      'http://127.0.0.1:30000',
      'http://localhost:8080',
      'http://localhost:3000'
    ];

    for (const url of commonUrls) {
      if (await this.testUrl(url)) {
        const useDetected = await this.question(`✅ Found FoundryVTT at ${url}. Use this URL? (y/n): `);
        if (useDetected.toLowerCase().startsWith('y')) {
          this.config.foundryUrl = url;
          console.log(`📍 Using: ${url}\n`);
          return;
        }
      }
    }

    console.log('❌ No local FoundryVTT server detected at common ports.');
    await this.configureCustomFoundryVTT();
  }

  /**
   * Configure remote FoundryVTT (reverse proxy, cloud, etc.)
   */
  private async configureRemoteFoundryVTT(): Promise<void> {
    console.log('🌐 Remote FoundryVTT Configuration\n');
    console.log('For remote setups, you\'ll need the full URL including protocol.');
    console.log('Examples:');
    console.log('  • https://dnd.lakuz.com (reverse proxy with HTTPS)');
    console.log('  • http://foundry.example.com (reverse proxy with HTTP)');
    console.log('  • https://my-server.com:8443 (custom port with HTTPS)');
    console.log('  • http://192.168.1.100:30000 (local network IP)\n');

    const remoteUrl = await this.question('🌐 Enter your remote FoundryVTT URL: ');
    
    if (!this.isValidUrl(remoteUrl)) {
      throw new Error('Invalid URL format. Please include protocol (http:// or https://)');
    }

    // Validate it's likely a remote URL
    const parsedUrl = new URL(remoteUrl);
    if (parsedUrl.hostname === 'localhost' || parsedUrl.hostname === '127.0.0.1') {
      console.log('⚠️  Warning: This appears to be a local URL. Make sure this is correct for your setup.');
    }

    this.config.foundryUrl = remoteUrl.trim();
    console.log(`📍 Using: ${this.config.foundryUrl}\n`);
  }

  /**
   * Manual URL entry for custom setups
   */
  private async configureCustomFoundryVTT(): Promise<void> {
    console.log('⚙️ Custom URL Configuration\n');
    console.log('Examples:');
    console.log('  • http://localhost:30000 (local development)');
    console.log('  • https://dnd.lakuz.com (reverse proxy)');
    console.log('  • http://192.168.1.100:30000 (network IP)');
    console.log('  • https://my-foundry.com:8443 (custom port)\n');

    const customUrl = await this.question('🌐 Enter your FoundryVTT URL: ');
    
    if (!this.isValidUrl(customUrl)) {
      throw new Error('Invalid URL format. Please include protocol (http:// or https://)');
    }

    this.config.foundryUrl = customUrl.trim();
    console.log(`📍 Using: ${this.config.foundryUrl}\n`);
  }

  /**
   * Test connectivity to FoundryVTT
   */
  private async testConnectivity(): Promise<boolean> {
    console.log('🔗 Step 2: Testing Connectivity\n');
    
    if (!this.config.foundryUrl) {
      throw new Error('FoundryVTT URL not configured');
    }

    console.log(`Testing connection to ${this.config.foundryUrl}...`);
    
    try {
      const response = await axios.get(this.config.foundryUrl, { 
        timeout: 5000,
        validateStatus: () => true // Accept any status code
      });
      
      if (response.status === 200 || response.status === 401) {
        console.log('✅ FoundryVTT server is reachable\n');
        return true;
      } else {
        console.log(`⚠️ Received status ${response.status} - server may not be FoundryVTT\n`);
        return false;
      }
    } catch (error) {
      console.log(`❌ Connection failed: ${error instanceof Error ? error.message : 'Unknown error'}\n`);
      return false;
    }
  }

  /**
   * Choose authentication method
   */
  private async chooseAuthMethod(): Promise<void> {
    console.log('🔐 Step 3: Authentication Method\n');
    
    console.log('Choose your authentication method:');
    console.log('1. API Key (Recommended - requires Foundry Local REST API module)');
    console.log('2. Username/Password (Basic authentication)\n');

    const choice = await this.question('Enter your choice (1 or 2): ');
    
    switch (choice.trim()) {
      case '1':
        this.config.authMethod = 'api-key';
        console.log('📱 Selected: API Key authentication\n');
        break;
      case '2':
        this.config.authMethod = 'credentials';
        console.log('🔑 Selected: Username/Password authentication\n');
        break;
      default:
        console.log('❌ Invalid choice. Defaulting to API Key method.\n');
        this.config.authMethod = 'api-key';
    }
  }

  /**
   * Configure authentication details
   */
  private async configureAuthentication(): Promise<void> {
    console.log('⚙️ Step 4: Authentication Configuration\n');

    if (this.config.authMethod === 'api-key') {
      console.log('🔧 API Key Setup:');
      console.log('1. Install the "Foundry Local REST API" module in FoundryVTT');
      console.log('2. Enable the module in your world settings');
      console.log('3. Go to Settings → Module Settings → Foundry Local REST API');
      console.log('4. Enable the REST API and copy the generated API key\n');

      this.config.apiKey = await this.question('🔑 Enter your API key: ');
      
      if (!this.config.apiKey?.trim()) {
        throw new Error('API key is required for API key authentication');
      }
    } else {
      console.log('👤 Username/Password Setup:\n');
      
      this.config.username = await this.question('👤 Username: ');
      this.config.password = await this.questionHidden('🔒 Password: ');
      
      if (!this.config.username?.trim() || !this.config.password?.trim()) {
        throw new Error('Both username and password are required');
      }
    }
  }

  /**
   * Test authentication with FoundryVTT
   */
  private async testAuthentication(): Promise<void> {
    console.log('🧪 Step 5: Testing Authentication\n');

    if (!this.config.foundryUrl) {
      throw new Error('FoundryVTT URL not configured');
    }

    console.log('Testing authentication...');

    try {
      if (this.config.authMethod === 'api-key' && this.config.apiKey) {
        // Test API key by accessing a protected endpoint
        const response = await axios.get(`${this.config.foundryUrl}/api/status`, {
          headers: {
            'x-api-key': this.config.apiKey
          },
          timeout: 5000
        });

        if (response.status === 200) {
          console.log('✅ API key authentication successful');
          console.log(`📊 Connected to world: ${response.data.world || 'Unknown'}\n`);
        }
      } else if (this.config.authMethod === 'credentials') {
        // For credentials, we'll just verify they're provided
        // Full authentication test would require WebSocket connection
        console.log('✅ Credentials configured (full test will occur at runtime)\n');
      }
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 401) {
          throw new Error('Authentication failed - check your API key or credentials');
        } else if (error.response?.status === 404) {
          throw new Error('REST API endpoints not found - ensure the module is installed and enabled');
        }
      }
      throw new Error(`Authentication test failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Generate .env configuration file
   */
  private async generateEnvFile(): Promise<void> {
    console.log('📄 Step 6: Generating Configuration\n');

    const envPath = path.join(process.cwd(), '.env');
    const envExamplePath = path.join(process.cwd(), '.env.example');

    let envContent = '';

    // Start with example file if it exists
    if (fs.existsSync(envExamplePath)) {
      envContent = fs.readFileSync(envExamplePath, 'utf-8');
      console.log('📋 Using .env.example as template');
    }

    // Configure required variables
    envContent = this.updateEnvVariable(envContent, 'FOUNDRY_URL', this.config.foundryUrl!);

    if (this.config.authMethod === 'api-key' && this.config.apiKey) {
      envContent = this.updateEnvVariable(envContent, 'FOUNDRY_API_KEY', this.config.apiKey);
      // Remove credentials if they exist
      envContent = this.removeEnvVariable(envContent, 'FOUNDRY_USERNAME');
      envContent = this.removeEnvVariable(envContent, 'FOUNDRY_PASSWORD');
    } else if (this.config.authMethod === 'credentials') {
      envContent = this.updateEnvVariable(envContent, 'FOUNDRY_USERNAME', this.config.username!);
      envContent = this.updateEnvVariable(envContent, 'FOUNDRY_PASSWORD', this.config.password!);
      // Remove API key if it exists
      envContent = this.removeEnvVariable(envContent, 'FOUNDRY_API_KEY');
    }

    // Add generation timestamp
    const timestamp = new Date().toISOString();
    envContent += `\n# Generated by setup wizard on ${timestamp}\n`;

    // Write the file
    fs.writeFileSync(envPath, envContent);
    console.log(`✅ Configuration written to ${envPath}\n`);
  }

  /**
   * Run final validation test
   */
  private async runFinalValidation(): Promise<void> {
    console.log('🎯 Step 7: Final Validation\n');

    console.log('Running final connectivity test...');

    try {
      // Import and test the actual MCP configuration
      const { testConnection } = await import('../scripts/test-connection.js');
      await testConnection();
      console.log('✅ All systems operational!\n');
    } catch (error) {
      console.log(`⚠️ Validation test encountered issues: ${error instanceof Error ? error.message : error}`);
      console.log('The configuration has been saved, but you may need to troubleshoot connectivity.\n');
    }
  }

  // Helper Methods

  private async question(prompt: string): Promise<string> {
    return new Promise((resolve) => {
      this.rl.question(prompt, resolve);
    });
  }

  private async questionHidden(prompt: string): Promise<string> {
    return new Promise((resolve) => {
      process.stdout.write(prompt);
      process.stdin.setRawMode(true);
      
      let input = '';
      const onData = (char: Buffer) => {
        const str = char.toString();
        if (str === '\r' || str === '\n') {
          process.stdin.setRawMode(false);
          process.stdin.removeListener('data', onData);
          process.stdout.write('\n');
          resolve(input);
        } else if (str === '\u0003') {
          // Ctrl+C
          process.exit(1);
        } else if (str === '\u007f') {
          // Backspace
          if (input.length > 0) {
            input = input.slice(0, -1);
            process.stdout.write('\b \b');
          }
        } else {
          input += str;
          process.stdout.write('*');
        }
      };
      
      process.stdin.on('data', onData);
    });
  }

  private async testUrl(url: string): Promise<boolean> {
    try {
      const response = await axios.get(url, { 
        timeout: 2000,
        validateStatus: () => true 
      });
      return response.status === 200 || response.status === 401;
    } catch {
      return false;
    }
  }

  private isValidUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }

  private updateEnvVariable(content: string, key: string, value: string): string {
    const regex = new RegExp(`^${key}=.*$`, 'm');
    const line = `${key}=${value}`;
    
    if (regex.test(content)) {
      return content.replace(regex, line);
    } else {
      return content + `\n${line}`;
    }
  }

  private removeEnvVariable(content: string, key: string): string {
    const regex = new RegExp(`^${key}=.*$\n?`, 'm');
    return content.replace(regex, '');
  }
}

// Run the wizard if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const wizard = new SetupWizard();
  wizard.run().catch(console.error);
}

export { SetupWizard };