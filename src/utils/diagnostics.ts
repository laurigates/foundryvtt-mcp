/**
 * @fileoverview Diagnostic utilities for enhanced user experience
 *
 * Provides smart error analysis, problem detection, and actionable suggestions
 * to help users troubleshoot and resolve common issues.
 */

import { config } from '../config/index.js';
import { probeRestModule, RestKeyRejectedError } from '../foundry/rest-probe.js';
import type { FoundryCore, FoundryProvider } from '../providers/types.js';
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

/** Where the optional REST bridge (module + bridge server) lives (#327). */
const REST_BRIDGE_REPO = 'https://github.com/laurigates/foundryvtt-local-rest-api';
/** Manifest URL to paste into Foundry's module installer (latest release). */
const REST_BRIDGE_MANIFEST = `${REST_BRIDGE_REPO}/releases/latest/download/module.json`;
/** The setup notes for the REST bridge. */
const REST_BRIDGE_GUIDE =
  'https://github.com/laurigates/foundryvtt-mcp/blob/main/docs/guides/configuration.md#optional-rest-bridge-augment';

/**
 * Enhanced diagnostic system for FoundryVTT MCP integration
 */
export class DiagnosticSystem {
  constructor(
    private provider: FoundryCore & Partial<Pick<FoundryProvider, 'kind' | 'capabilities'>>,
    private connection: {
      url: string;
      apiKey?: string | undefined;
      username?: string | undefined;
      password?: string | undefined;
    } = config.foundry,
  ) {}

  /**
   * Diagnose why a specific feature isn't working
   */
  async diagnoseFeatureProblem(
    feature: 'actors' | 'items' | 'scenes' | 'diagnostics',
  ): Promise<DiagnosticResult> {
    logger.debug(`Diagnosing problem with feature: ${feature}`);

    try {
      // Test basic connectivity
      const isConnected = await this.provider.testConnection();

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
      // testConnection() throws on a rejected FOUNDRY_API_KEY (#288); that is
      // an authentication failure, not an unexpected error (#301).
      if (error instanceof RestKeyRejectedError) {
        return this.createAuthenticationDiagnostic({ valid: false, error: error.message });
      }
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
        diagnostics: false,
      },
      restApiAvailable: false,
      websocketAvailable: false,
    };

    try {
      // Test connectivity
      const isConnected = await this.provider.testConnection();
      if (isConnected) {
        report.connectivity = {
          status: 'connected',
          emoji: '✅',
          details: `Connected to ${this.connectionUrl()}`,
        };
      } else {
        report.connectivity = {
          status: 'offline',
          emoji: '❌',
          details: `Cannot reach ${this.connectionUrl()}`,
        };
        return report; // Early return if not connected
      }

      // Test REST API
      report.restApiAvailable = await this.testRestApiAvailability();

      // Test authentication
      const authResult = await this.testAuthentication();
      report.authentication = {
        method: this.usesApiKeyAuthentication() ? 'api-key' : 'credentials',
        status: authResult.valid ? 'valid' : 'invalid',
        emoji: authResult.valid ? '✅' : '❌',
      };

      // Test individual features
      report.features.diceRolling = await this.testDiceRolling();
      report.features.actorSearch = await this.testActorSearch();
      report.features.itemSearch = await this.testItemSearch();
      report.features.sceneData = await this.testSceneData();
      report.features.diagnostics = report.restApiAvailable;

      report.websocketAvailable =
        (this.provider.kind === 'socketio' || this.provider.kind === 'composite') &&
        this.provider.isConnected();

      // Update connectivity status based on feature availability
      if (report.restApiAvailable) {
        report.connectivity.status = 'connected';
      } else if (!this.provider.capabilities && report.features.diceRolling) {
        report.connectivity.status = 'limited';
        report.connectivity.emoji = '⚠️';
        report.connectivity.details += ' (Limited functionality - REST API not available)';
      }
    } catch (error) {
      logger.error('Health check failed:', error);
      report.connectivity = {
        status: 'offline',
        emoji: '❌',
        details: `Health check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
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
      output += '💡 **Unlock Full Features** (optional REST bridge):\n';
      output += `  → Module and bridge server: ${REST_BRIDGE_REPO}\n`;
      output += `  → Module manifest URL: ${REST_BRIDGE_MANIFEST}\n`;
      output +=
        '  → Set FOUNDRY_API_KEY and FOUNDRY_REST_URL alongside the Socket.IO credentials\n';
      output += `  → See setup guide: ${REST_BRIDGE_GUIDE}\n\n`;
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
      suggestions:
        "• **Check if FoundryVTT is running** - Start FoundryVTT and ensure it's accessible\n" +
        `• **Verify server URL** - Check that \`${this.connectionUrl()}\` is correct\n` +
        '• **Test connectivity** - Run `npm run test-connection` for detailed diagnostics\n' +
        '• **Check firewall** - Ensure no firewall is blocking the connection',
      severity: 'critical',
      canContinue: false,
      documentationUrl:
        'https://github.com/laurigates/foundryvtt-mcp/blob/main/TROUBLESHOOTING.md#connectivity-issues',
    };
  }

  /**
   * Create diagnostic for REST API issues
   */
  private createRestApiDiagnostic(feature: string): DiagnosticResult {
    return {
      explanation: `${feature.charAt(0).toUpperCase() + feature.slice(1)} search requires the optional REST bridge for full functionality.`,
      suggestions:
        `• **Install the module and bridge server** - Install the module in Foundry from the manifest URL ${REST_BRIDGE_MANIFEST}; the bridge server is in ${REST_BRIDGE_REPO}\n` +
        "• **Enable the module** - Activate it in your world's module settings and turn on its REST API\n" +
        '• **Start the bridge server** - Keep a Gamemaster logged in through a browser; the bridge answers through that client\n' +
        '• **Update .env file** - Set FOUNDRY_API_KEY to the module key and FOUNDRY_REST_URL to the bridge (e.g. http://localhost:3030)\n' +
        '• **Restart MCP server** - Restart to pick up the new configuration',
      severity: 'warning',
      canContinue: true,
      documentationUrl: REST_BRIDGE_GUIDE,
    };
  }

  /**
   * Create diagnostic for authentication issues
   */
  private createAuthenticationDiagnostic(authResult: {
    valid: boolean;
    error?: string;
  }): DiagnosticResult {
    const isApiKey = this.usesApiKeyAuthentication();
    const method = isApiKey ? 'API key' : 'username/password';

    return {
      explanation: authResult.error
        ? `Authentication failed using ${method}: ${authResult.error}`
        : `Authentication failed using ${method}.`,
      suggestions: isApiKey
        ? "• **Check API key** - Verify the key is correct and hasn't expired\n" +
          '• **Regenerate key** - Generate a new API key in FoundryVTT module settings\n' +
          '• **Bridge status** - Ensure the module is enabled, the bridge server is running and a Gamemaster is logged in\n' +
          '• **Restart FoundryVTT** - Sometimes a restart resolves authentication issues'
        : '• **Check credentials** - Verify username and password are correct\n' +
          '• **User permissions** - Ensure the user has required permissions\n' +
          '• **Case sensitivity** - Check for typos in username (case-sensitive)\n' +
          '• **User status** - Make sure the user account is active',
      severity: 'error',
      canContinue: false,
      documentationUrl:
        'https://github.com/laurigates/foundryvtt-mcp/blob/main/TROUBLESHOOTING.md#authentication-issues',
    };
  }

  /**
   * Create feature-specific diagnostic
   */
  private async createFeatureSpecificDiagnostic(feature: string): Promise<DiagnosticResult> {
    return {
      explanation: `Connected with full access, but no ${feature} data found.`,
      suggestions:
        `• **Check data exists** - Verify that ${feature} exist in your FoundryVTT world\n` +
        '• **User permissions** - Ensure you have permission to view this data\n' +
        '• **Module conflicts** - Check if other modules might be interfering\n' +
        `• **Direct test** - Try accessing ${feature} directly in FoundryVTT`,
      severity: 'info',
      canContinue: true,
      documentationUrl:
        'https://github.com/laurigates/foundryvtt-mcp/blob/main/TROUBLESHOOTING.md#empty-results',
    };
  }

  /**
   * Create generic error diagnostic.
   *
   * Surfaces the underlying error message so details that `testConnection()`
   * throws — for example a rejected `FOUNDRY_API_KEY` — are not lost when the
   * diagnosis falls through to this catch-all (#288).
   */
  private createGenericErrorDiagnostic(error: unknown): DiagnosticResult {
    const message = error instanceof Error ? error.message : 'Unknown error';

    return {
      explanation: `An unexpected error occurred during diagnosis: ${message}`,
      suggestions:
        '• **Check logs** - Review server logs for detailed error information\n' +
        '• **Restart services** - Try restarting both FoundryVTT and the MCP server\n' +
        '• **Update software** - Ensure all components are up to date\n' +
        '• **Report issue** - If problem persists, report it on GitHub',
      severity: 'error',
      canContinue: false,
      documentationUrl: 'https://github.com/laurigates/foundryvtt-mcp/issues',
    };
  }

  /**
   * Test if feature requires REST API
   */
  private requiresRestApi(feature: string): boolean {
    return feature === 'diagnostics';
  }

  private connectionUrl(): string {
    const report = this.provider.getConnectionReport?.();
    return report?.mode === 'rest' && report.rest.baseUrl
      ? report.rest.baseUrl
      : this.connection.url;
  }

  /** Provider selection takes precedence over unrelated legacy environment credentials. */
  private usesApiKeyAuthentication(): boolean {
    if (this.provider.kind !== undefined) {
      return this.provider.kind === 'legacy-rest' || this.provider.kind === 'rest-api';
    }
    const mode = this.provider.getTransportMode?.();
    return mode === undefined ? Boolean(this.connection.apiKey) : mode === 'rest';
  }

  /**
   * Test REST API availability: the module answers its authenticated
   * /api/world route with JSON (#230). Same probe as `FoundryCore.connect()`.
   */
  private async testRestApiAvailability(): Promise<boolean> {
    if (this.provider.capabilities && !this.provider.capabilities.has('diagnostics.read')) {
      return false;
    }
    try {
      await probeRestModule((url) => this.provider.get(url));
      return true;
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
      if (this.provider.kind === 'rest-api' || this.provider.kind === 'composite') {
        return { valid: this.provider.isConnected() };
      }
      if (this.usesApiKeyAuthentication()) {
        // Test API key authentication: only a JSON-object /api/world body
        // proves the module accepted the key (#230); probeRestModule throws
        // otherwise, and the catch below reports it as invalid.
        await probeRestModule((url) => this.provider.get(url));
        return { valid: true };
      } else {
        // Test credential authentication (via WebSocket)
        if (!this.provider.isConnected()) {
          await this.provider.connect();
        }
        return { valid: this.provider.isConnected() };
      }
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : 'Unknown authentication error',
      };
    }
  }

  /**
   * Test dice rolling functionality
   */
  private async testDiceRolling(): Promise<boolean> {
    try {
      const result = await this.provider.rollDice('1d20', 'Health check test');
      if (typeof result.total !== 'number') {
        return false;
      }
      // In REST mode a local roll means /api/dice/roll failed and the client
      // fell back (#254); in Socket.IO mode every roll is local by design.
      const requiresServerRoll =
        this.provider.kind === 'legacy-rest' ||
        this.provider.kind === 'rest-api' ||
        (this.provider.kind === undefined && Boolean(this.connection.apiKey));
      if (requiresServerRoll && result.source !== 'server') {
        logger.warn('Dice health check: REST dice roll fell back to the local roller');
        return false;
      }
      return true;
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
      const result = await this.provider.searchActors({ limit: 1 });
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
      const result = await this.provider.searchItems({ limit: 1 });
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
      const result = await this.provider.getCurrentScene();
      return !!result && typeof result.name === 'string';
    } catch (error) {
      logger.debug('Scene data test failed:', error);
      return false;
    }
  }
}
