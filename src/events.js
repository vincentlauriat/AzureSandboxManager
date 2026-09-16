'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

/**
 * Append-only change log. Snapshots alone only remember the recent past; this
 * is what still holds the trace of a role transfer noticed weeks later.
 */

class EventLog {
  constructor(dir) {
    this.file = path.join(dir, 'events.jsonl');
    this.dir = dir;
  }

  async append(events, at = new Date().toISOString()) {
    if (!events.length) return 0;
    await fs.mkdir(this.dir, { recursive: true });
    const lines = events.map((e) => JSON.stringify({ at, ...e })).join('\n');
    await fs.appendFile(this.file, lines + '\n', 'utf8');
    return events.length;
  }

  async read(limit = 50) {
    let raw;
    try {
      raw = await fs.readFile(this.file, 'utf8');
    } catch {
      return [];
    }
    const lines = raw.split('\n').filter(Boolean);
    return lines
      .slice(-limit)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .reverse();
  }
}

module.exports = { EventLog };
