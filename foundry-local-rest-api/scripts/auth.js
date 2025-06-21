/**
 * Authentication manager for the Foundry Local REST API
 * Handles API key generation and validation
 */

export class AuthManager {
  constructor() {
    this.currentApiKey = null;
  }

  /**
   * Generate a secure API key
   * @returns {string} Generated API key
   */
  generateApiKey() {
    // Generate a cryptographically secure random string
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);

    // Convert to base64 and make URL-safe
    const apiKey = btoa(String.fromCharCode.apply(null, array))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');

    this.currentApiKey = apiKey;
    return apiKey;
  }

  /**
   * Set the current API key
   * @param {string} apiKey - The API key to set
   */
  setApiKey(apiKey) {
    this.currentApiKey = apiKey;
  }

  /**
   * Validate an API key
   * @param {string} providedKey - The API key to validate
   * @returns {boolean} True if valid, false otherwise
   */
  validateApiKey(providedKey) {
    if (!providedKey || !this.currentApiKey) {
      return false;
    }

    // Use constant-time comparison to prevent timing attacks
    return this.constantTimeEquals(providedKey, this.currentApiKey);
  }

  /**
   * Constant-time string comparison to prevent timing attacks
   * @param {string} a - First string
   * @param {string} b - Second string
   * @returns {boolean} True if strings are equal
   */
  constantTimeEquals(a, b) {
    if (a.length !== b.length) {
      return false;
    }

    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }

    return result === 0;
  }

  /**
   * Get the current API key
   * @returns {string|null} Current API key or null if not set
   */
  getCurrentApiKey() {
    return this.currentApiKey;
  }

  /**
   * Clear the current API key
   */
  clearApiKey() {
    this.currentApiKey = null;
  }
}
