'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

/**
 * Snapshots live on App Service's /home, which is persistent across restarts
 * and redeployments — unlike the container filesystem.
 */

const KEEP_SNAPSHOTS = 200;

class SnapshotStore {
  constructor(dir) {
    this.dir = dir;
    this.snapshotDir = path.join(dir, 'snapshots');
  }

  async init() {
    await fs.mkdir(this.snapshotDir, { recursive: true });
  }

  fileFor(collectedAt) {
    return path.join(this.snapshotDir, `${collectedAt.replace(/[:.]/g, '-')}.json`);
  }

  async write(snapshot) {
    await this.init();
    await fs.writeFile(this.fileFor(snapshot.collectedAt), JSON.stringify(snapshot, null, 2), 'utf8');
    await this.prune();
    return snapshot;
  }

  async list() {
    await this.init();
    const entries = await fs.readdir(this.snapshotDir);
    return entries.filter((f) => f.endsWith('.json')).sort();
  }

  async prune() {
    const files = await this.list();
    const excess = files.slice(0, Math.max(0, files.length - KEEP_SNAPSHOTS));
    await Promise.all(excess.map((f) => fs.unlink(path.join(this.snapshotDir, f)).catch(() => {})));
  }

  async readFile(name) {
    try {
      return JSON.parse(await fs.readFile(path.join(this.snapshotDir, name), 'utf8'));
    } catch {
      return null;
    }
  }

  /** The most recent snapshot, or null when none has been collected yet. */
  async latest() {
    const files = await this.list();
    return files.length ? this.readFile(files[files.length - 1]) : null;
  }

  /** The one before the most recent, used for diffing. */
  async previous() {
    const files = await this.list();
    return files.length > 1 ? this.readFile(files[files.length - 2]) : null;
  }
}

module.exports = { SnapshotStore, KEEP_SNAPSHOTS };
