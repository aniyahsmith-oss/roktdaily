/**
 * BaseAgent — all source agents extend this.
 *
 * Subclasses implement:
 *   async fetch(exec, date) → raw data from the API
 *   async analyse(raw, exec, date) → structured { summary, items[], urgentFlags[] }
 *
 * The orchestrator calls run(), which handles caching automatically.
 */
import { getCached, setCache } from '../db/database.js';
import { log } from '../utils/logger.js';

export class BaseAgent {
  constructor(name) {
    this.name = name;
  }

  /** Override in subclass — call the external API */
  async fetch(_exec, _date) {
    throw new Error(`${this.name}.fetch() not implemented`);
  }

  /** Override in subclass — turn raw API data into structured output */
  async analyse(_raw, _exec, _date) {
    throw new Error(`${this.name}.analyse() not implemented`);
  }

  /**
   * Called by the orchestrator. Returns cached result if available.
   * @param {object} exec   - executive row from DB
   * @param {string} date   - YYYY-MM-DD
   * @param {boolean} force - bypass cache
   */
  async run(exec, date, force = false) {
    const cacheKey = date;

    if (!force) {
      const cached = getCached(exec.id, this.name, cacheKey);
      if (cached) {
        log.debug(`[${this.name}] cache hit`);
        return cached;
      }
    }

    log.info(`[${this.name}] fetching…`);
    try {
      const raw = await this.fetch(exec, date);
      const result = await this.analyse(raw, exec, date);
      setCache(exec.id, this.name, cacheKey, result);
      return result;
    } catch (err) {
      log.error(`[${this.name}] failed: ${err.message}`);
      return {
        source: this.name,
        error: err.message,
        summary: `Could not fetch ${this.name} data today.`,
        items: [],
        urgentFlags: [],
      };
    }
  }
}
