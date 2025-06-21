/**
 * World API endpoints for the Foundry Local REST API
 */

export class WorldAPI {

  /**
   * Get world information and statistics
   * GET /api/world
   */
  getWorldInfo(req, res) {
    try {
      const worldData = this.formatWorldInfo();

      res.json({
        success: true,
        data: worldData
      });

    } catch (error) {
      console.error('Foundry Local REST API | Error getting world info:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: error.message
      });
    }
  }

  /**
   * Format comprehensive world information
   */
  formatWorldInfo() {
    const world = game.world;
    const settings = game.settings;

    return {
      // Basic world information
      id: world.id,
      title: world.title,
      description: world.description,
      system: world.system,
      coreVersion: world.coreVersion,
      systemVersion: world.systemVersion,
      version: world.version,
      compatibility: world.compatibility,
      authors: world.authors || [],

      // System information
      gameSystem: {
        id: game.system.id,
        title: game.system.title,
        version: game.system.version,
        author: game.system.author,
        description: game.system.description,
        url: game.system.url,
        license: game.system.license,
        compatibility: game.system.compatibility
      },

      // Foundry VTT version
      foundryVersion: game.version,

      // World statistics
      statistics: {
        actors: {
          total: game.actors.size,
          byType: this.getActorStatsByType()
        },
        items: {
          total: game.items.size,
          byType: this.getItemStatsByType()
        },
        scenes: {
          total: game.scenes.size,
          active: game.scenes.active?.name || null
        },
        journals: {
          total: game.journal.size
        },
        tables: {
          total: game.tables.size
        },
        macros: {
          total: game.macros.size
        },
        playlists: {
          total: game.playlists.size
        },
        users: {
          total: game.users.size,
          online: game.users.filter(u => u.active).length,
          gm: game.users.filter(u => u.isGM).length
        }
      },

      // Current session information
      session: {
        userId: game.user.id,
        userName: game.user.name,
        isGM: game.user.isGM,
        viewedScene: game.scenes.viewed?.id || null,
        currentTime: new Date().toISOString(),
        paused: game.paused
      },

      // Combat information
      combat: this.getCombatInfo(),

      // Active modules
      modules: Array.from(game.modules.entries())
        .filter(([id, module]) => module.active)
        .map(([id, module]) => ({
          id: id,
          title: module.title,
          version: module.version,
          author: module.author
        })),

      // World settings (safe subset)
      settings: this.getSafeWorldSettings(),

      // Folder structure
      folders: {
        actors: this.getFolderStructure(game.folders.filter(f => f.type === 'Actor')),
        items: this.getFolderStructure(game.folders.filter(f => f.type === 'Item')),
        scenes: this.getFolderStructure(game.folders.filter(f => f.type === 'Scene')),
        journals: this.getFolderStructure(game.folders.filter(f => f.type === 'JournalEntry')),
        tables: this.getFolderStructure(game.folders.filter(f => f.type === 'RollTable')),
        macros: this.getFolderStructure(game.folders.filter(f => f.type === 'Macro')),
        playlists: this.getFolderStructure(game.folders.filter(f => f.type === 'Playlist'))
      },

      // Compendium packs information
      compendiums: Array.from(game.packs.entries()).map(([key, pack]) => ({
        name: pack.metadata.name,
        label: pack.metadata.label,
        type: pack.metadata.type,
        system: pack.metadata.system,
        module: pack.metadata.module,
        path: pack.metadata.path,
        private: pack.private,
        size: pack.index.size
      }))
    };
  }

  /**
   * Get actor statistics by type
   */
  getActorStatsByType() {
    const stats = {};

    game.actors.forEach(actor => {
      const type = actor.type;
      if (!stats[type]) {
        stats[type] = 0;
      }
      stats[type]++;
    });

    return stats;
  }

  /**
   * Get item statistics by type
   */
  getItemStatsByType() {
    const stats = {};

    // Count world items
    game.items.forEach(item => {
      const type = item.type;
      if (!stats[type]) {
        stats[type] = 0;
      }
      stats[type]++;
    });

    // Count actor items
    game.actors.forEach(actor => {
      actor.items.forEach(item => {
        const type = item.type;
        if (!stats[type]) {
          stats[type] = 0;
        }
        stats[type]++;
      });
    });

    return stats;
  }

  /**
   * Get current combat information
   */
  getCombatInfo() {
    if (!game.combat) {
      return {
        active: false,
        combatId: null
      };
    }

    const combat = game.combat;

    return {
      active: true,
      combatId: combat.id,
      scene: combat.scene?.name || null,
      round: combat.round,
      turn: combat.turn,
      combatantCount: combat.combatants.size,
      started: combat.started,
      currentCombatant: combat.combatant ? {
        id: combat.combatant.id,
        name: combat.combatant.name,
        initiative: combat.combatant.initiative
      } : null,
      initiative: Array.from(combat.combatants.values())
        .sort((a, b) => (b.initiative || 0) - (a.initiative || 0))
        .map(combatant => ({
          id: combatant.id,
          actorId: combatant.actorId,
          name: combatant.name,
          img: combatant.img,
          initiative: combatant.initiative,
          hasPlayed: combatant.hasPlayed,
          defeated: combatant.defeated,
          hidden: combatant.hidden
        }))
    };
  }

  /**
   * Get safe world settings (excluding sensitive data)
   */
  getSafeWorldSettings() {
    const safeSettings = {};

    // Get commonly requested game settings that are safe to expose
    const safeKeys = [
      'core.animateRollTable',
      'core.chatBubbles',
      'core.leftClickRelease',
      'core.noCanvas',
      'core.language',
      'core.rollMode',
      'core.time',
      'core.tokenDragPreview'
    ];

    safeKeys.forEach(key => {
      try {
        const value = game.settings.get('core', key.replace('core.', ''));
        safeSettings[key] = value;
      } catch (error) {
        // Setting doesn't exist or isn't accessible
      }
    });

    return safeSettings;
  }

  /**
   * Get folder structure information
   */
  getFolderStructure(folders) {
    return folders.map(folder => ({
      id: folder.id,
      name: folder.name,
      type: folder.type,
      depth: folder.depth,
      parent: folder.parent?.id || null,
      children: folder.children?.map(child => child.id) || [],
      contents: folder.contents?.map(doc => ({
        id: doc.id,
        name: doc.name,
        type: doc.documentName
      })) || []
    }));
  }
}
