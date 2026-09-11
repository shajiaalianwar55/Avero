let config, session = null, homes = [], homeId = '', currentDiagnosis = null, currentView = 'care', busy = false;
const $ = (id) => document.getElementById(id);
function notice(message) { $('notice').textContent = message; }
function element(tag, text, parent, className) { const node = document.createElement(tag); if (text) node.textContent = text; if (className) node.className = className; parent?.append(node); return node; }
async function api(path, input, method) {
  if (session?.expires_at && session.expires_at * 1000 < Date.now()+60000) {
    const refreshed = await fetch(`${config.url}/auth/v1/token?grant_type=refresh_token`,{method:'POST',headers:{apikey:config.key,'Content-Type':'application/json'},body:JSON.stringify({refresh_token:session.refresh_token})});
    if (!refreshed.ok) { session=null;showWorkspace();throw Error('Your session expired. Sign in again.'); }
    session=await refreshed.json();
  }
  const response = await fetch(path, { method: method || (input ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}) }, ...(input ? { body: JSON.stringify(input) } : {}) });
  const data = await response.json(); if (!response.ok) throw Error(data.error || 'Request failed'); return data;
}
async function run(action) { if(busy)return;busy=true;notice('Working…');document.body.classList.add('busy'); try { await action(); if($('notice').textContent==='Working…')notice(''); } catch (error) { notice(error.message); } finally {busy=false;document.body.classList.remove('busy');} }
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
  session = data; currentDiagnosis=null; showWorkspace(); await loadHomes(); await renderCare();
}); });
$('logout').onclick = () => run(async () => { if (session) await fetch(`${config.url}/auth/v1/logout`, { method:'POST', headers:{ apikey:config.key, Authorization:`Bearer ${session.access_token}` } }); session = null; $('feature-content').replaceChildren(); showWorkspace(); });
$('home-form').onsubmit = (event) => { event.preventDefault(); run(async () => { const { name, ...home } = Object.fromEntries(new FormData(event.target)); await api('/api/profile', { name }); await api('/api/homes', home); await loadHomes(); currentDiagnosis=null;$('setup').open = false; await renderCare(); }); };
$('home-select').onchange = () => { homeId = $('home-select').value; currentDiagnosis=null;run(()=>renderView(currentView)); };
function button(label,parent,action,secondary=false) {const b=element('button',label,parent,secondary?'secondary':'');b.type='button';b.onclick=()=>run(action);return b;}
function field(label,parent,type='text',required=false) {const l=element('label',label,parent);const input=element(type==='textarea'?'textarea':'input','',l);if(type!=='textarea')input.type=type;input.required=required;return input;}
function list(title,items,parent) {if(!items?.length)return; element('h3',title,parent);const ul=element('ul','',parent);for(const item of items)element('li',item,ul);}
function card(title,parent=$('feature-content')) {const c=element('section','',parent,'card');element('h2',title,c);return c;}
function voice(input) {
  const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!Recognition)return;
  button('Use voice',input.parentElement,async()=>{const recognition=new Recognition();recognition.lang='en-PK';recognition.interimResults=false;recognition.onresult=e=>{input.value=e.results[0][0].transcript;input.dataset.source='voice';notice('Transcript ready. Review it before sending.');};recognition.onerror=()=>notice('Voice input was unavailable. You can type your message.');recognition.start();notice('Listening… your browser may process audio through its speech service.');},true);
  input.oninput=()=>{input.dataset.source='text';};
}
async function renderView(view) {currentView=view;if(view==='history')return renderHistory();if(view==='assets')return renderAssets();return renderCare();}
for(const nav of document.querySelectorAll('[data-view]'))nav.onclick=()=>run(()=>renderView(nav.dataset.view));
async function renderCare() {
  currentView='care';const root=$('feature-content');root.replaceChildren();if(!homeId){element('p','Add your first home to get started.',root);return;}
  if(currentDiagnosis)return renderDiagnosis();
  const c=card('What needs a little care?');element('p','Describe the issue in your own words. This is guidance, not a professional inspection. If there is immediate danger, move to safety and contact emergency services.',c);
  const form=element('form','',c);const text=field('What is happening?',form,'textarea',true);text.maxLength=4000;text.placeholder='For example: my AC is running but not cooling';voice(text);
  const label=element('label','Appliance (optional)',form);const select=element('select','',label);const none=element('option','Not linked to an appliance',select);none.value='';
  for(const asset of await api(`/api/homes/${homeId}/assets`)){const option=element('option',asset.name,select);option.value=asset.home_asset_id;}
  element('p','Your messages and photos are stored privately and sent to the configured AI provider for assessment. Avoid including personal documents or people in photos.',form,'muted');
  element('button','Start a check',form);form.onsubmit=e=>{e.preventDefault();run(async()=>{const row=await api('/api/diagnosis/sessions',{home_id:homeId,text:text.value,source:text.dataset.source||'text',asset_id:select.value||null});currentDiagnosis=row.id;await advance();});};
  const recent=await api(`/api/homes/${homeId}/diagnoses`);if(recent.length){const rec=card('Recent checks');for(const row of recent)button(row.payload.complaint,rec,async()=>{currentDiagnosis=row.id;await renderDiagnosis();},true);}
}
async function advance() {await api(`/api/diagnosis/${currentDiagnosis}/next`,{});const row=await api(`/api/diagnosis/${currentDiagnosis}`);if(row.payload.interview?.enough_information)await api(`/api/diagnosis/${currentDiagnosis}/classify`,{});await renderDiagnosis();}
async function renderDiagnosis() {
 const row=await api(`/api/diagnosis/${currentDiagnosis}`);const state=row.payload;const root=$('feature-content');root.replaceChildren();button('← New check',root,async()=>{currentDiagnosis=null;await renderCare();},true);
 const c=card('Your maintenance check');element('p',state.complaint,c,'lead');element('small',`Check ${row.id}`,c);
 if(state.history_context?.related_repair_ids.length){const history=card('Your home remembers');element('p',state.history_context.warranty_reuse_recommendation||'We found potentially related past repairs.',history);for(const record of state.history_context.history_context)button(`${record.issue_summary} · ${record.provider_name}`,history,()=>renderRecord(record.repair_record_id),true);}
 if(!state.safety.safe_to_continue){const alert=card(state.safety.safety_flags.length?'Stop — possible emergency':'Pause troubleshooting');alert.classList.add('warning');list('Next steps',state.safety.immediate_actions,alert);list('Do not',state.safety.prohibited_actions,alert);}
 const conversation=card('What we know');for(const message of row.messages){const p=element('p','',conversation,message.payload.role==='user'?'message user':'message');element('strong',message.payload.role==='user'?'You: ':'Avero: ',p);p.append(document.createTextNode(message.payload.text));}
 if(!state.safety.safety_flags.length){
   const form=element('form','',conversation);const text=field('Add an answer or new detail',form,'textarea',true);text.maxLength=4000;voice(text);element('button','Send answer',form);form.onsubmit=e=>{e.preventDefault();run(async()=>{await api(`/api/diagnosis/${currentDiagnosis}/messages`,{text:text.value,source:text.dataset.source||'text'});await advance();});};
   const photo=field('Add a photo from a safe location (JPEG, PNG, WebP; max 4 MB)',conversation,'file');photo.accept='image/jpeg,image/png,image/webp';
   photo.onchange=()=>run(async()=>{const file=photo.files[0];if(!file)return;if(file.size>4*1024*1024)throw Error('Choose a photo under 4 MB');const base64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=reject;reader.readAsDataURL(file);});const att=await api(`/api/diagnosis/${currentDiagnosis}/attachments`,{mime_type:file.type,base64});await api(`/api/diagnosis/${currentDiagnosis}/vision`,{attachment_id:att.attachment_id});await advance();});
   button('Get recommendation',conversation,async()=>{await api(`/api/diagnosis/${currentDiagnosis}/classify`,{});await renderDiagnosis();},true);
 }
 for(const visual of state.visual_assessments){const v=card('Photo findings');element('p',visual.explanation,v);list('Visible evidence',visual.visual_findings,v);element('small',`Confidence: ${Math.round(visual.confidence*100)}%`,v);}
 if(state.classification){
   const summary=await api(`/api/diagnosis/${currentDiagnosis}/summary`);const outcome=card(`Recommended: ${state.classification.classification}`);element('p',summary.recommended_action,outcome);element('p',state.classification.reason,outcome);element('small',`Urgency: ${summary.urgency} · Confidence: ${Math.round(summary.confidence*100)}%`,outcome);if(summary.likely_issue)element('p',`Possible issue: ${summary.likely_issue}`,outcome);list('Other possibilities',summary.alternatives,outcome);list('Still uncertain',summary.uncertainty_notes,outcome);
   button('Why Avero recommends this',outcome,async()=>{const evidence=await api(`/api/diagnosis/${currentDiagnosis}/evidence`);let panel=outcome.querySelector('.evidence');if(panel)panel.remove();panel=element('div','',outcome,'evidence');list('Your reported facts',evidence.observed_facts,panel);list('Concerns',evidence.concerns,panel);list('Ruled-out basics',evidence.ruled_out_basics,panel);list('Uncertainty',evidence.uncertainty_notes,panel);list('What could change this',evidence.what_would_change_decision,panel);},true);
   if(state.classification.classification==='technician'){const windows=field('Preferred visit times (optional; separate with commas)',outcome);button('Create technician request',outcome,async()=>{const ticket=await api('/api/service-requests',{diagnosis_session_id:currentDiagnosis,preferred_windows:windows.value.split(',').map(s=>s.trim()).filter(Boolean)});notice(`Request ${ticket.request_id} saved (${ticket.status}). Ready for the marketplace to find providers.`);});}
   if(state.classification.classification==='diy'){
     const box=element('div','',outcome);element('p','Before starting: handheld remote only, disconnected from charging; a dry, cool, undamaged compartment with no leakage, swelling or corrosion. Have new batteries of the specified type. Keep batteries away from children and pets.',box);
     const confirmed=field('I confirm all safety conditions and have the correct batteries',box,'checkbox');button('Start guided fix',box,async()=>{if(!confirmed.checked)throw Error('Confirm the safety conditions first.');const guide=await api('/api/diy/start',{diagnosis_session_id:currentDiagnosis,preconditions_confirmed:true,tools_available:true});renderGuide(guide);});
   }
 }
}
function renderGuide(guide) {
 document.querySelector('#guide')?.remove();const c=card('One step at a time');c.id='guide';list('Tools',guide.tools,c);list('Safety conditions',guide.safety_preconditions,c);list('Stop if',guide.stop_conditions,c);
 if(guide.status!=='active'){element('p',guide.status==='completed'?'You completed the guide. If the problem returns, start a new check.':'Guide stopped. Return to your recommendation for the next safe step.',c);button('View recommendation',c,renderDiagnosis);return;}
 element('h3',`Step ${guide.step_index+1}`,c);element('p',guide.current_step.instruction,c);element('p',`Expected: ${guide.expected_result}`,c);const note=field('Anything different? (optional; new details pause the guide for reassessment)',c,'textarea');
 for(const [label,result] of [['Done — expected result','done'],['Looks different','different'],['Did not work','failure'],['Stop','stop']])button(label,c,async()=>{const updated=await api(`/api/diy/${guide.guide_id}/step-result`,{step_index:guide.step_index,result,note:note.value});if(updated.status==='stopped'){await renderDiagnosis();}renderGuide(updated);},result!=='done');c.scrollIntoView({behavior:'smooth',block:'start'});
}
async function renderHistory() {
 const root=$('feature-content');root.replaceChildren();if(!homeId)return;element('h2','Your home’s story',root);button('Refresh history',root,renderHistory,true);const records=await api(`/api/homes/${homeId}/history`);if(!records.length)element('p','Completed repairs will appear here automatically.',root);
 for(const record of records){const c=card(record.issue_summary);element('p',`${new Date(record.completed_at).toLocaleDateString()} · ${record.provider_name}`,c);element('p',record.work_done,c);element('p',new Intl.NumberFormat('en-PK',{style:'currency',currency:record.currency}).format(record.amount_paid),c);element('p',record.warranty_end?`Warranty through ${record.warranty_end}${record.warranty_end>=new Date().toISOString().slice(0,10)?' · Active':' · Expired'}`:'No warranty recorded',c);button('Repair details',c,()=>renderRecord(record.repair_record_id),true);}
}
async function renderRecord(id) {currentView='detail';const r=await api(`/api/repair-records/${id}`);$('feature-content').replaceChildren();button('← History',$('feature-content'),()=>renderView('history'),true);const c=card(r.issue_summary);for(const [label,key]of [['Diagnosis','diagnosis'],['Work done','work_done'],['Technician','provider_name'],['Completed','completed_at'],['Warranty end','warranty_end'],['Notes','notes']]){element('h3',label,c);element('p',r[key]||'Not recorded',c);}element('p',`${r.currency} ${r.amount_paid}`,c);if(r.asset_id)button('View appliance',c,()=>renderAsset(r.asset_id),true);}
async function renderAssets() {
 $('feature-content').replaceChildren();if(!homeId)return;const c=card('Your appliances');for(const a of await api(`/api/homes/${homeId}/assets`))button(`${a.name} · ${a.type}`,c,()=>renderAsset(a.home_asset_id),true);
 const form=element('form','',card('Add an appliance'));const fields={};for(const [key,label]of [['name','Name'],['type','Type'],['make','Make (optional)'],['model','Model (optional)'],['serial','Serial (optional)']]){fields[key]=field(label,form,'text',['name','type'].includes(key));fields[key].maxLength=100;}
 const photos=await api(`/api/homes/${homeId}/photos`);const l=element('label','Photo from one of this home’s checks (optional)',form);const select=element('select','',l);const no=element('option','No photo',select);no.value='';for(const photo of photos){const option=element('option',photo.caption||photo.attachment_id,select);option.value=photo.attachment_id;}
 element('button','Save appliance',form);form.onsubmit=e=>{e.preventDefault();run(async()=>{const a=await api(`/api/homes/${homeId}/assets`,{...Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,v.value])),photo_attachment_id:select.value||null});await renderAsset(a.home_asset_id);});};
}
async function renderAsset(id) {currentView='detail';const a=await api(`/api/assets/${id}`);$('feature-content').replaceChildren();button('← Appliances',$('feature-content'),()=>renderView('assets'),true);const c=card(a.name);element('p',[a.type,a.make,a.model,a.serial].filter(Boolean).join(' · '),c);if(a.photo_attachment_id){const response=await fetch(`/api/attachments/${a.photo_attachment_id}`,{headers:{Authorization:`Bearer ${session.access_token}`}});if(response.ok){const image=element('img','',c);image.alt=a.name;const src=URL.createObjectURL(await response.blob());image.onload=()=>URL.revokeObjectURL(src);image.src=src;}}if(!a.history.length)element('p','No repairs linked yet.',c);for(const r of a.history)button(`${r.issue_summary} · ${new Date(r.completed_at).toLocaleDateString()}`,c,()=>renderRecord(r.repair_record_id),true);}
setInterval(()=>{if(session&&currentView==='history'&&!document.hidden&&!busy)run(renderHistory);},10000);
window.addEventListener('focus',()=>{if(session&&currentView==='history'&&!busy)run(renderHistory);});
run(async () => { config = await api('/api/config'); });
