let config, session = null, homes = [], homeId = '';
const $ = (id) => document.getElementById(id);
function notice(message) { $('notice').textContent = message; }
function element(tag, text, parent, className) { const node = document.createElement(tag); if (text) node.textContent = text; if (className) node.className = className; parent?.append(node); return node; }
async function api(path, input, method) {
  const response = await fetch(path, { method: method || (input ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}) }, ...(input ? { body: JSON.stringify(input) } : {}) });
  const data = await response.json(); if (!response.ok) throw Error(data.error || 'Request failed'); return data;
}
async function run(action) { notice(''); try { await action(); } catch (error) { notice(error.message); } }
async function loadHomes() {
  homes = await api('/api/homes'); $('home-select').replaceChildren();
  for (const home of homes) { const option = element('option', `${home.label} · ${home.service_area}`, $('home-select')); option.value = home.id; }
  homeId = homes[0]?.id || ''; $('setup').open = !homeId;
}
function showWorkspace() { $('auth').hidden = !!session; $('workspace').hidden = !session; $('logout').hidden = !session; }
$('auth-form').addEventListener('submit', (event) => { event.preventDefault(); run(async () => {
  const values = Object.fromEntries(new FormData(event.target)); const signup = event.submitter.value === 'signup';
  const response = await fetch(`${config.url}/auth/v1/${signup ? 'signup' : 'token?grant_type=password'}`, { method:'POST', headers:{ apikey:config.key, 'Content-Type':'application/json' }, body:JSON.stringify(values) });
  const data = await response.json(); if (!response.ok) throw Error(data.msg || data.error_description || 'Unable to sign in');
  if (!data.access_token) { notice('Check your email to confirm your account, then sign in.'); return; }
  session = data; showWorkspace(); await loadHomes(); renderCare();
}); });
$('logout').onclick = () => run(async () => { if (session) await fetch(`${config.url}/auth/v1/logout`, { method:'POST', headers:{ apikey:config.key, Authorization:`Bearer ${session.access_token}` } }); session = null; $('feature-content').replaceChildren(); showWorkspace(); });
$('home-form').onsubmit = (event) => { event.preventDefault(); run(async () => { const { name, ...home } = Object.fromEntries(new FormData(event.target)); await api('/api/profile', { name }); await api('/api/homes', home); await loadHomes(); $('setup').open = false; renderCare(); }); };
$('home-select').onchange = () => { homeId = $('home-select').value; renderCare(); };
function renderCare() { $('feature-content').replaceChildren(); element('p', homeId ? 'Your home is ready. Start a maintenance check here.' : 'Add your first home to get started.', $('feature-content')); }
run(async () => { config = await api('/api/config'); });
