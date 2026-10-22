const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');

// Which local model to run for the sensitive-info check. All three are
// vision-capable Gemma 3 models, one per size bracket.
const TIERS = {
  large: { label: 'Large (27B)', model: 'gemma3:27b', note: 'Most accurate, needs ~20 GB of VRAM/RAM' },
  medium: { label: 'Medium (12B)', model: 'gemma4:12b', note: 'Good balance, ~8 GB' },
  small: { label: 'Small (4B)', model: 'gemma3:4b', note: 'Fastest, ~4 GB, least accurate' }
};

const DEFAULTS = {
  tier: 'medium',
  models: { large: TIERS.large.model, medium: TIERS.medium.model, small: TIERS.small.model },
  ollamaUrl: 'http://127.0.0.1:11434',
  openaiModel: 'gpt-4.1-mini',
  goal: '',
  intervalSeconds: 60,
  thresholdMinutes: 10,
  cooldownMinutes: 15,
  autoStart: true,
  launchAtLogin: false,
  apiKeyEnc: ''
};

let cache = null;
const file = () => path.join(app.getPath('userData'), 'config.json');

function load() {
  if (cache) return cache;
  try {
    const saved = JSON.parse(fs.readFileSync(file(), 'utf8'));
    cache = { ...DEFAULTS, ...saved, models: { ...DEFAULTS.models, ...(saved.models || {}) } };
    // Configs saved by the first build pinned the medium tier to gemma3:12b.
    if (cache.models.medium === 'gemma3:12b') cache.models.medium = DEFAULTS.models.medium;
  } catch {
    cache = { ...DEFAULTS, models: { ...DEFAULTS.models } };
  }
  return cache;
}

function save() {
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(cache, null, 2));
}

function update(patch) {
  const cfg = load();
  const allowed = Object.keys(DEFAULTS).filter((k) => k !== 'apiKeyEnc');
  for (const k of allowed) if (k in patch) cfg[k] = patch[k];
  cfg.intervalSeconds = Math.max(15, Math.min(600, Number(cfg.intervalSeconds) || 60));
  cfg.thresholdMinutes = Math.max(1, Math.min(240, Number(cfg.thresholdMinutes) || 10));
  cfg.cooldownMinutes = Math.max(1, Math.min(480, Number(cfg.cooldownMinutes) || 15));
  if (!TIERS[cfg.tier]) cfg.tier = 'medium';
  save();
  return cfg;
}

// The OpenAI key is encrypted with Windows DPAPI via Electron's safeStorage
// and never sent back to the renderer.
function setApiKey(key) {
  const cfg = load();
  if (!key) {
    cfg.apiKeyEnc = '';
  } else {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure storage is not available on this system.');
    cfg.apiKeyEnc = safeStorage.encryptString(key.trim()).toString('base64');
  }
  save();
}

function getApiKey() {
  const cfg = load();
  if (!cfg.apiKeyEnc) return '';
  try {
    return safeStorage.decryptString(Buffer.from(cfg.apiKeyEnc, 'base64'));
  } catch {
    return '';
  }
}

// Safe-to-expose view of the config.
function publicView() {
  const { apiKeyEnc, ...rest } = load();
  return { ...rest, hasKey: !!apiKeyEnc, tiers: TIERS };
}

module.exports = { TIERS, load, update, setApiKey, getApiKey, publicView };
