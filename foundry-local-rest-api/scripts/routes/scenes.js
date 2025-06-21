/**
 * Scenes API endpoints for the Foundry Local REST API
 */

export class ScenesAPI {

  /**
   * Get current active scene information
   * GET /api/scenes/current
   */
  getCurrentScene(req, res) {
    try {
      const currentScene = game.scenes.active;

      if (!currentScene) {
        return res.json({
          success: true,
          data: null,
          message: 'No active scene'
        });
      }

      const sceneData = this.formatSceneDetail(currentScene);

      res.json({
        success: true,
        data: sceneData
      });

    } catch (error) {
      console.error('Foundry Local REST API | Error getting current scene:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: error.message
      });
    }
  }

  /**
   * Get detailed information about a specific scene
   * GET /api/scenes/:id
   */
  getScene(req, res) {
    try {
      const { id } = req.params;
      const scene = game.scenes.get(id);

      if (!scene) {
        return res.status(404).json({
          success: false,
          error: 'Scene not found',
          message: `Scene with ID ${id} does not exist`
        });
      }

      const sceneData = this.formatSceneDetail(scene);

      res.json({
        success: true,
        data: sceneData
      });

    } catch (error) {
      console.error('Foundry Local REST API | Error getting scene:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: error.message
      });
    }
  }

  /**
   * Search for scenes based on query parameters
   * GET /api/scenes?query=tavern&limit=10
   */
  searchScenes(req, res) {
    try {
      const { query, limit = 50 } = req.query;

      let scenes = Array.from(game.scenes.values());

      // Filter by query if specified (search in name and navigation name)
      if (query) {
        const searchQuery = query.toLowerCase();
        scenes = scenes.filter(scene => {
          const name = scene.name?.toLowerCase() || '';
          const navName = scene.navName?.toLowerCase() || '';
          return name.includes(searchQuery) || navName.includes(searchQuery);
        });
      }

      // Limit results
      scenes = scenes.slice(0, parseInt(limit));

      // Format response
      const results = scenes.map(scene => this.formatSceneSummary(scene));

      res.json({
        success: true,
        data: results,
        total: results.length,
        query: { query, limit }
      });

    } catch (error) {
      console.error('Foundry Local REST API | Error searching scenes:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: error.message
      });
    }
  }

  /**
   * Format scene data for summary view (search results)
   */
  formatSceneSummary(scene) {
    return {
      id: scene.id,
      name: scene.name,
      navName: scene.navName,
      img: scene.img,
      thumb: scene.thumb,
      active: scene.active,
      navigation: scene.navigation,
      dimensions: {
        width: scene.width,
        height: scene.height,
        size: scene.grid?.size || 100,
        distance: scene.grid?.distance || 5,
        units: scene.grid?.units || 'ft'
      },
      tokenCount: scene.tokens?.size || 0,
      lightCount: scene.lights?.size || 0,
      folder: scene.folder?.name || null
    };
  }

  /**
   * Format scene data for detailed view
   */
  formatSceneDetail(scene) {
    const summary = this.formatSceneSummary(scene);

    return {
      ...summary,
      // Additional detailed information
      background: {
        src: scene.background?.src || scene.img,
        offsetX: scene.background?.offsetX || 0,
        offsetY: scene.background?.offsetY || 0,
        scaleX: scene.background?.scaleX || 1,
        scaleY: scene.background?.scaleY || 1
      },
      foreground: scene.foreground || null,
      darkness: scene.darkness || 0,
      fogExploration: scene.fogExploration || false,
      globalLight: scene.globalLight || false,
      globalLightThreshold: scene.globalLightThreshold || null,
      hasGlobalThreshold: scene.hasGlobalThreshold || false,
      tokenVision: scene.tokenVision || false,
      fogOverlay: scene.fogOverlay || null,
      weather: scene.weather || null,
      environment: scene.environment || {},
      grid: {
        type: scene.grid?.type || 1,
        size: scene.grid?.size || 100,
        color: scene.grid?.color || '#000000',
        alpha: scene.grid?.alpha || 0.2,
        distance: scene.grid?.distance || 5,
        units: scene.grid?.units || 'ft'
      },
      tokens: Array.from(scene.tokens || []).map(token => this.formatToken(token)),
      lights: Array.from(scene.lights || []).map(light => this.formatLight(light)),
      walls: Array.from(scene.walls || []).map(wall => this.formatWall(wall)),
      sounds: Array.from(scene.sounds || []).map(sound => this.formatSound(sound)),
      notes: Array.from(scene.notes || []).map(note => this.formatNote(note)),
      tiles: Array.from(scene.tiles || []).map(tile => this.formatTile(tile)),
      drawings: Array.from(scene.drawings || []).map(drawing => this.formatDrawing(drawing)),
      playlist: scene.playlist || null,
      playlistSound: scene.playlistSound || null,
      journal: scene.journal ? {
        id: scene.journal.id,
        name: scene.journal.name
      } : null,
      ownership: scene.ownership,
      flags: scene.flags
    };
  }

  /**
   * Format token data
   */
  formatToken(token) {
    return {
      id: token.id,
      name: token.name,
      img: token.texture?.src || token.img,
      x: token.x,
      y: token.y,
      width: token.width,
      height: token.height,
      scale: token.texture?.scaleX || 1,
      rotation: token.rotation || 0,
      alpha: token.alpha || 1,
      hidden: token.hidden || false,
      locked: token.locked || false,
      disposition: token.disposition || 0,
      displayName: token.displayName || 0,
      displayBars: token.displayBars || 0,
      actorId: token.actorId,
      actorLink: token.actorLink || false,
      elevation: token.elevation || 0,
      vision: token.sight || {},
      light: token.light || {},
      effects: token.effects || []
    };
  }

  /**
   * Format light data
   */
  formatLight(light) {
    return {
      id: light.id,
      x: light.x,
      y: light.y,
      rotation: light.rotation || 0,
      config: light.config || {},
      hidden: light.hidden || false,
      locked: light.locked || false
    };
  }

  /**
   * Format wall data
   */
  formatWall(wall) {
    return {
      id: wall.id,
      c: wall.c, // coordinates [x1, y1, x2, y2]
      light: wall.light || 0,
      move: wall.move || 0,
      sight: wall.sight || 0,
      sound: wall.sound || 0,
      dir: wall.dir || 0,
      door: wall.door || 0,
      ds: wall.ds || 0, // door state
      flags: wall.flags || {}
    };
  }

  /**
   * Format ambient sound data
   */
  formatSound(sound) {
    return {
      id: sound.id,
      x: sound.x,
      y: sound.y,
      radius: sound.radius || 0,
      path: sound.path || '',
      repeat: sound.repeat || false,
      volume: sound.volume || 0.5,
      walls: sound.walls || false,
      easing: sound.easing || false,
      hidden: sound.hidden || false,
      locked: sound.locked || false
    };
  }

  /**
   * Format journal note data
   */
  formatNote(note) {
    return {
      id: note.id,
      x: note.x,
      y: note.y,
      icon: note.texture?.src || note.icon,
      iconSize: note.iconSize || 40,
      text: note.text || '',
      fontFamily: note.textAnchor?.fontFamily || '',
      fontSize: note.textAnchor?.fontSize || 48,
      entryId: note.entryId,
      pageId: note.pageId,
      global: note.global || false
    };
  }

  /**
   * Format tile data
   */
  formatTile(tile) {
    return {
      id: tile.id,
      img: tile.texture?.src || tile.img,
      x: tile.x,
      y: tile.y,
      width: tile.width,
      height: tile.height,
      rotation: tile.rotation || 0,
      alpha: tile.alpha || 1,
      hidden: tile.hidden || false,
      locked: tile.locked || false,
      overhead: tile.overhead || false,
      roof: tile.roof || false,
      occlusion: tile.occlusion || {},
      video: tile.video || {}
    };
  }

  /**
   * Format drawing data
   */
  formatDrawing(drawing) {
    return {
      id: drawing.id,
      author: drawing.author,
      shape: drawing.shape || {},
      x: drawing.x,
      y: drawing.y,
      strokeWidth: drawing.strokeWidth || 8,
      strokeColor: drawing.strokeColor || '#FFFFFF',
      strokeAlpha: drawing.strokeAlpha || 1,
      fillType: drawing.fillType || 0,
      fillColor: drawing.fillColor || '#FFFFFF',
      fillAlpha: drawing.fillAlpha || 0.5,
      text: drawing.text || '',
      fontFamily: drawing.fontFamily || '',
      fontSize: drawing.fontSize || 48,
      textColor: drawing.textColor || '#FFFFFF',
      textAlpha: drawing.textAlpha || 1,
      hidden: drawing.hidden || false,
      locked: drawing.locked || false
    };
  }
}
