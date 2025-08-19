
const API = location.origin + "/api";
function qs(s, el=document){ return el.querySelector(s); }
function el(tag, attrs={}, children=[]){ const e=document.createElement(tag); Object.entries(attrs).forEach(([k,v])=> (k in e)? e[k]=v : e.setAttribute(k,v)); children.forEach(c => e.appendChild(typeof c==='string'? document.createTextNode(c): c)); return e; }
function token(){ return localStorage.getItem('cv_token') || ''; }
function setToken(t){ if(t) localStorage.setItem('cv_token', t); else localStorage.removeItem('cv_token'); }
function authHeader(){ return token()? { 'Authorization': 'Bearer ' + token() } : {}; }

async function ensureAuth(){
  if(token()) return true;
  const action = prompt("Digite 1 para Entrar, 2 para Cadastrar");
  if(action !== '1' && action !== '2') return false;
  const email = prompt("Email:"); const password = prompt("Senha (mín. 6 chars):"); if(!email||!password) return false;
  if(action==='2'){
    const name = prompt("Nome da empresa:");
    const res = await fetch(API + "/auth/register", {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ name, email, password })});
    const data = await res.json(); if(data.token){ setToken(data.token); alert("Cadastro realizado!"); return true;} else { alert("Erro: " + JSON.stringify(data)); return false; }
  }else{
    const res = await fetch(API + "/auth/login", {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ email, password })});
    const data = await res.json(); if(data.token){ setToken(data.token); alert("Login ok!"); return true;} else { alert("Erro: " + (data.error||'Falha')); return false; }
  }
}

async function loadJobs(params={}){
  const url = new URL(API + "/jobs"); Object.entries(params).forEach(([k,v]) => (v!==undefined && v!=='') && url.searchParams.set(k,v));
  const res = await fetch(url); return await res.json();
}
function renderJobs(container, payload){
  const { jobs, total, page, pageSize } = payload; container.innerHTML='';
  if(!jobs.length){ container.appendChild(el('p', { className:'muted' }, ['Nenhuma vaga encontrada.'])); return; }
  jobs.forEach(j => {
    const card = el('div', { className:'job' });
    const left = el('div', {}, [
      el('div', { className:'job-title' }, [j.title]),
      el('div', { className:'job-meta' }, [`${j.company} • ${j.location} • ${new Date(j.created_at).toLocaleDateString('pt-BR')}`]),
      el('div', { className:'tags' }, [
        j.urgent? el('span', { className:'badge warn' }, ['Urgente']) : '',
        j.no_exp? el('span', { className:'badge' }, ['Sem experiência']) : '',
        j.remote? el('span', { className:'badge ok' }, ['Remoto']) : '',
        ...(j.tags? j.tags.split(',').map(t=>t.trim()).filter(Boolean).slice(0,4).map(t=>el('span', { className:'tag' }, [t])): [])
      ].filter(Boolean))
    ]);
    const right = el('div', {}, [ el('a', { className:'btn', href:'#', onclick: (e)=>{ e.preventDefault(); openJob(j.id); } }, ['Ver detalhes']) ]);
    card.append(left, right); container.appendChild(card);
  });
  const pager = qs('#pager'); pager.innerHTML=''; const pages = Math.ceil(total / pageSize);
  if(pages>1){ for(let p=1;p<=pages;p++){ const b = el('button', { className:'badge' + (p===page? ' ok':''), onclick: () => refresh({ page: p }) }, [String(p)]); pager.appendChild(b);} }
}
async function openJob(id){
  const res = await fetch(API + "/jobs/" + id); const j = await res.json();
  const html = `
    <div class="card" style="position:fixed; inset:10% 10%; background:white; z-index:100; overflow:auto">
      <div style="display:flex; justify-content:space-between; align-items:center"><h2>${j.title}</h2><button class="btn light" id="closeModal">Fechar</button></div>
      <p class="job-meta">${j.company} • ${j.location} • ${new Date(j.created_at).toLocaleString('pt-BR')}</p>
      <div class="tags">
        ${j.urgent? '<span class="badge warn">Urgente</span>':''}
        ${j.no_exp? '<span class="badge">Sem experiência</span>':''}
        ${j.remote? '<span class="badge ok">Remoto</span>':''}
        ${(j.tags||'').split(',').map(t=>t.trim()).filter(Boolean).map(t=>'<span class="tag">'+t+'</span>').join('')}
      </div>
      <pre style="white-space:pre-wrap; line-height:1.6">${j.description}</pre>
      <div style="display:flex; gap:8px; flex-wrap:wrap">
        ${j.apply_url? `<a class="btn" href="${j.apply_url}" target="_blank">Candidatar-se</a>`:''}
        ${j.apply_email? `<a class="btn light" href="mailto:${j.apply_email}?subject=Candidatura: ${encodeURIComponent(j.title)}">Enviar currículo</a>`:''}
      </div>
    </div>`;
  const overlay = el('div', { id:'overlay', style:'position:fixed; inset:0; background:rgba(0,0,0,.4); z-index:99' });
  overlay.innerHTML = html; document.body.appendChild(overlay); qs('#closeModal', overlay).onclick = () => overlay.remove();
}
let currentParams = { page:1, pageSize:20 };
async function refresh(changes={}){ currentParams = { ...currentParams, ...changes }; const payload = await loadJobs(currentParams); renderJobs(qs('#jobs'), payload); }
if(qs('#btnSearch')) qs('#btnSearch').onclick = () => refresh({ q: qs('#q').value, page:1 });
if(qs('#q')) qs('#q').addEventListener('keydown', e=>{ if(e.key==='Enter') refresh({ q: e.target.value, page:1 }) });
document.querySelectorAll('[data-filter]').forEach(b=>{ b.addEventListener('click', ()=>{ const f=b.dataset.filter; const params={ urgent:'', noexp:'', today:'' }; if(f==='urgent') params.urgent='1'; if(f==='noexp') params.noexp='1'; if(f==='today') params.today='1'; refresh({ ...params, page:1 }); }); });
document.querySelectorAll('[data-tag]').forEach(a=>{ a.addEventListener('click', (e)=>{ e.preventDefault(); refresh({ tag: a.dataset.tag, page:1 }); }); });
if(!!window.EventSource){ const ev = new EventSource('/api/stream'); ev.onmessage = (e)=>{ try{ const data = JSON.parse(e.data); if(data.type==='new-job'||data.type==='delete-job'){ refresh(); } }catch{} }; }
if(qs('#jobs')) refresh();
if(qs('#publish')){
  qs('#btnLogin').onclick = ensureAuth; qs('#btnLogout').onclick = ()=>{ setToken(''); alert('Você saiu.'); location.reload(); };
  if(token()){ qs('#btnLogin').style.display='none'; qs('#btnLogout').style.display='inline-block'; }
  qs('#publish').onclick = async ()=>{
    if(!(await ensureAuth())) return;
    const payload = {
      title: qs('#title').value, company: qs('#company').value, location: qs('#location').value,
      type: qs('#type').value, salary: qs('#salary').value, description: qs('#description').value,
      tags: qs('#tags').value, urgent: qs('#urgent').checked, no_exp: qs('#noexp').checked, remote: qs('#remote').checked,
      apply_url: qs('#apply_url').value, apply_email: qs('#apply_email').value
    };
    const res = await fetch(API + "/jobs", { method:'POST', headers:{ 'Content-Type':'application/json', ...authHeader() }, body: JSON.stringify(payload)});
    const data = await res.json();
    if(data.id){ qs('#msg').textContent='Vaga publicada com sucesso!'; ['title','company','location','type','salary','description','tags','apply_url','apply_email'].forEach(id=>qs('#'+id).value=''); ['urgent','noexp','remote'].forEach(id=>qs('#'+id).checked=false); }
    else{ qs('#msg').textContent='Erro: ' + (data.error || (data.errors && data.errors[0]?.msg) || 'Falha'); }
  };
}
