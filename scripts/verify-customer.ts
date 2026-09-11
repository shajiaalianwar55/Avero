// Local-only integration test. Never connects to the configured hosted project.
import {execSync,spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {createClient} from '@supabase/supabase-js';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import {chromium,expect} from '@playwright/test';
const local=JSON.parse(execSync('supabase status -o json',{stdio:['ignore','pipe','ignore']}).toString());
assert.equal(new URL(local.API_URL).hostname,'127.0.0.1');
const client=createClient(local.API_URL,local.SERVICE_ROLE_KEY,{auth:{persistSession:false}});
const loginClient=createClient(local.API_URL,local.ANON_KEY,{auth:{persistSession:false}});
const port='3017';const base=`http://127.0.0.1:${port}`;const tag=randomUUID();const userIds:string[]=[];let homeId='',diagId='';
const app=spawn(process.execPath,['--import','tsx','apps/customer/src/server.ts'],{env:{...process.env,SUPABASE_URL:local.API_URL,SUPABASE_SERVICE_ROLE_KEY:local.SERVICE_ROLE_KEY,SUPABASE_SECRET_KEY:local.SECRET_KEY,SUPABASE_ANON_KEY:local.ANON_KEY,SUPABASE_PUBLISHABLE_KEY:local.PUBLISHABLE_KEY,CUSTOMER_APP_PORT:port,OPENAI_API_KEY:'',AI_PROVIDER:'openai'},stdio:['ignore','pipe','pipe'],windowsHide:true});
let token='';
async function api(path:string,input?:unknown,expected=200){const response=await fetch(`${base}${path}`,{method:input?'POST':'GET',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(input?{body:JSON.stringify(input)}:{})});const data=await response.json();assert.equal(response.status,expected,`${path}: ${JSON.stringify(data)}`);return data;}
try{
 for(let i=0;i<60;i++){try{if((await fetch(`${base}/health`)).ok)break;}catch{}await delay(250);}
 for(const role of ['alice','bob']){const {data,error}=await client.auth.admin.createUser({email:`avero-test-${role}-${tag}@example.com`,password:`Test-${tag}!`,email_confirm:true});assert.ifError(error);userIds.push(data.user!.id);}
 const auth=await loginClient.auth.signInWithPassword({email:`avero-test-alice-${tag}@example.com`,password:`Test-${tag}!`});assert.ifError(auth.error);token=auth.data.session!.access_token;
 await api('/api/profile',{name:'Integration Test'}); const home=await api('/api/homes',{label:'Test Home',city:'Islamabad',service_area:'F-10'},201);homeId=home.id;
 const asset=await api(`/api/homes/${homeId}/assets`,{name:'Test AC',type:'AC'},201);
 const session=await api('/api/diagnosis/sessions',{home_id:homeId,text:'AC is not cooling',asset_id:asset.home_asset_id},201);diagId=session.id;
 const outcome=await api(`/api/diagnosis/${diagId}/classify`,{});assert.equal(outcome.classification,'technician');
 const ticket=await api('/api/service-requests',{diagnosis_session_id:diagId},201);assert.equal(ticket.home_id,homeId);assert.equal((await api('/api/service-requests',{diagnosis_session_id:diagId},201)).request_id,ticket.request_id);
 await api(`/api/diagnosis/${diagId}/evidence`);
 const repairId=`repair_${tag}`;const repair={repair_record_id:repairId,home_id:homeId,asset_id:asset.home_asset_id,service_request_id:ticket.request_id,booking_id:`booking_${tag}`,issue_summary:'AC cooling issue',diagnosis:'AC filter clogged',work_done:'Filter cleaned',provider_name:'Test Technician',amount_paid:1500,currency:'PKR',completed_at:new Date().toISOString(),warranty_end:'2099-12-31',notes:null};
 assert.ifError((await client.from('repair_records').insert({id:repairId,home_id:homeId,service_request_id:ticket.request_id,payload:repair,completed_at:repair.completed_at})).error);
 assert.equal((await api(`/api/homes/${homeId}/history`)).length,1);assert.equal((await api(`/api/assets/${asset.home_asset_id}`)).history.length,1);assert.equal((await api(`/api/homes/${homeId}/context?query=AC%20not%20cooling`)).active_warranty_match,true);
 await api(`/api/diagnosis/${diagId}/messages`,{text:'Now I smell gas'} ,201);assert.equal((await api(`/api/diagnosis/${diagId}/classify`,{})).classification,'emergency');await api('/api/service-requests',{diagnosis_session_id:diagId},409);
 const publicClient=createClient(local.API_URL,local.ANON_KEY);const anonymous=await publicClient.from('diagnosis_sessions').select('*');assert.ok(anonymous.error || anonymous.data?.length===0);
 const bob=await loginClient.auth.signInWithPassword({email:`avero-test-bob-${tag}@example.com`,password:`Test-${tag}!`});assert.ifError(bob.error);token=bob.data.session!.access_token;
 await api(`/api/diagnosis/${diagId}`,undefined,404);await api(`/api/homes/${homeId}/history`,undefined,404);await api(`/api/assets/${asset.home_asset_id}`,undefined,404);await api(`/api/repair-records/${repairId}`,undefined,404);
 if(process.argv.includes('--browser')) {
   const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL || 'msedge',headless:true});
   try { const page=await browser.newPage({viewport:{width:1280,height:900}});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
     await page.goto(base);await page.getByLabel('Email',{exact:true}).fill(`avero-test-alice-${tag}@example.com`);await page.getByLabel('Password',{exact:true}).fill(`Test-${tag}!`);await page.getByRole('button',{name:'Sign in',exact:true}).click();
     await expect(page.getByRole('heading',{name:'What needs a little care?'})).toBeVisible();
     await page.getByRole('button',{name:'Home History',exact:true}).click();await expect(page.getByText('Filter cleaned',{exact:true})).toBeVisible();await mkdir('var/browser-qa',{recursive:true});await page.screenshot({path:'var/browser-qa/history-desktop.png',fullPage:true});
     await page.getByRole('button',{name:'My appliances',exact:true}).click();await page.getByRole('button',{name:'Test AC · AC',exact:true}).click();await expect(page.getByRole('heading',{name:'Test AC',exact:true})).toBeVisible();
     await page.getByRole('button',{name:'Home care',exact:true}).click();await page.getByRole('button',{name:'AC is not cooling',exact:true}).click();await expect(page.getByRole('heading',{name:'Stop — possible emergency'})).toBeVisible();
     await page.setViewportSize({width:390,height:844});await page.screenshot({path:'var/browser-qa/emergency-mobile.png',fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'Mobile page must not overflow horizontally');assert.deepEqual(errors,[]);
     console.log('PASS: desktop/mobile browser sign-in, history, appliance details, emergency state; no page errors or horizontal overflow.');
   } finally {await browser.close();}
 }
 console.log('PASS: local auth, profile, home, asset, diagnosis, fallback, ticket retry, history, warranty, emergency override, RLS and cross-user isolation.');
} finally {
 app.kill();
 // Exact test-owned rows only, in foreign-key order; never reset the user's database.
 if(homeId){await client.from('repair_records').delete().eq('home_id',homeId);await client.from('service_requests').delete().eq('home_id',homeId);await client.from('home_assets').delete().eq('home_id',homeId);}
 if(diagId){for(const table of ['visual_assessments','safety_events','diagnosis_messages','attachments','diy_sessions'])await client.from(table).delete().eq('session_id',diagId);await client.from('ai_events').delete().eq('input_record_id',diagId);await client.from('diagnosis_sessions').delete().eq('id',diagId);}
 if(homeId){await client.from('ai_events').delete().eq('input_record_id',homeId);await client.from('homes').delete().eq('id',homeId);}
 for(const id of userIds){await client.from('users').delete().eq('id',id);await client.auth.admin.deleteUser(id);}
 console.log('Removed only the temporary integration-test records and accounts.');
}
