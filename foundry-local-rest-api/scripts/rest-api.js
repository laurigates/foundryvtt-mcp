/**
 * Foundry Local REST API Module
 * Provides local HTTP endpoints for external integrations without third-party dependencies
 */

import { AuthManager } from './auth.js';
import { ActorsAPI } from './routes/actors.js';
import { ItemsAPI } from './routes/items.js';
import { DiceAPI } from './routes/dice.js';
import { ScenesAPI } from './routes/scenes.js';
import { WorldAPI } from './routes/world.js';
import { DiagnosticsAPI } from './routes/diagnostics.js';

class FoundryLocalRestAPI {
  constructor() {
    this.authManager = new AuthManager();
    this.server = null;
    this.isEnabled = false;
  }

  /**
   * Initialize the REST API module
   */
  static initialize() {
    console.log('Foundry Local REST API | Initializing module');

    // Create global instance
    window.foundryLocalRestAPI = new FoundryLocalRestAPI();

    // Register module settings
    window.foundryLocalRestAPI.registerSettings();

    // Start API server if enabled
    Hooks.once('ready', () => {
      window.foundryLocalRestAPI.onReady();
    });
  }

  /**
   * Register module settings
   */
  registerSettings() {
    game.settings.register('foundry-local-rest-api', 'enable-api', {
      name: game.i18n.localize('foundry-local-rest-api.settings.enable-api.name'),
      hint: game.i18n.localize('foundry-local-rest-api.settings.enable-api.hint'),
      scope: 'world',
      config: true,
      type: Boolean,
      default: false,
      onChange: (value) => {
        if (value) {
          this.startServer();
        } else {
          this.stopServer();
        }
      }
    });

    game.settings.register('foundry-local-rest-api', 'api-key', {
      name: game.i18n.localize('foundry-local-rest-api.settings.api-key.name'),
      hint: game.i18n.localize('foundry-local-rest-api.settings.api-key.hint'),
      scope: 'world',
      config: true,
      type: String,
      default: '',
      onChange: (value) => {
        this.authManager.setApiKey(value);
      }
    });

    game.settings.register('foundry-local-rest-api', 'log-requests', {
      name: game.i18n.localize('foundry-local-rest-api.settings.log-requests.name'),
      hint: game.i18n.localize('foundry-local-rest-api.settings.log-requests.hint'),
      scope: 'world',
      config: true,
      type: Boolean,
      default: false
    });
  }

  /**
   * Called when FoundryVTT is ready
   */
  onReady() {
    console.log('Foundry Local REST API | FoundryVTT ready');

    // Initialize auth manager
    const apiKey = game.settings.get('foundry-local-rest-api', 'api-key');
    this.authManager.setApiKey(apiKey);

    // Generate API key if none exists
    if (!apiKey) {
      this.generateApiKey();
    }

    // Start server if enabled
    const isEnabled = game.settings.get('foundry-local-rest-api', 'enable-api');
    if (isEnabled) {
      this.startServer();
    }
  }

  /**
   * Generate a new API key
   */
  generateApiKey() {
    const apiKey = this.authManager.generateApiKey();
    game.settings.set('foundry-local-rest-api', 'api-key', apiKey);

    ui.notifications.info(
      game.i18n.format('foundry-local-rest-api.notifications.api-key-generated', { key: apiKey })
    );

    console.log('Foundry Local REST API | Generated new API key:', apiKey);
  }

  /**
   * Start the REST API server
   */
  startServer() {
    if (this.isEnabled) {
      console.log('Foundry Local REST API | Server already running');
      return;
    }

    console.log('Foundry Local REST API | Starting server...');

    try {
      // Hook into FoundryVTT's Express server
      this.setupRoutes();
      this.isEnabled = true;

      const port = game.socket.socket.io.engine.port;
      ui.notifications.info(
        game.i18n.format('foundry-local-rest-api.notifications.api-enabled', { port })
      );

      console.log(`Foundry Local REST API | Server started on port ${port}`);
    } catch (error) {
      console.error('Foundry Local REST API | Failed to start server:', error);
      ui.notifications.error('Failed to start REST API server');
    }
  }

  /**
   * Stop the REST API server
   */
  stopServer() {
    if (!this.isEnabled) {
      console.log('Foundry Local REST API | Server not running');
      return;
    }

    console.log('Foundry Local REST API | Stopping server...');
    this.isEnabled = false;

    ui.notifications.info(
      game.i18n.localize('foundry-local-rest-api.notifications.api-disabled')
    );
  }

  /**
   * Setup API routes by hooking into FoundryVTT's Express server
   */
  setupRoutes() {
    // Access FoundryVTT's Express app
    const app = game.socket.socket.io.httpServer;

    if (!app) {
      throw new Error('Cannot access FoundryVTT HTTP server');
    }

    // Middleware for API authentication
    const authenticate = (req, res, next) => {
      const apiKey = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');

      if (!this.authManager.validateApiKey(apiKey)) {
        const logRequests = game.settings.get('foundry-local-rest-api', 'log-requests');
        if (logRequests) {
          console.log('Foundry Local REST API | Unauthorized request:', req.url);
        }

        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Valid API key required'
        });
      }

      next();
    };

    // Middleware for request logging
    const logRequest = (req, res, next) => {
      const logRequests = game.settings.get('foundry-local-rest-api', 'log-requests');
      if (logRequests) {
        console.log(`Foundry Local REST API | ${req.method} ${req.url}`);
      }
      next();
    };

    // Add JSON parsing middleware
    app.use('/api', express.json());
    app.use('/api', logRequest);
    app.use('/api', authenticate);

    // Setup route handlers
    const actorsAPI = new ActorsAPI();
    const itemsAPI = new ItemsAPI();
    const diceAPI = new DiceAPI();
    const scenesAPI = new ScenesAPI();
    const worldAPI = new WorldAPI();
    const diagnosticsAPI = new DiagnosticsAPI();

    // Status endpoint (no auth required)
    app.get('/api/status', (req, res) => {
      res.json({
        status: 'ok',
        module: 'foundry-local-rest-api',
        version: '0.1.0',
        foundry: game.version,
        world: game.world.id
      });
    });

    // Actors endpoints
    app.get('/api/actors', (req, res) => actorsAPI.searchActors(req, res));
    app.get('/api/actors/:id', (req, res) => actorsAPI.getActor(req, res));

    // Items endpoints
    app.get('/api/items', (req, res) => itemsAPI.searchItems(req, res));
    app.get('/api/items/:id', (req, res) => itemsAPI.getItem(req, res));

    // Dice endpoints
    app.post('/api/dice/roll', (req, res) => diceAPI.rollDice(req, res));

    // Scenes endpoints
    app.get('/api/scenes/current', (req, res) => scenesAPI.getCurrentScene(req, res));
    app.get('/api/scenes/:id', (req, res) => scenesAPI.getScene(req, res));
    app.get('/api/scenes', (req, res) => scenesAPI.searchScenes(req, res));

    // World endpoints
    app.get('/api/world', (req, res) => worldAPI.getWorldInfo(req, res));

    // Diagnostics endpoints
    app.get('/api/diagnostics/logs', (req, res) => diagnosticsAPI.getRecentLogs(req, res));
    app.get('/api/diagnostics/search', (req, res) => diagnosticsAPI.searchLogs(req, res));
    app.get('/api/diagnostics/health', (req, res) => diagnosticsAPI.getSystemHealth(req, res));
    app.get('/api/diagnostics/errors', (req, res) => diagnosticsAPI.diagnoseErrors(req, res));

    console.log('Foundry Local REST API | Routes registered');
  }
}

// Initialize when the module loads
Hooks.once('init', () => {
  FoundryLocalRestAPI.initialize();
});

// Export for external access
export { FoundryLocalRestAPI };
