const { EventEmitter } = require('events');
const config = require('./config');
const { captureScreen } = require('./capture');
const ollama = require('./ollama');
const openai = require('./openai');

const HISTORY_SIZE = 8;

class Tracker extends EventEmitter {
  constructor() {
    super();
    this.timer = null;
    this.running = false;
    this.busy = false;
    this.history = []; // conclusive readings only: { activity, onTask, at }
    this.offTaskSince = null;
    this.lastNotified = 0;
    this.log = []; // what the UI shows; descriptions only, never images
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.schedule(2000); // first check shortly after starting
    this.emitStatus();
  }

  stop() {
    this.running = false;
    clearTimeout(this.timer);
    this.timer = null;
    this.offTaskSince = null;
    this.emitStatus();
  }

  schedule(ms) {
    clearTimeout(this.timer);
    if (!this.running) return;
    this.timer = setTimeout(async () => {
      await this.tick();
      this.schedule(config.load().intervalSeconds * 1000);
    }, ms);
  }

  status() {
    const offMin = this.offTaskSince ? (Date.now() - this.offTaskSince) / 60000 : 0;
    return { running: this.running, busy: this.busy, offTaskMinutes: Math.round(offMin * 10) / 10 };
  }

  emitStatus() {
    this.emit('status', this.status());
  }

  addLog(entry) {
    const e = { at: Date.now(), ...entry };
    this.log.unshift(e);
    this.log.length = Math.min(this.log.length, 100);
    this.emit('log', e);
    this.emitStatus();
  }

  async tick() {
    // A big local model can take longer than the interval; never overlap runs.
    if (this.busy) return;
    this.busy = true;
    this.emitStatus();
    try {
      await this.runOnce();
    } finally {
      this.busy = false;
      this.emitStatus();
    }
  }

  async runOnce() {
    const cfg = config.load();

    let jpeg = null;
    try {
      jpeg = await captureScreen();
    } catch (err) {
      return this.addLog({ kind: 'error', text: `Capture failed: ${err.message}` });
    }

    // 1) Local on-device check. If it cannot run, the screenshot is dropped,
    //    never uploaded.
    let verdict;
    try {
      if (!(await ollama.ensureRunning(cfg.ollamaUrl))) throw new Error('Ollama is not running');
      verdict = await ollama.classify(cfg, jpeg);
    } catch (err) {
      jpeg = null;
      return this.addLog({ kind: 'error', text: `Local check failed, screenshot discarded: ${err.message}` });
    }

    if (verdict.sensitive) {
      jpeg = null;
      return this.addLog({ kind: 'deleted', text: `Sensitive, screenshot deleted${verdict.reason ? ` (${verdict.reason})` : ''}` });
    }

    // 2) Safe to send.
    let result;
    try {
      result = await openai.analyze(cfg, config.getApiKey(), jpeg, this.history);
    } catch (err) {
      return this.addLog({ kind: 'error', text: err.message });
    } finally {
      jpeg = null;
    }

    this.history.push({ activity: result.activity, onTask: result.onTask, at: Date.now() });
    if (this.history.length > HISTORY_SIZE) this.history.shift();

    if (result.onTask) {
      this.offTaskSince = null;
    } else if (!this.offTaskSince) {
      this.offTaskSince = Date.now();
    }
    this.addLog({ kind: result.onTask ? 'ontask' : 'offtask', text: result.activity });
    this.checkSidetracked(cfg, result);
  }

  checkSidetracked(cfg, result) {
    if (!this.offTaskSince) return;
    const mins = (Date.now() - this.offTaskSince) / 60000;
    const sinceLast = (Date.now() - this.lastNotified) / 60000;
    if (mins >= cfg.thresholdMinutes && sinceLast >= cfg.cooldownMinutes) {
      this.lastNotified = Date.now();
      this.emit('sidetracked', { minutes: Math.round(mins), activity: result.activity, goal: cfg.goal });
    }
  }
}

module.exports = { Tracker };
