const $ = (id) => document.getElementById(id);
let cfg = null;
let ollama = { up: false, installed: {} };
const progress = {}; // tier -> text
const pulling = new Set();

const TAGS = { ontask: 'On task', offtask: 'Off task', deleted: 'Deleted', error: 'Error' };

function save(patch) {
  return window.api.setConfig(patch).then((c) => { cfg = c; });
}

function renderTiers() {
  const wrap = $('tiers');
  wrap.textContent = '';
  for (const [tier, info] of Object.entries(cfg.tiers)) {
    const el = document.createElement('div');
    el.className = 'tier' + (cfg.tier === tier ? ' sel' : '');
    el.innerHTML = '<input type="radio" name="tier"><div class="meta"><div class="name"></div><div class="note"></div></div><span class="badge"></span>';
    el.querySelector('input').checked = cfg.tier === tier;
    el.querySelector('.name').textContent = `${info.label} · ${cfg.models[tier]}`;
    el.querySelector('.note').textContent = info.note;
    const badge = el.querySelector('.badge');
    const installed = ollama.installed[tier];
    if (progress[tier]) badge.textContent = progress[tier];
    else if (!ollama.up) badge.textContent = 'Ollama offline';
    else if (installed) { badge.textContent = 'Installed'; badge.classList.add('ok'); }
    else {
      const b = document.createElement('button');
      b.textContent = 'Download';
      b.disabled = pulling.has(tier);
      b.onclick = (ev) => { ev.stopPropagation(); download(tier); };
      badge.replaceWith(b);
    }
    el.onclick = async () => { await save({ tier }); renderTiers(); };
    wrap.appendChild(el);
  }
  $('ollamaNote').textContent = ollama.up
    ? ''
    : 'Ollama was not detected. Install it from ollama.com, then reopen this app.';
}

async function download(tier) {
  pulling.add(tier);
  progress[tier] = 'Starting...';
  renderTiers();
  try {
    ollama = await window.api.pullModel(tier);
  } catch (err) {
    alert(`Download failed: ${err.message || err}`);
  }
  pulling.delete(tier);
  delete progress[tier];
  renderTiers();
}

function renderStatus(s) {
  const pill = $('state');
  pill.className = 'pill';
  if (!s.running) pill.textContent = 'Paused';
  else if (s.busy) { pill.textContent = 'Checking...'; pill.classList.add('busy'); }
  else {
    pill.classList.add('on');
    pill.textContent = s.offTaskMinutes > 0 ? `Tracking · off task ${s.offTaskMinutes} min` : 'Tracking';
  }
  $('toggle').textContent = s.running ? 'Pause' : 'Start';
}

function addLog(e, prepend = true) {
  const li = document.createElement('li');
  li.className = e.kind;
  const time = document.createElement('time');
  time.textContent = new Date(e.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const tag = document.createElement('span');
  tag.className = 'tag';
  tag.textContent = TAGS[e.kind] || e.kind;
  const text = document.createElement('span');
  text.textContent = e.text;
  li.append(time, tag, text);
  const list = $('log');
  prepend ? list.prepend(li) : list.append(li);
  while (list.children.length > 100) list.lastChild.remove();
}

function bindField(id, key, num) {
  const el = $(id);
  el.addEventListener('change', () => {
    const v = el.type === 'checkbox' ? el.checked : num ? Number(el.value) : el.value.trim();
    save({ [key]: v }).then(() => { el.value = cfg[key]; });
  });
}

function refreshKeyUi() {
  $('keyState').textContent = cfg.hasKey ? '(saved)' : '(not set)';
  $('key').value = '';
  $('key').placeholder = cfg.hasKey ? '••••••••••••••••' : 'sk-...';
}

async function init() {
  cfg = await window.api.getConfig();
  $('goal').value = cfg.goal;
  $('threshold').value = cfg.thresholdMinutes;
  $('interval').value = cfg.intervalSeconds;
  $('cooldown').value = cfg.cooldownMinutes;
  $('model').value = cfg.openaiModel;
  $('autoStart').checked = cfg.autoStart;
  $('launchAtLogin').checked = cfg.launchAtLogin;
  refreshKeyUi();

  bindField('goal', 'goal');
  bindField('threshold', 'thresholdMinutes', true);
  bindField('interval', 'intervalSeconds', true);
  bindField('cooldown', 'cooldownMinutes', true);
  bindField('model', 'openaiModel');
  bindField('autoStart', 'autoStart');
  bindField('launchAtLogin', 'launchAtLogin');

  $('saveKey').onclick = async () => {
    const k = $('key').value.trim();
    if (!k) return;
    try { cfg = await window.api.setKey(k); } catch (err) { alert(err.message || err); }
    refreshKeyUi();
  };
  $('clearKey').onclick = async () => { cfg = await window.api.setKey(''); refreshKeyUi(); };

  $('toggle').onclick = async () => {
    if (!cfg.hasKey && $('toggle').textContent === 'Start') {
      alert('Add your OpenAI API key first.');
      return;
    }
    renderStatus(await window.api.toggle());
  };
  $('check').onclick = () => window.api.checkNow();

  window.api.onStatus(renderStatus);
  window.api.onLog((e) => addLog(e));
  window.api.onProgress((p) => {
    const pct = p.total ? ` ${Math.round((p.completed / p.total) * 100)}%` : '';
    progress[p.tier] = `${p.status}${pct}`;
    renderTiers();
  });

  const state = await window.api.trackerState();
  renderStatus(state.status);
  [...state.log].reverse().forEach((e) => addLog(e));

  renderTiers();
  ollama = await window.api.ollamaStatus();
  renderTiers();
}

init();
