import { getLang, t } from './i18n.js';

const words={
  results:['Résultats','Resultaten','Results'], title:['Votre prochaine rencontre commence ici.','Uw volgende kennismaking begint hier.','Your next introduction starts here.'],
  intro:['Les clients potentiels et leurs mails, réunis au même endroit.','Potentiële klanten en hun e-mails op één plek.','Potential clients and their emails, in one place.'],
  map:['Retour à la carte','Terug naar de kaart','Back to the map'], leads:['clients potentiels','potentiële klanten','potential clients'], ready:['mails préparés','e-mails voorbereid','emails prepared'], approved:['validés','goedgekeurd','approved'],
  search:['Chercher un commerce…','Zoek een bedrijf…','Search businesses…'], all:['Tous','Alle','All'], todo:['À traiter','Te verwerken','To review'], done:['Validés','Goedgekeurd','Approved'],
  empty:['Aucun client potentiel avec une adresse de contact dans cette mission.','Geen potentiële klanten met een contactadres in deze missie.','No potential clients with a contact address in this mission.'],
  offer:['Personnalisez les premiers contacts','Maak het eerste contact persoonlijk','Personalise the first contact'], offerHint:['Indiquez votre offre et votre signature. Chaque mail s’appuie sur les informations relevées pour ce commerce.','Vul uw aanbod en handtekening in. Elke e-mail gebruikt de informatie van dat bedrijf.','Enter your offer and signature. Each email uses the information found for that business.'],
  sell:['Votre offre','Uw aanbod','Your offer'], signature:['Votre signature','Uw handtekening','Your signature'], website:['Votre site (facultatif)','Uw website (optioneel)','Your website (optional)'], forWhom:['Pour qui (facultatif)','Voor wie (optioneel)','For whom (optional)'],
  assistant:['Assistant de rédaction','Schrijfassistent','Writing assistant'], language:['Langue des mails','Taal van de e-mails','Email language'], auto:['Selon le site du commerce','Volgens de bedrijfswebsite','Match the business website'], instructions:['Consignes de rédaction (facultatif)','Schrijfinstructies (optioneel)','Writing instructions (optional)'],
  generate:['Préparer les mails manquants','Ontbrekende e-mails voorbereiden','Prepare missing emails'], generating:['Préparation des mails…','E-mails voorbereiden…','Preparing emails…'], required:['Renseignez votre offre et votre signature pour préparer les mails.','Vul uw aanbod en handtekening in om e-mails voor te bereiden.','Enter your offer and signature to prepare emails.'],
  noDraft:['Le mail de ce commerce reste à préparer.','De e-mail voor dit bedrijf moet nog worden voorbereid.','This business’s email has yet to be prepared.'], viewOffer:['Compléter mon offre et préparer les mails','Mijn aanbod invullen en e-mails voorbereiden','Enter my offer and prepare emails'],
  observation:['Pourquoi ce commerce ?','Waarom dit bedrijf?','Why this business?'], score:['Score expliqué','Verklaarde score','Explained score'], contact:['Adresse publique relevée','Gevonden openbaar adres','Public address found'], source:['Source du contact','Bron van het contact','Contact source'],
  subject:['Objet du mail','Onderwerp','Email subject'], message:['Votre message','Uw bericht','Your message'], approve:['Valider ce mail','Deze e-mail goedkeuren','Approve this email'], reject:['Refuser','Afwijzen','Reject'], copy:['Copier le mail','E-mail kopiëren','Copy email'], copied:['Mail copié','E-mail gekopieerd','Email copied'], copyFail:['La copie a échoué. Sélectionnez le texte pour le copier.','Kopiëren mislukt. Selecteer de tekst om deze te kopiëren.','Copy failed. Select the text to copy it.'],
  safe:['Les mails restent des brouillons. Aucun envoi automatique.','E-mails blijven concepten. Geen automatische verzending.','Emails remain drafts. Nothing is sent automatically.'], approvedState:['Mail validé','E-mail goedgekeurd','Email approved'], rejectedState:['Mail refusé','E-mail afgewezen','Email rejected'], draftState:['À relire','Na te lezen','Ready to review'], pendingState:['À préparer','Voor te bereiden','To prepare'], failedState:['Préparation à réessayer','Voorbereiding opnieuw proberen','Preparation needs retrying'],
  saved:['Décision enregistrée','Beslissing opgeslagen','Decision saved'], missingText:['L’objet et le message ne peuvent pas être vides.','Onderwerp en bericht mogen niet leeg zijn.','Subject and message cannot be empty.'], error:['Le logiciel ne répond pas. Réessayez.','De toepassing reageert niet. Probeer opnieuw.','The app is not responding. Try again.'], noMatch:['Aucun résultat avec ce filtre.','Geen resultaten met dit filter.','No results for this filter.'],
  closeOffer:['Masquer les réglages','Instellingen verbergen','Hide settings'], settings:['Offre et réglages','Aanbod en instellingen','Offer and settings'], prepared:['Préparation terminée','Voorbereiding voltooid','Preparation complete'], failed:['certains mails demandent une nouvelle tentative','sommige e-mails moeten opnieuw worden geprobeerd','some emails need another attempt'],
};
const tr=(key)=>words[key]?.[{fr:0,nl:1,en:2}[getLang()]]??key;
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const contactSource=place=>{try{const url=new URL(place.email_source||place.website,place.website);return ['http:','https:'].includes(url.protocol)?url.href:null;}catch{return null;}};
const retained=place=>(place.to_email||place.emails?.length)&&['analyse','retenu','a_ecrire','ecriture','en_attente','valide','refuse','erreur'].includes(place.status);

export function createResultsDialog({root=document.body,onClose=()=>{}}={}) {
  const dialog=document.createElement('dialog');dialog.className='results-dialog';dialog.setAttribute('aria-labelledby','results-title');
  dialog.innerHTML=`<div class="results-shell"><header class="results-header"><div><p class="results-kicker">PROSPER ET LES PROSPECTS <span id="results-city"></span></p><h1 id="results-title">${tr('title')}</h1><p>${tr('intro')}</p></div><button type="button" class="results-close" aria-label="${tr('map')}">${tr('map')} <span>×</span></button></header><div class="results-metrics" aria-live="polite"></div><div class="results-toolbar"><input id="results-search" type="search" placeholder="${tr('search')}" aria-label="${tr('search')}"><select id="results-filter" aria-label="${tr('results')}"><option value="all">${tr('all')}</option><option value="todo">${tr('todo')}</option><option value="done">${tr('done')}</option></select><button class="results-settings-button" type="button">${tr('settings')}</button></div><div class="results-progress" role="status" hidden></div><div class="results-body"><aside class="results-list" aria-label="${tr('leads')}"></aside><main class="results-detail"></main></div><footer class="results-footer">${tr('safe')}</footer></div>`;
  root.append(dialog);
  const $=selector=>dialog.querySelector(selector);
  let runId=null, snapshot=null, places=[], selected=null, filter='all', query='', timer=null, editing=false, offerOpen=false, busy=false;
  let offerDraft=null;
  const editorDrafts=new Map();
  const pendingDecisions=new Set();
  function offerFromConfig(config={}) {
    const moteur=config.redaction?.moteur==='codex'?'codex':'claude';
    return {offre:{...(config.offre??{})},consignes:config.consignes??'',redaction:{...(config.redaction??{}),moteur,langue:config.redaction?.langue??'auto',modele:config.redaction?.moteur===moteur?config.redaction?.modele??'':''},dirty:false};
  }
  function captureEdits() {
    const p=places.find(p=>p.id===selected),subject=$('#result-subject'),message=$('#result-message');
    if(p&&subject&&message){
      if(subject.value!==(p.objet??'')||message.value!==(p.mail??''))editorDrafts.set(selected,{objet:subject.value,mail:message.value});
      else editorDrafts.delete(selected);
    }
    if($('#result-offer')){
      offerDraft??=offerFromConfig(snapshot?.config);
      const moteur=$('#result-engine').value;
      if(moteur!==offerDraft.redaction.moteur)offerDraft.redaction.modele='';
      Object.assign(offerDraft.offre,{ce_que_je_vends:$('#result-offer').value,signature:$('#result-signature').value,site:$('#result-website').value});
      Object.assign(offerDraft.redaction,{moteur,langue:$('#result-language').value});
      offerDraft.consignes=$('#result-instructions').value;
    }
    editing=editorDrafts.has(selected)||Boolean(offerOpen&&offerDraft?.dirty);
  }
  const statusLabel=p=>tr(p.status==='valide'?'approvedState':p.status==='refuse'?'rejectedState':p.mail?'draftState':p.status==='erreur'?'failedState':'pendingState');
  async function request(path,options){const response=await fetch(path,options);const body=await response.json();if(!response.ok)throw new Error(t(body.error??tr('error')));return body;}
  function notify(message,error=false){const el=$('.results-progress');el.hidden=false;el.classList.toggle('error',error);el.textContent=message;}
  function metrics(){const ready=places.filter(p=>p.mail).length,approved=places.filter(p=>p.status==='valide').length;$('.results-metrics').innerHTML=`<span><b>${places.length}</b> ${tr('leads')}</span><span><b>${ready}</b> ${tr('ready')}</span><span><b>${approved}</b> ${tr('approved')}</span>`;}
  function renderList(){
    const shown=places.filter(p=>(filter!=='done'||p.status==='valide')&&(filter!=='todo'||!['valide','refuse'].includes(p.status))&&`${p.name} ${p.address??''}`.toLowerCase().includes(query));
    $('.results-list').innerHTML=shown.map(p=>`<button type="button" class="result-prospect ${p.id===selected?'active':''}" data-result-id="${esc(p.id)}"><span class="result-avatar">${esc(p.name?.slice(0,1)??'?')}</span><span><b>${esc(p.name)}</b><small>${esc(p.address??'')}</small><em data-state="${p.status}">${statusLabel(p)}</em></span><strong>${p.score}<small>/100</small></strong></button>`).join('')||`<p class="results-empty">${tr(places.length?'noMatch':'empty')}</p>`;
  }
  function offerForm(){const config=offerDraft??offerFromConfig(snapshot?.config),offer=config.offre??{},engine=config.redaction?.moteur==='codex'?'codex':'claude',language=config.redaction?.langue??'auto';
    return `<section class="results-offer"><p class="results-eyebrow">${tr('offer')}</p><p>${tr('offerHint')}</p><label for="result-offer">${tr('sell')}</label><textarea id="result-offer" rows="3" maxlength="600">${esc(offer.ce_que_je_vends??'')}</textarea><div class="results-form-grid"><div><label for="result-signature">${tr('signature')}</label><input id="result-signature" maxlength="600" value="${esc(offer.signature??'')}"></div><div><label for="result-website">${tr('website')}</label><input id="result-website" maxlength="600" value="${esc(offer.site??'')}"></div><div><label for="result-engine">${tr('assistant')}</label><select id="result-engine"><option value="claude" ${engine==='claude'?'selected':''}>Claude Code</option><option value="codex" ${engine==='codex'?'selected':''}>Codex</option></select></div><div><label for="result-language">${tr('language')}</label><select id="result-language">${[['auto',tr('auto')],['fr','Français'],['nl','Nederlands'],['en','English']].map(([v,label])=>`<option value="${v}" ${v===language?'selected':''}>${label}</option>`).join('')}</select></div></div><label for="result-instructions">${tr('instructions')}</label><textarea id="result-instructions" rows="2" maxlength="800">${esc(config.consignes??'')}</textarea><div class="results-offer-actions"><button type="button" class="results-primary" data-generate>${tr('generate')}</button><button type="button" class="results-secondary" data-hide-offer>${tr('closeOffer')}</button></div></section>`;
  }
  function renderEditor(){
    const p=places.find(p=>p.id===selected);
    if(!p){$('.results-detail').innerHTML=`<div class="results-empty"><h2>${tr('results')}</h2><p>${tr('empty')}</p></div>`;return;}
    editing=editorDrafts.has(selected)||Boolean(offerOpen&&offerDraft?.dirty);
    const draft=editorDrafts.get(selected)??p;
    const reasons=p.signals?.raisons??[];
    $('.results-detail').innerHTML=`${offerOpen?offerForm():''}<article class="results-editor"><div class="results-editor-head"><div><p class="results-eyebrow">${statusLabel(p)}</p><h2>${esc(p.name)}</h2><p>${esc(p.address??'')}</p></div><span class="results-score">${p.score}<small>/100</small></span></div><div class="results-contact"><span>${tr('contact')}</span><b>${esc(p.to_email??p.emails?.[0]??'')}</b>${contactSource(p)?`<a href="${esc(contactSource(p))}" target="_blank" rel="noopener noreferrer">${tr('source')} ↗</a>`:''}</div><details class="results-evidence"><summary>${tr('score')}</summary><ul>${reasons.map(r=>`<li><b>${r.pts>0?'+':''}${r.pts}</b> ${esc(t(r.texte))}</li>`).join('')}</ul></details>${p.mail?`${p.constat?`<div class="results-observation"><b>${tr('observation')}</b><p>${esc(p.constat)}</p></div>`:''}<label for="result-subject">${tr('subject')}</label><input id="result-subject" value="${esc(draft.objet??'')}"><label for="result-message">${tr('message')}</label><textarea id="result-message" rows="12">${esc(draft.mail)}</textarea><div class="results-editor-actions"><button class="results-primary" type="button" data-decision="valide" ${pendingDecisions.has(selected)?'disabled':''}>✓ ${tr('approve')}</button><button class="results-secondary" type="button" data-decision="refuse" ${pendingDecisions.has(selected)?'disabled':''}>${tr('reject')}</button><button class="results-secondary" type="button" data-copy>${tr('copy')}</button></div>`:`<div class="results-no-draft"><span>✎</span><h3>${tr('noDraft')}</h3><button class="results-primary" type="button" data-open-offer>${tr('viewOffer')}</button></div>`}</article>`;
    for(const el of $('.results-detail').querySelectorAll('#result-subject,#result-message,.results-offer input,.results-offer textarea,.results-offer select'))el.addEventListener('input',()=>{if(el.closest('.results-offer')){offerDraft??=offerFromConfig(snapshot?.config);offerDraft.dirty=true;}captureEdits();});
    $('.results-detail').querySelector('[data-open-offer]')?.addEventListener('click',()=>{captureEdits();offerOpen=true;renderEditor();$('.results-detail').scrollTop=0;$('#result-offer')?.focus();});
    $('.results-detail').querySelector('[data-hide-offer]')?.addEventListener('click',()=>{captureEdits();offerOpen=false;renderEditor();});
    $('.results-detail').querySelector('[data-generate]')?.addEventListener('click',generate);
    $('.results-detail').querySelector('[data-copy]')?.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(`${$('#result-subject').value}\n\n${$('#result-message').value}`);notify(tr('copied'));}catch{notify(tr('copyFail'),true);}});
    for(const button of $('.results-detail').querySelectorAll('[data-decision]'))button.addEventListener('click',()=>decide(button.dataset.decision));
  }
  async function refresh(){if(!runId||!dialog.open)return;try{
    snapshot=await request(`/api/state?run=${encodeURIComponent(runId)}`);
    if(!offerDraft||!offerDraft.dirty)offerDraft=offerFromConfig(snapshot.config);
    const old=places.find(p=>p.id===selected),oldSignature=old?`${old.status}:${old.objet??''}:${old.mail??''}`:'';
    places=(snapshot.places??[]).filter(retained);
    if(!places.some(p=>p.id===selected))selected=places[0]?.id??null;
    const current=places.find(p=>p.id===selected),newSignature=current?`${current.status}:${current.objet??''}:${current.mail??''}`:'';
    metrics();renderList();
    if(!editing&&(oldSignature!==newSignature||!$('.results-detail').children.length))renderEditor();
    const job=snapshot.draftJob;
    busy=job?.status==='running';
    if(busy)notify(`${tr('generating')} ${job.completed??0}/${job.total??places.length}`);
    else if(job?.status==='completed'||job?.status==='complete'||job?.status==='finished')notify(`${tr('prepared')}${job.failed?` · ${tr('failed')}`:''}`);
  }catch(e){notify(e.message??tr('error'),true);}}
  async function generate(){if(busy)return;captureEdits();const offer=offerDraft?.offre?.ce_que_je_vends?.trim(),signature=offerDraft?.offre?.signature?.trim();if(!offer||!signature){notify(tr('required'),true);return;}
    const body={offre:{...offerDraft.offre,ce_que_je_vends:offer,signature,site:(offerDraft.offre.site??'').trim()},consignes:offerDraft.consignes,redaction:{...offerDraft.redaction}};
    const submitted=JSON.stringify({offre:offerDraft.offre,consignes:offerDraft.consignes,redaction:offerDraft.redaction});
    try{busy=true;for(const b of dialog.querySelectorAll('[data-generate]'))b.disabled=true;await request(`/api/runs/${encodeURIComponent(runId)}/drafts`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});captureEdits();if(JSON.stringify({offre:offerDraft.offre,consignes:offerDraft.consignes,redaction:offerDraft.redaction})===submitted)offerDraft.dirty=false;offerOpen=false;editing=editorDrafts.has(selected);notify(tr('generating'));renderEditor();await refresh();}catch(e){busy=false;notify(e.message??tr('error'),true);for(const b of dialog.querySelectorAll('[data-generate]'))b.disabled=false;}}
  async function decide(decision){const placeId=selected;if(pendingDecisions.has(placeId))return;captureEdits();const subject=$('#result-subject')?.value.trim(),message=$('#result-message')?.value.trim();if(!subject||!message){notify(tr('missingText'),true);return;}pendingDecisions.add(placeId);for(const b of dialog.querySelectorAll('[data-decision]'))b.disabled=true;try{await request(`/api/runs/${encodeURIComponent(runId)}/places/${encodeURIComponent(placeId)}/decision`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({decision,objet:subject,mail:message})});const draft=editorDrafts.get(placeId);if(draft?.objet.trim()===subject&&draft?.mail.trim()===message)editorDrafts.delete(placeId);editing=editorDrafts.has(selected)||Boolean(offerOpen&&offerDraft?.dirty);notify(tr('saved'));await refresh();}catch(e){notify(e.message??tr('error'),true);}finally{pendingDecisions.delete(placeId);for(const b of dialog.querySelectorAll('[data-decision]'))b.disabled=pendingDecisions.has(selected);}}
  async function open(id){if(!id)return;const changed=runId!==id;runId=id;if(changed){snapshot=null;places=[];selected=null;editing=false;offerOpen=false;offerDraft=null;editorDrafts.clear();$('.results-detail').replaceChildren();}if(!busy){const progress=$('.results-progress');progress.hidden=true;progress.classList.remove('error');progress.textContent='';}if(!dialog.open)dialog.showModal();document.body.classList.add('results-open');await refresh();$('#results-city').textContent=snapshot?.run?.ville?`· ${snapshot.run.ville}`:'';if(places.length&&!places.some(p=>p.mail)&&!snapshot?.config?.offre?.ce_que_je_vends&&!editing){offerOpen=true;renderEditor();}clearInterval(timer);timer=setInterval(refresh,1300);}
  function close(){captureEdits();if(runId)try{sessionStorage.setItem(`prosper:results:closed:${runId}`,'1');}catch{};clearInterval(timer);dialog.close();document.body.classList.remove('results-open');onClose();}
  $('.results-close').addEventListener('click',close);dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
  $('.results-settings-button').addEventListener('click',()=>{captureEdits();offerOpen=!offerOpen;renderEditor();$('.results-detail').scrollTop=0;});
  $('.results-list').addEventListener('click',e=>{const button=e.target.closest('[data-result-id]');if(button){captureEdits();selected=button.dataset.resultId;renderList();renderEditor();$('.results-detail').scrollTop=0;}});
  $('#results-search').addEventListener('input',e=>{query=e.target.value.toLowerCase();renderList();});$('#results-filter').addEventListener('change',e=>{filter=e.target.value;renderList();});
  return {open,close,get isOpen(){return dialog.open;},async autoOpen(id){if(!id)return false;try{if(sessionStorage.getItem(`prosper:results:closed:${id}`))return false;}catch{};const state=await request(`/api/state?run=${encodeURIComponent(id)}`);if((state.places??[]).some(retained)){await open(id);return true;}return false;},destroy(){clearInterval(timer);dialog.remove();}};
}
