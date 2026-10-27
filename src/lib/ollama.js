const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const SYSTEM_PROMPT = `You are a privacy filter. You look at a screenshot and decide whether it shows SENSITIVE information that must never leave this computer.

Sensitive means ANY of:
- passwords, passcodes, 2FA/recovery codes, API keys, access tokens, private keys, secrets, .env files or credential files
- login, sign-up, password-reset or payment forms, or a password manager
- credit/debit card numbers, bank or brokerage accounts, balances, tax or payroll documents
- government IDs, SSNs, passports, driver's licences
- private messages, emails, or chats whose contents are readable
- medical, legal or other confidential personal records
- home addresses, phone numbers or other personal data of private individuals

If you are unsure, say it is sensitive. Ordinary content (code editors without secrets, documentation, videos, games, social feeds, web pages, desktops) is not sensitive.

Reply with ONLY JSON: {"sensitive": true|false, "reason": "<max 8 words, no copied secrets>"}`;

const join = (base, p) => base.replace(/\/+$/, '') + p;

// fetch() gives up after 5 minutes of silence no matter what signal is passed,
// which is too short for a big model on a CPU-only machine. Plain http has no such cap.
function postJson(url, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? require('https') : require('http');
    const req = lib.request(u, { method: 'POST', headers: { 'Content-Type': 'application/json' } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', reject);
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('Local model timed out')));
    req.on('error', reject);
    req.end(JSON.stringify(body));
  });
}

async function isUp(baseUrl) {
  try {
    const r = await fetch(join(baseUrl, '/api/tags'), { signal: AbortSignal.timeout(2500) });
    return r.ok;
  } catch {
    return false;
  }
}

// Start `ollama serve` if it is installed but not running.
async function ensureRunning(baseUrl) {
  if (await isUp(baseUrl)) return true;
  const candidates = [
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'Ollama', 'ollama.exe'),
    'C:\\Program Files\\Ollama\\ollama.exe',
    'ollama'
  ].filter(Boolean);
  for (const exe of candidates) {
    if (exe !== 'ollama' && !fs.existsSync(exe)) continue;
    try {
      const child = spawn(exe, ['serve'], { detached: true, stdio: 'ignore', windowsHide: true });
      child.on('error', () => {});
      child.unref();
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 500));
        if (await isUp(baseUrl)) return true;
      }
    } catch {
      /* try next */
    }
  }
  return false;
}

async function listModels(baseUrl) {
  const r = await fetch(join(baseUrl, '/api/tags'), { signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error(`Ollama responded ${r.status}`);
  const data = await r.json();
  return (data.models || []).map((m) => m.name);
}

function hasModel(installed, wanted) {
  const w = wanted.includes(':') ? wanted : wanted + ':latest';
  return installed.some((n) => n === w || n === wanted);
}

// Returns { sensitive, reason }. Fails CLOSED: anything other than an explicit
// "sensitive": false counts as sensitive, and errors are thrown to the caller
// (which must then discard the screenshot rather than upload it).
async function classify(cfg, jpeg) {
  const model = cfg.models[cfg.tier];
  const r = await postJson(
    join(cfg.ollamaUrl, '/api/chat'),
    {
      model,
      stream: false,
      format: 'json',
      think: false, // skip reasoning tokens on thinking-capable models; we only need the JSON verdict
      keep_alive: '10m',
      // The verdict is a few dozen tokens and the prompt + image fit easily in 2k,
      // so cap both: decoding and KV allocation are slow on CPU.
      options: { temperature: 0, num_predict: 80, num_ctx: 2048 },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: 'Is this screenshot sensitive?', images: [jpeg.toString('base64')] }
      ]
    },
    15 * 60 * 1000 // CPU-only machines can need minutes per image
  );
  if (r.status < 200 || r.status >= 300) {
    throw new Error(`Local model error (${r.status}) ${r.text.slice(0, 200)}`);
  }
  const data = JSON.parse(r.text);
  let parsed = {};
  try {
    parsed = JSON.parse(data.message?.content || '{}');
  } catch {
    /* unparseable -> treated as sensitive below */
  }
  const sensitive = !(parsed.sensitive === false || String(parsed.sensitive).toLowerCase() === 'false');
  return { sensitive, reason: String(parsed.reason || (sensitive ? 'unclear output, treated as sensitive' : '')).slice(0, 120) };
}

async function pull(baseUrl, model, onProgress) {
  const r = await fetch(join(baseUrl, '/api/pull'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, stream: true })
  });
  if (!r.ok || !r.body) throw new Error(`Download failed (${r.status})`);
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      if (msg.error) throw new Error(msg.error);
      onProgress({ model, status: msg.status, completed: msg.completed || 0, total: msg.total || 0 });
    }
  }
}

module.exports = { ensureRunning, isUp, listModels, hasModel, classify, pull };
