/**
 * @fileoverview Diagnostic utilities for enhanced user experience
 * 
 * Provides smart error analysis, problem detection, and actionable suggestions
 * to help users troubleshoot and resolve common issues.
 */

import { FoundryClient } from '../foundry/client.js';
import { config } from '../config/index.js';
import { logger } from './logger.js';

/**
 * Diagnostic result containing problem analysis and suggestions
 */
export interface DiagnosticResult {
  /** Brief explanation of the issue */
  explanation: string;
  /** Actionable suggestions for resolution */
  suggestions: string;
  /** Severity level of the issue */
  severity: 'info' | 'warning' | 'error' | 'critical';
  /** Whether the feature can function with limitations */
  canContinue: boolean;
  /** Link to relevant documentation */
  documentationUrl?: string;
}

/**
 * Health check report for system status
 */
export interface HealthReport {
  connectivity: {
    status: 'connected' | 'limited' | 'offline';
    emoji: string;
    details: string;
  };
  authentication: {
    method: 'api-key' | 'credentials' | 'none';
    status: 'valid' | 'invalid' | 'untested';
    emoji: string;
  };
  features: {
    diceRolling: boolean;
    actorSearch: boolean;
    itemSearch: boolean;
    sceneData: boolean;
    diagnostics: boolean;
  };
  restApiAvailable: boolean;
  websocketAvailable: boolean;
}

/**
 * Enhanced diagnostic system for FoundryVTT MCP integration
 */
export class DiagnosticSystem {
  constructor(private foundryClient: FoundryClient) {}

  /**
   * Diagnose why a specific feature isn't working
   */
  async diagnoseFeatureProblem(feature: 'actors' | 'items' | 'scenes' | 'diagnostics'): Promise<DiagnosticResult> {
    logger.debug(`Diagnosing problem with feature: ${feature}`);

    try {
      // Test basic connectivity
      const isConnected = await this.foundryClient.testConnection();
      
      if (!isConnected) {
        return this.createConnectivityDiagnostic();
      }

      // Test REST API availability
      const hasRestApi = await this.testRestApiAvailability();
      
      if (!hasRestApi && this.requiresRestApi(feature)) {
        return this.createRestApiDiagnostic(feature);
      }

      // Test authentication
      const authResult = await this.testAuthentication();
      
      if (!authResult.valid) {
        return this.createAuthenticationDiagnostic(authResult);
      }

      // Feature-specific diagnostics
      return await this.createFeatureSpecificDiagnostic(feature);

    } catch (error) {
      logger.error('Error during diagnosis:', error);
      return this.createGenericErrorDiagnostic(error);
    }
  }

  /**
   * Perform comprehensive health check
   */
  async performHealthCheck(): Promise<HealthReport> {
    logger.info('Performing system health check');

    const report: HealthReport = {
      connectivity: { status: 'offline', emoji: '❌', details: 'Not tested' },
      authentication: { method: 'none', status: 'untested', emoji: '❓' },
      features: {
        diceRolling: false,
        actorSearch: false,
        itemSearch: false,
        sceneData: false,
        diagnostics: false
      },
      restApiAvailable: false,
      websocketAvailable: false
    };

    try {
      // Test connectivity
      const isConnected = await this.foundryClient.testConnection();
      if (isConnected) {
        report.connectivity = {
          status: 'connected',
          emoji: '✅',
          details: `Connected to ${config.foundry.url}`
        };
      } else {
        report.connectivity = {
          status: 'offline',
          emoji: '❌',
          details: `Cannot reach ${config.foundry.url}`
        };
        return report; // Early return if not connected
      }

      // Test REST API
      report.restApiAvailable = await this.testRestApiAvailability();

      // Test authentication
      const authResult = await this.testAuthentication();
      report.authentication = {
        method: config.foundry.apiKey ? 'api-key' : 'credentials',
        status: authResult.valid ? 'valid' : 'invalid',
        emoji: authResult.valid ? '✅' : '❌'
      };

      // Test individual features
      report.features.diceRolling = await this.testDiceRolling();
      report.features.actorSearch = await this.testActorSearch();
      report.features.itemSearch = await this.testItemSearch();
      report.features.sceneData = await this.testSceneData();
      report.features.diagnostics = report.restApiAvailable;

      // Update connectivity status based on feature availability
      if (report.restApiAvailable) {
        report.connectivity.status = 'connected';
      } else if (report.features.diceRolling) {
        report.connectivity.status = 'limited';
        report.connectivity.emoji = '⚠️';
        report.connectivity.details += ' (Limited functionality - REST API not available)';
      }

    } catch (error) {
      logger.error('Health check failed:', error);
      report.connectivity = {
        status: 'offline',
        emoji: '❌',
        details: `Health check failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }

    return report;
  }

  /**
   * Format health report for user display
   */
  formatHealthReport(report: HealthReport): string {
    let output = '🏥 **FoundryVTT MCP Health Check**\n\n';
    
    output += `**Connection**: ${report.connectivity.status.toUpperCase()} ${report.connectivity.emoji}\n`;
    output += `  ${report.connectivity.details}\n\n`;
    
    output += `**Authentication**: ${report.authentication.method.toUpperCase()} ${report.authentication.emoji}\n`;
    if (report.authentication.status === 'invalid') {
      output += `  ⚠️ Authentication failed - check your credentials\n`;
    }
    output += '\n';
    
    output += `**Available Features**:\n`;
    output += `  • Dice Rolling: ${report.features.diceRolling ? '✅ Working' : '❌ Failed'}\n`;
    output += `  • Actor Search: ${report.features.actorSearch ? '✅ Full access' : '⚠️ Limited/None'}\n`;
    output += `  • Item Search: ${report.features.itemSearch ? '✅ Full access' : '⚠️ Limited/None'}\n`;
    output += `  • Scene Data: ${report.features.sceneData ? '✅ Real data' : '⚠️ Mock data only'}\n`;
    output += `  • System Diagnostics: ${report.features.diagnostics ? '✅ Available' : '❌ Unavailable'}\n\n`;
    
    if (!report.restApiAvailable) {
      output += '💡 **Unlock Full Features**:\n';
      output += '  → Install the "Foundry Local REST API" module in FoundryVTT\n';
      output += '  → Enable the module and configure API key\n';
      output += '  → See setup guide: https://github.com/laurigates/foundryvtt-mcp#setup\n\n';
    }
    
    if (report.connectivity.status === 'offline') {
      output += '🔧 **Troubleshooting Steps**:\n';
      output += '  1. Ensure FoundryVTT is running and accessible\n';
      output += '  2. Check FOUNDRY_URL in your .env file\n';
      output += '  3. Verify network connectivity\n';
      output += '  4. Test with: `npm run test-connection`\n';
    }
    
    return output;
  }

  /**
   * Create diagnostic for connectivity issues
   */
  private createConnectivityDiagnostic(): DiagnosticResult {
    return {
      explanation: 'Unable to connect to FoundryVTT server.',
      suggestions: '• **Check if FoundryVTT is running** - Start FoundryVTT and ensure it\'s accessible\n' +
                   `• **Verify server URL** - Check that \`${config.foundry.url}\` is correct\n` +
                   '• **Test connectivity** - Run \`npm run test-connection\` for detailed diagnostics\n' +
                   '• **Check firewall** - Ensure no firewall is blocking the connection',
      severity: 'critical',
      canContinue: false,
      documentationUrl: 'https://github.com/laurigates/foundryvtt-mcp/blob/main/TROUBLESHOOTING.md#connectivity-issues'
    };
  }

  /**
   * Create diagnostic for REST API issues
   */
  private createRestApiDiagnostic(feature: string): DiagnosticResult {
    return {
      explanation: `${feature.charAt(0).toUpperCase() + feature.slice(1)} search requires the REST API module for full functionality.`,
      suggestions: '• **Install REST API module** - Get it from the FoundryVTT module browser\n' +
                   '• **Enable the module** - Activate it in your world\'s module settings\n' +
                   '• **Configure API key** - Generate and copy the API key from module settings\n' +
                   '• **Update .env file** - Set FOUNDRY_API_KEY with your generated key\n' +
                   '• **Restart MCP server** - Restart to pick up the new configuration',
      severity: 'warning',
      canContinue: true,
      documentationUrl: 'https://github.com/laurigates/foundryvtt-mcp/blob/main/SETUP_GUIDE.md#rest-api-setup'
    };
  }

  /**
   * Create diagnostic for authentication issues
   */
  private createAuthenticationDiagnostic(_authResult: { valid: boolean; error?: string }): DiagnosticResult {
    const isApiKey = !!config.foundry.apiKey;
    
    return {
      explanation: `Authentication failed using ${isApiKey ? 'API key' : 'username/password'}.`,
      suggestions: isApiKey 
        ? '• **Check API key** - Verify the key is correct and hasn\'t expired\n' +
          '• **Regenerate key** - Generate a new API key in FoundryVTT module settings\n' +
          '• **Module status** - Ensure the REST API module is enabled and running\n' +
          '• **Restart FoundryVTT** - Sometimes a restart resolves authentication issues'
        : '• **Check credentials** - Verify username and password are correct\n' +
          '• **User permissions** - Ensure the user has required permissions\n' +
          '• **Case sensitivity** - Check for typos in username (case-sensitive)\n' +
          '• **User status** - Make sure the user account is active',
      severity: 'error',
      canContinue: false,
      documentationUrl: 'https://github.com/laurigates/foundryvtt-mcp/blob/main/TROUBLESHOOTING.md#authentication-issues'
    };
  }

  /**
   * Create feature-specific diagnostic
   */
  private async createFeatureSpecificDiagnostic(feature: string): Promise<DiagnosticResult> {
    return {
      explanation: `Connected with full access, but no ${feature} data found.`,
      suggestions: `• **Check data exists** - Verify that ${feature} exist in your FoundryVTT world\n` +
                   '• **User permissions** - Ensure you have permission to view this data\n' +
                   '• **Module conflicts** - Check if other modules might be interfering\n' +
                   `• **Direct test** - Try accessing ${feature} directly in FoundryVTT`,
      severity: 'info',
      canContinue: true,
      documentationUrl: 'https://github.com/laurigates/foundryvtt-mcp/blob/main/TROUBLESHOOTING.md#empty-results'
    };
  }

  /**
   * Create generic error diagnostic
   */
  private createGenericErrorDiagnostic(_error: unknown): DiagnosticResult {
    return {
      explanation: 'An unexpected error occurred during diagnosis.',
      suggestions: '• **Check logs** - Review server logs for detailed error information\n' +
                   '• **Restart services** - Try restarting both FoundryVTT and the MCP server\n' +
                   '• **Update software** - Ensure all components are up to date\n' +
                   '• **Report issue** - If problem persists, report it on GitHub',
      severity: 'error',
      canContinue: false,
      documentationUrl: 'https://github.com/laurigates/foundryvtt-mcp/issues'
    };
  }

  /**
   * Test if feature requires REST API
   */
  private requiresRestApi(feature: string): boolean {
    return ['actors', 'items', 'diagnostics'].includes(feature);
  }

  /**
   * Test REST API availability
   */
  private async testRestApiAvailability(): Promise<boolean> {
    try {
      const response = await this.foundryClient.get('/api/status');
      return response && response.status === 'ok';
    } catch (error) {
      logger.debug('REST API not available:', error);
      return false;
    }
  }

  /**
   * Test authentication
   */
  private async testAuthentication(): Promise<{ valid: boolean; error?: string }> {
    try {
      if (config.foundry.apiKey) {
        // Test API key authentication
        const response = await this.foundryClient.get('/api/world');
        return { valid: !!response };
      } else {
        // Test credential authentication (via WebSocket)
        await this.foundryClient.connect();
        return { valid: this.foundryClient.isConnected() };
      }
    } catch (error) {
      return { 
        valid: false, 
        error: error instanceof Error ? error.message : 'Unknown authentication error'
      };
    }
  }

  /**
   * Test dice rolling functionality
   */
  private async testDiceRolling(): Promise<boolean> {
    try {
      const result = await this.foundryClient.rollDice('1d20', 'Health check test');
      return typeof result.total === 'number';
    } catch (error) {
      logger.debug('Dice rolling test failed:', error);
      return false;
    }
  }

  /**
   * Test actor search functionality
   */
  private async testActorSearch(): Promise<boolean> {
    try {
      const result = await this.foundryClient.searchActors({ limit: 1 });
      return Array.isArray(result.actors);
    } catch (error) {
      logger.debug('Actor search test failed:', error);
      return false;
    }
  }

  /**
   * Test item search functionality
   */
  private async testItemSearch(): Promise<boolean> {
    try {
      const result = await this.foundryClient.searchItems({ limit: 1 });
      return Array.isArray(result.items);
    } catch (error) {
      logger.debug('Item search test failed:', error);
      return false;
    }
  }

  /**
   * Test scene data functionality
   */
  private async testSceneData(): Promise<boolean> {
    try {
      const result = await this.foundryClient.getCurrentScene();
      return !!result && typeof result.name === 'string';
    } catch (error) {
      logger.debug('Scene data test failed:', error);
      return false;
    }
  }
}