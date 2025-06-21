/**
 * Diagnostics API Routes for FoundryVTT REST API Module
 * Provides log access and system health monitoring for external MCP integration
 */

export class DiagnosticsAPI {
  constructor() {
    this.logBuffer = [];
    this.maxLogBuffer = 1000;
    this.errorPatterns = [
      /TypeError/i,
      /ReferenceError/i,
      /Cannot read property/i,
      /Cannot access before initialization/i,
      /Failed to fetch/i,
      /Network Error/i,
      /Permission denied/i,
      /Module.*not found/i
    ];
    this.setupLogCapture();
  }

  /**
   * Setup console and FoundryVTT log capture
   */
  setupLogCapture() {
    // Store original console methods
    const originalConsole = {
      log: console.log,
      warn: console.warn,
      error: console.error,
      info: console.info
    };

    // Intercept console output
    ['log', 'warn', 'error', 'info'].forEach(level => {
      console[level] = (...args) => {
        // Call original console method
        originalConsole[level](...args);
        
        // Capture for our buffer
        this.captureLogEntry(level, args);
      };
    });

    // Hook into FoundryVTT notifications
    if (typeof Hooks !== 'undefined') {
      Hooks.on('ui.notification', (notification) => {
        this.captureLogEntry('notification', [notification.message || notification]);
      });

      // Capture FoundryVTT errors
      Hooks.on('error', (error) => {
        this.captureLogEntry('error', [error.message || error.toString()], error.stack);
      });

      // Capture module errors
      Hooks.on('init', () => {
        window.addEventListener('error', (event) => {
          this.captureLogEntry('error', [event.message], event.error?.stack);
        });

        window.addEventListener('unhandledrejection', (event) => {
          this.captureLogEntry('error', [`Unhandled Promise Rejection: ${event.reason}`]);
        });
      });
    }
  }

  /**
   * Capture a log entry to the buffer
   */
  captureLogEntry(level, args, stack = null) {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message: args.map(arg => 
        typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
      ).join(' '),
      stack: stack || (level === 'error' ? new Error().stack : null),
      source: this.determineLogSource(args)
    };

    this.logBuffer.push(entry);
    
    // Maintain buffer size
    if (this.logBuffer.length > this.maxLogBuffer) {
      this.logBuffer.shift();
    }
  }

  /**
   * Determine the source of a log entry
   */
  determineLogSource(args) {
    const message = args.join(' ');
    if (message.includes('Foundry')) return 'foundry';
    if (message.includes('Module')) return 'module';
    if (message.includes('System')) return 'system';
    if (message.includes('API')) return 'api';
    return 'unknown';
  }

  /**
   * Get recent logs with filtering
   */
  getRecentLogs(req, res) {
    try {
      const { 
        lines = 50, 
        level, 
        since, 
        source,
        includeStack = false 
      } = req.query;

      let logs = [...this.logBuffer];

      // Filter by level
      if (level) {
        logs = logs.filter(log => log.level === level);
      }

      // Filter by timestamp
      if (since) {
        const sinceDate = new Date(since);
        logs = logs.filter(log => new Date(log.timestamp) > sinceDate);
      }

      // Filter by source
      if (source) {
        logs = logs.filter(log => log.source === source);
      }

      // Limit number of entries
      logs = logs.slice(-parseInt(lines));

      // Remove stack traces unless requested
      if (!includeStack) {
        logs = logs.map(log => ({ ...log, stack: undefined }));
      }

      res.json({
        logs,
        total: logs.length,
        bufferSize: this.logBuffer.length,
        maxBufferSize: this.maxLogBuffer
      });
    } catch (error) {
      console.error('DiagnosticsAPI | Error getting recent logs:', error);
      res.status(500).json({ error: 'Failed to retrieve logs' });
    }
  }

  /**
   * Search logs for specific patterns
   */
  searchLogs(req, res) {
    try {
      const { pattern, timeframe, level, caseSensitive = false } = req.query;

      if (!pattern) {
        return res.status(400).json({ error: 'Pattern parameter is required' });
      }

      const flags = caseSensitive ? 'g' : 'gi';
      const regex = new RegExp(pattern, flags);
      
      let logs = [...this.logBuffer];

      // Filter by timeframe
      if (timeframe) {
        const timeframeMs = parseInt(timeframe) * 1000;
        const since = new Date(Date.now() - timeframeMs);
        logs = logs.filter(log => new Date(log.timestamp) > since);
      }

      // Filter by level
      if (level) {
        logs = logs.filter(log => log.level === level);
      }

      // Search pattern
      const matches = logs.filter(log => 
        regex.test(log.message) || 
        (log.stack && regex.test(log.stack))
      );

      res.json({
        logs: matches,
        matches: matches.length,
        pattern,
        searchTimeframe: timeframe || 'all'
      });
    } catch (error) {
      console.error('DiagnosticsAPI | Error searching logs:', error);
      res.status(500).json({ error: 'Failed to search logs' });
    }
  }

  /**
   * Get system health and performance metrics
   */
  getSystemHealth(req, res) {
    try {
      const now = Date.now();
      const oneHourAgo = now - (60 * 60 * 1000);
      
      // Get recent error counts
      const recentLogs = this.logBuffer.filter(log => 
        new Date(log.timestamp).getTime() > oneHourAgo
      );
      
      const errorCount = recentLogs.filter(log => log.level === 'error').length;
      const warningCount = recentLogs.filter(log => log.level === 'warn').length;

      const health = {
        timestamp: new Date().toISOString(),
        server: {
          foundryVersion: game?.version || 'unknown',
          systemVersion: game?.system?.version || 'unknown',
          worldId: game?.world?.id || 'unknown',
          uptime: typeof process !== 'undefined' ? process.uptime() : null
        },
        users: {
          total: game?.users?.size || 0,
          active: game?.users?.filter(u => u.active)?.length || 0,
          gm: game?.users?.filter(u => u.isGM)?.length || 0
        },
        modules: {
          total: game?.modules?.size || 0,
          active: Array.from(game?.modules?.values() || [])
            .filter(m => m.active).length
        },
        performance: {
          memory: typeof process !== 'undefined' ? process.memoryUsage() : null,
          connectedClients: game?.socket?.socket?.sockets?.size || 0
        },
        logs: {
          bufferSize: this.logBuffer.length,
          recentErrors: errorCount,
          recentWarnings: warningCount,
          errorRate: errorCount / Math.max(recentLogs.length, 1)
        },
        status: this.determineHealthStatus(errorCount, warningCount)
      };

      res.json(health);
    } catch (error) {
      console.error('DiagnosticsAPI | Error getting system health:', error);
      res.status(500).json({ error: 'Failed to retrieve system health' });
    }
  }

  /**
   * Analyze recent errors and provide diagnostic information
   */
  diagnoseErrors(req, res) {
    try {
      const { timeframe = 3600 } = req.query;
      const timeframeMs = parseInt(timeframe) * 1000;
      const since = new Date(Date.now() - timeframeMs);

      const recentErrors = this.logBuffer.filter(log => 
        log.level === 'error' && new Date(log.timestamp) > since
      );

      // Categorize errors
      const errorCategories = {};
      const suggestions = [];

      recentErrors.forEach(error => {
        for (const pattern of this.errorPatterns) {
          if (pattern.test(error.message)) {
            const category = pattern.source.replace(/[\/\\^$*+?.()|[\]{}]/g, '');
            errorCategories[category] = (errorCategories[category] || 0) + 1;
            break;
          }
        }
      });

      // Generate suggestions based on error patterns
      if (errorCategories.TypeError) {
        suggestions.push({
          category: 'TypeError',
          suggestion: 'Check for undefined variables or incorrect property access',
          priority: 'high'
        });
      }

      if (errorCategories.Network) {
        suggestions.push({
          category: 'Network',
          suggestion: 'Verify network connectivity and API endpoints',
          priority: 'medium'
        });
      }

      if (errorCategories.Module) {
        suggestions.push({
          category: 'Module',
          suggestion: 'Check module compatibility and load order',
          priority: 'high'
        });
      }

      const diagnosis = {
        timestamp: new Date().toISOString(),
        timeframe: `${timeframe} seconds`,
        summary: {
          totalErrors: recentErrors.length,
          uniqueErrors: new Set(recentErrors.map(e => e.message)).size,
          categories: errorCategories
        },
        recentErrors: recentErrors.slice(-10), // Last 10 errors
        suggestions,
        healthScore: this.calculateHealthScore(recentErrors.length, timeframe)
      };

      res.json(diagnosis);
    } catch (error) {
      console.error('DiagnosticsAPI | Error diagnosing errors:', error);
      res.status(500).json({ error: 'Failed to diagnose errors' });
    }
  }

  /**
   * Determine overall health status
   */
  determineHealthStatus(errorCount, warningCount) {
    if (errorCount === 0 && warningCount < 5) return 'healthy';
    if (errorCount < 3 && warningCount < 10) return 'warning';
    return 'critical';
  }

  /**
   * Calculate health score based on error frequency
   */
  calculateHealthScore(errorCount, timeframeSec) {
    const errorRate = errorCount / (timeframeSec / 60); // errors per minute
    if (errorRate === 0) return 100;
    if (errorRate < 0.1) return 95;
    if (errorRate < 0.5) return 85;
    if (errorRate < 1) return 70;
    if (errorRate < 2) return 50;
    return 25;
  }
}