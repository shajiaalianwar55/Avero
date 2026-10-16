let config, session = null, providers = [], providerId = '', busy = false;

const $ = (id) => document.getElementById(id);
function notice(message) { $('notice').textContent = message; }
function element(tag, text, parent, className) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  parent?.append(node);
  return node;
}

async function api(path, input, method) {
  if (session?.expires_at && session.expires_at * 1000 < Date.now() + 60000) {
    const refreshed = await fetch(`${config.url}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { apikey: config.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: session.refresh_token }),
    });
    if (!refreshed.ok) { session = null; showWorkspace(); throw Error('Your session expired. Sign in again.'); }
    session = await refreshed.json();
  }
  const response = await fetch(path, {
    method: method || (input ? 'POST' : 'GET'),
    headers: {
      'Content-Type': 'application/json',
      ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
    },
    ...(input ? { body: JSON.stringify(input) } : {}),
  });
  const data = await response.json();
  if (!response.ok) throw Error(data.error || 'Request failed');
  return data;
}

async function run(action) {
  if (busy) return;
  busy = true;
  notice('Working…');
  document.body.classList.add('busy');
  try {
    await action();
    if ($('notice').textContent === 'Working…') notice('');
  } catch (error) {
    notice(error.message);
  } finally {
    busy = false;
    document.body.classList.remove('busy');
  }
}

function showWorkspace() {
  $('auth').hidden = !!session;
  $('workspace').hidden = !session;
  $('logout').hidden = !session;
}

$('auth-form').addEventListener('submit', (event) => {
  event.preventDefault();
  run(async () => {
    const values = Object.fromEntries(new FormData(event.target));
    const signup = event.submitter.value === 'signup';
    const response = await fetch(`${config.url}/auth/v1/${signup ? 'signup' : 'token?grant_type=password'}`, {
      method: 'POST',
      headers: { apikey: config.key, 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });
    const data = await response.json();
    if (!response.ok) throw Error(data.msg || data.error_description || 'Unable to sign in');
    if (!data.access_token) { notice('Check your email to confirm your account, then sign in.'); return; }
    session = data;
    showWorkspace();
    await loadProviders();
    await renderJobs();
  });
});

$('logout').onclick = () => run(async () => {
  if (session) {
    await fetch(`${config.url}/auth/v1/logout`, {
      method: 'POST',
      headers: { apikey: config.key, Authorization: `Bearer ${session.access_token}` },
    });
  }
  session = null;
  $('feature-content').replaceChildren();
  showWorkspace();
});

$('provider-select').onchange = () => {
  providerId = $('provider-select').value;
  run(renderJobs);
};

async function loadProviders() {
  providers = await api('/api/providers');
  const select = $('provider-select');
  select.replaceChildren();
  for (const provider of providers) {
    const option = element('option', `${provider.name} · ${provider.provider_id}`, select);
    option.value = provider.provider_id;
  }
  providerId = providers[0]?.provider_id || '';
  select.value = providerId;
}

function field(label, parent, type = 'text') {
  const wrap = element('label', label, parent);
  const input = element(type === 'textarea' ? 'textarea' : 'input', '', wrap);
  if (type !== 'textarea') input.type = type;
  return input;
}

async function renderJobs() {
  const root = $('feature-content');
  root.replaceChildren();
  if (!providerId) {
    element('p', 'No providers available. Seed the Cloud database first.', root);
    return;
  }
  const jobs = await api(`/api/provider/jobs?provider_id=${encodeURIComponent(providerId)}`);
  if (!jobs.length) {
    element('p', 'No open dispatched jobs for this provider yet. Dispatch from the marketplace first.', root, 'muted');
    return;
  }
  for (const job of jobs) {
    const card = element('section', '', root, 'card');
    element('h2', job.issue_summary, card);
    element('p', `${job.category} · ${job.urgency} · ${job.location.city} / ${job.location.service_area}`, card);
    element('small', `Request ${job.service_request_id} · Dispatch ${job.dispatch_id}`, card);
    element('span', job.status, card, 'badge');
    const open = element('button', 'Respond', card);
    open.type = 'button';
    open.onclick = () => run(() => renderRespond(job));
  }
}

async function renderRespond(job) {
  const root = $('feature-content');
  root.replaceChildren();
  const back = element('button', '← Open jobs', root, 'secondary');
  back.type = 'button';
  back.onclick = () => run(renderJobs);

  const card = element('section', '', root, 'card');
  element('h2', 'Send your response', card);
  element('p', job.issue_summary, card, 'lead');
  element('p', `Responding as ${providerId}`, card, 'muted');

  const form = element('form', '', card);
  const decision = element('label', 'Decision', form);
  const select = element('select', '', decision);
  for (const [value, label] of [['accept', 'Accept and quote'], ['decline', 'Decline']]) {
    const option = element('option', label, select);
    option.value = value;
  }
  const message = field('Message or unstructured quote', form, 'textarea');
  message.placeholder = 'Example: 1500 visit, can come 7ish, parts separate, 7 day service warranty';
  const visit = field('Visit fee (PKR, optional)', form, 'number');
  const min = field('Estimate min (optional)', form, 'number');
  const max = field('Estimate max (optional)', form, 'number');
  const arrival = field('Arrival window (optional)', form);
  arrival.placeholder = '19:00-20:00';
  const warranty = field('Warranty days (optional)', form, 'number');
  const parts = element('label', '', form);
  const partsBox = element('input', '', parts);
  partsBox.type = 'checkbox';
  parts.append(' Parts included');

  const row = element('div', '', form, 'row');
  const submit = element('button', 'Submit response', row);
  submit.type = 'submit';

  form.onsubmit = (event) => {
    event.preventDefault();
    run(async () => {
      const payload = {
        provider_id: providerId,
        decision: select.value,
        message: message.value,
        visit_fee: visit.value === '' ? null : Number(visit.value),
        estimated_total_min: min.value === '' ? null : Number(min.value),
        estimated_total_max: max.value === '' ? null : Number(max.value),
        arrival_window: arrival.value.trim() || null,
        warranty_days: warranty.value === '' ? null : Number(warranty.value),
        parts_included: partsBox.checked ? true : null,
        currency: 'PKR',
      };
      const result = await api(`/api/provider/jobs/${encodeURIComponent(job.dispatch_id)}/respond`, payload);
      notice(
        result.response.decision === 'accept'
          ? `Quote saved (${result.response.response_id}). Offer draft ${result.offer_draft?.offer_id || 'n/a'} ready for normalization.`
          : `Decline recorded (${result.response.response_id}).`,
      );
      await renderJobs();
    });
  };
}

run(async () => {
  config = await api('/api/config');
});
