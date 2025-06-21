/**
 * Dice API endpoints for the Foundry Local REST API
 */

export class DiceAPI {

  /**
   * Roll dice using FoundryVTT's native dice system
   * POST /api/dice/roll
   * Body: { formula: "1d20+5", reason: "Attack roll" }
   */
  async rollDice(req, res) {
    try {
      const { formula, reason, advantage, disadvantage } = req.body;

      if (!formula) {
        return res.status(400).json({
          success: false,
          error: 'Bad Request',
          message: 'Formula is required'
        });
      }

      // Validate dice formula
      if (!this.isValidDiceFormula(formula)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid Formula',
          message: 'Dice formula contains invalid characters or syntax'
        });
      }

      let rollFormula = formula;

      // Handle advantage/disadvantage for d20 rolls
      if (advantage && formula.includes('d20')) {
        rollFormula = formula.replace(/(\d*)d20/g, '2d20kh1');
      } else if (disadvantage && formula.includes('d20')) {
        rollFormula = formula.replace(/(\d*)d20/g, '2d20kl1');
      }

      // Create and evaluate the roll
      const roll = new Roll(rollFormula);
      await roll.evaluate({ async: true });

      // Format the result
      const result = this.formatRollResult(roll, formula, reason, { advantage, disadvantage });

      // Optionally send to chat (if requested)
      if (req.body.sendToChat) {
        const chatData = {
          user: game.user.id,
          content: `
            <div class="dice-roll">
              <div class="dice-result">
                <h4 class="dice-formula">${formula}${reason ? ` - ${reason}` : ''}</h4>
                <div class="dice-tooltip" style="display: none;">
                  ${roll.dice.map(d => d.results.map(r => `<span class="die d${d.faces}">${r.result}</span>`).join('')).join('')}
                </div>
                <h4 class="dice-total">${roll.total}</h4>
              </div>
            </div>
          `,
          sound: CONFIG.sounds.dice,
          type: CONST.CHAT_MESSAGE_TYPES.ROLL,
          roll: roll
        };

        ChatMessage.create(chatData);
      }

      res.json({
        success: true,
        data: result
      });

    } catch (error) {
      console.error('Foundry Local REST API | Error rolling dice:', error);
      res.status(400).json({
        success: false,
        error: 'Roll Error',
        message: error.message
      });
    }
  }

  /**
   * Validate that a dice formula is safe to evaluate
   */
  isValidDiceFormula(formula) {
    // Allow only dice notation, numbers, basic math operators, and common keywords
    const validPattern = /^[0-9dDkKlLhH+\-*/() ]+$/;

    if (!validPattern.test(formula)) {
      return false;
    }

    // Check for basic dice notation
    const dicePattern = /\d*d\d+/i;
    if (!dicePattern.test(formula)) {
      // Allow simple math expressions without dice
      const mathPattern = /^[0-9+\-*/() ]+$/;
      return mathPattern.test(formula);
    }

    return true;
  }

  /**
   * Format roll result for API response
   */
  formatRollResult(roll, originalFormula, reason, options = {}) {
    const result = {
      formula: originalFormula,
      evaluatedFormula: roll.formula,
      total: roll.total,
      terms: [],
      dice: [],
      reason: reason || null,
      timestamp: new Date().toISOString(),
      options: options
    };

    // Process roll terms
    roll.terms.forEach(term => {
      if (term instanceof Die) {
        const dieData = {
          faces: term.faces,
          number: term.number,
          results: term.results.map(r => ({
            result: r.result,
            active: r.active,
            discarded: r.discarded,
            exploded: r.exploded || false,
            rerolled: r.rerolled || false
          })),
          total: term.total,
          expression: `${term.number}d${term.faces}`,
          modifiers: term.modifiers || []
        };

        result.dice.push(dieData);
        result.terms.push({
          type: 'die',
          ...dieData
        });
      } else if (term instanceof NumericTerm) {
        result.terms.push({
          type: 'number',
          number: term.number,
          total: term.total
        });
      } else if (term instanceof OperatorTerm) {
        result.terms.push({
          type: 'operator',
          operator: term.operator
        });
      } else {
        result.terms.push({
          type: 'unknown',
          class: term.constructor.name,
          total: term.total
        });
      }
    });

    // Add roll breakdown for complex rolls
    if (roll.dice.length > 0) {
      result.breakdown = roll.dice.map(die => {
        const results = die.results
          .filter(r => r.active)
          .map(r => r.result);

        return {
          dice: `${die.number}d${die.faces}`,
          results: results,
          total: results.reduce((sum, val) => sum + val, 0)
        };
      });
    }

    // Add critical success/failure information for d20 rolls
    if (roll.dice.some(d => d.faces === 20)) {
      const d20Results = roll.dice
        .filter(d => d.faces === 20)
        .flatMap(d => d.results.filter(r => r.active).map(r => r.result));

      result.critical = {
        success: d20Results.some(r => r === 20),
        failure: d20Results.some(r => r === 1),
        naturalRolls: d20Results
      };
    }

    return result;
  }
}
