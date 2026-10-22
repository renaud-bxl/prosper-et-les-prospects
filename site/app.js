(() => {
  'use strict';
  const supported = new Set(['fr', 'nl', 'en']);
  const storageKey = 'prosper.site.lang';
  const nodes = [...document.querySelectorAll('[data-t]')];
  const french = new Map(nodes.map(node => [node, node.innerHTML]));
  const original = {
    title: document.title,
    description: document.querySelector('meta[name="description"]')?.content ?? '',
    screenshot: document.querySelector('.real-application > img')?.alt ?? '',
    resultsScreenshot: document.querySelector('.results-application > img')?.alt ?? '',
    canvas: document.querySelector('#town-people')?.getAttribute('aria-label') ?? '',
  };
  // Authored translations only. Dynamic illustrations are never replaced.
  const translations = {
    nl: {
      skip: 'Naar de installatie',
      navHow: 'De missie', navQuestions: 'Vragen', install: 'Prosper installeren ↗',
      release: "Versie 1.0.3 · Het team staat klaar",
      hero: 'Een stad.<br>Een team.<br><span>Uw contacten.</span>',
      lead: "Vertrouw uw zoektocht toe aan Prosper. Zijn team verkent bedrijven in de Benelux, bekijkt hun websites en bereidt een eerste contact voor op basis van de gevonden openbare informatie. U ziet hen vooruitgaan. U beslist over de volgende stap.",
      start: 'Mijn team installeren ↗', github: 'Bekijk het project op GitHub ↗',
      micro: 'Op uw computer · Met uw abonnement · Zonder API-sleutel',
      hq: 'HET WERKGEBIED VAN PROSPER',
      speech: 'Een stad in gedachten?<br>We gaan samen op pad.',
      illustration: 'Geanimeerde illustratie',
      teamLine: 'Verschillende talenten. Uw volgende contacten.',
      heroCaption: 'Een geïllustreerde indruk. In de applicatie volgt het team de echte straten.',
      chooseAssistant: 'Uw abonnement, uw keuze.', or: 'of',
      processLabel: 'EEN TEAM, GEEN LIJST OM TE SORTEREN',
      processTitle: 'Van ‘wie kan ik benaderen?’<br>naar ‘dit is mijn eerste e-mail’.',
      processIntro: "Een stad, een sector, uw aanbod en een doel voor het aantal contacten. Prosper organiseert de zoektocht; u houdt de regie over elk contact.",
      step1Title: 'Kies uw werkgebied.',
      step1: 'Brussel, Amsterdam, Luxemburg… Léo vindt bedrijven in uw sector en zoekgebied met OpenStreetMap.',
      belgium: 'België', netherlands: 'Nederland',
      step2Title: 'Zie het team aan het werk.',
      step2: "Hugo, Zoé en Iris bezoeken openbare websites. Beschikbare contactgegevens, openingstijden, diensten en nuttige links komen in een bedrijfsfiche, met bron-URL’s en een verklaarde score.",
      evidenceTag: 'Controleerbare bronnen', contactsTag: 'Openbare contactgegevens',
      step3Title: 'Bereid uw volgende kennismaking voor.',
      step3: "Malo en Nina bereiden e-mails voor op basis van uw aanbod en elk bedrijf. De resultaten tonen uw e-mails links en de kaart en bedrijvenlijst rechts.",
      draftsTag: 'Persoonlijke e-mails', validationTag: 'Uw goedkeuring',
      controlNote: '<strong>En het versturen? U beslist.</strong> Lees elk concept na, pas het aan, keur het goed of wijs het af. Prosper verstuurt geen e-mails automatisch.',
      learnMore: 'Zo werkt het ↗',
      teamLabel: 'MAAK KENNIS MET HET TEAM', teamTitle: 'Zeven persoonlijkheden.<br>Eén gezamenlijke richting.',
      teamIntro: 'Een teamleider, een verkenner, drie onderzoekers en twee schrijvers. Iedereen heeft een eigen rol en plek op de kaart.',
      realLabel: 'HET HOOFDKWARTIER, VOOR UW OGEN',
      viewTitle: 'Uw stad wordt<br>het terrein van de missie.',
      realIntro: 'Volg een teamlid, verken de kaart, open een bedrijfsfiche of bekijk alle resultaten. In de lichte modus of de nachtmodus.',
      caption: 'Echte schermafbeelding van de applicatie · Brussel · lichte modus',
      installLabel: 'HAAL HET TEAM BINNEN', installTitle: 'Uw nieuwe werkgebied.<br>Op uw computer.',
      installBody: 'Node.js 22.13 of nieuwer en Git zijn vereist. Meld u aan bij Claude Code of Codex om e-mails voor te bereiden. Alleen analyseren werkt ook zonder assistent.',
      installCardTitle: 'Welkom in het team.',
      installCardIntro: "Kopieer deze opdracht naar uw terminal. Kies daarna de schijf of map waarin u Prosper wilt installeren.",
      terminal: 'LOKALE INSTALLATIE', copy: 'Opdrachten kopiëren',
      sourceInstall: 'Lees de instructies op GitHub ↗',
      localNote: 'Uw missies, instellingen en concepten blijven op uw computer. De schrijfassistenten gebruiken de dienst waarbij u bent aangemeld.',
      nextLabel: 'EN DAARNA?', nextTitle: 'Uw eerste missie,<br>in een paar stappen.',
      next1Title: 'Kies een stad en een sector.',
      next1: "De Benelux is uw werkgebied. Begin met een doel van vijf contacten om het team te leren kennen.",
      next2Title: 'Vertel over uw aanbod.',
      next2: 'Uw aanbod, een handtekening en de taal van de e-mails: het team bereidt voor elk bedrijf een passend contact voor.',
      next3Title: 'Bekijk uw resultaten.',
      next3: "Uw e-mails links, de kaart en alle bedrijven rechts. Open een bedrijfsfiche, controleer de bronnen, lees na en beslis.",
      updateBody: "Git-installaties krijgen een melding over nieuwe versies. Start de update na afloop van de missie, met behoud van uw gegevens en instellingen.",
      faqLabel: 'VOOR U VERTREKT', faqHeading: 'Een paar vragen,<br>heldere antwoorden.',
      faq1q: 'Worden e-mails automatisch verstuurd?',
      faq1a: 'Nee. Prosper maakt concepten. U kunt ze aanpassen, goedkeuren, afwijzen of kopiëren. U verstuurt ze vanuit uw eigen e-mailprogramma.',
      faq2q: 'Welke assistenten kan ik gebruiken?',
      faq2a: 'Claude Code of Codex, aangemeld op uw computer, schrijven de e-mails. Cursor kan het project ontwikkelen en starten; het is geen ingebouwde schrijfassistent.',
      faq3q: 'In welke talen werkt Prosper?',
      faq3a: "De interface is beschikbaar in het Frans, Nederlands en Engels. De taal van de e-mails stelt u afzonderlijk in. Uw handmatige keuze voor FR/NL/EN heeft voorrang. In de automatische modus volgt Prosper de taal die de HTML-pagina van het bedrijf aangeeft, als die Frans, Nederlands of Engels is; anders wordt de e-mail in het Frans voorbereid. Dit geldt voor nieuwe concepten.",
      faq4q: 'Hoe werkt een update?',
      faq4a: "Een Git-installatie op de main-branch controleert bij het opstarten en daarna regelmatig op nieuwe versies. Een lopende missie wordt niet onderbroken: wacht tot ze klaar is voordat u de update start. Prosper bereidt daarna de nieuwe versie voor, start opnieuw op en bewaart uw instellingen en lokale database.",
      faq5q: 'Waar komt de informatie vandaan?',
      faq5a: "De bedrijven komen uit OpenStreetMap, met Google Places als optie. De onderzoekers bekijken hun openbare websites. Een bedrijfsfiche verzamelt beschikbare informatie: website, contactgegevens, adres, openingstijden, sociale media of diensten, met bron-URL’s. Een website kan onvolledig of onbereikbaar zijn: ontbrekende informatie wordt niet verzonnen.",
      faq6q: 'Wat is de link met Oscar et les agents?',
      faq6a: 'Twee applicaties uit dezelfde familie. Oscar organiseert uw projecten in zijn kantoor; Prosper verkent de Benelux om uw volgende contacten voor te bereiden. Ze delen een geïllustreerde wereld en dezelfde kleuren.',
      meetOscar: 'Maak kennis met Oscar ↗', closingLabel: 'HET TEAM STAAT KLAAR',
      closingTitle: 'Uw volgende kennismaking<br>begint hier.', closingCta: 'Prosper installeren ↗',
      footerFamily: 'Dezelfde familie als Oscar.<br>Een nieuw terrein om te verkennen.',
      credits: 'Code aangepast van VibesMoney’s QG des agents, onder de MIT-licentie. Vormgeving geïnspireerd op Oscar et les agents. Gegevens: OpenStreetMap · GeoNames · Natural Earth. Geen advertentietracking.',
      resultsLabel: "UW RESULTATEN IN ÉÉN OOGOPSLAG",
      resultsTitle: "Uw e-mails aan de ene kant.<br>De bedrijven aan de andere.",
      resultsIntro: "Lees en bewerk uw e-mails links. Selecteer rechts een bedrijf in de lijst of op de kaart om de locatie en gevonden openbare informatie met de bijbehorende bronnen te bekijken.",
      resultsCaption: "Resultatenoverzicht · fictieve demonstratiegegevens",
      faq7q: "Hoe werkt een doel van 60 contacten?",
      faq7a: "Een doel van 60 bruikbare contacten en 60 e-mails kan meer dan 60 bezoeken vereisen. Prosper kan maximaal 250 bedrijven onderzoeken en het zoekgebied uitbreiden tot een straal van 20 km in de Benelux. Beschikbare bronnen, daadwerkelijk gepubliceerde contactgegevens en toegang tot de assistent kunnen het resultaat beperken. Als het doel niet is bereikt, vermeldt het overzicht wat ontbreekt en waarom de zoektocht is gestopt.",
    },
    en: {
      skip: 'Skip to installation',
      navHow: 'The mission', navQuestions: 'Questions', install: 'Install Prosper ↗',
      release: "Version 1.0.3 · Your team is ready",
      hero: 'A city.<br>A team.<br><span>Your prospects.</span>',
      lead: "Let Prosper lead your search. His team explores businesses across the Benelux, reads their websites and prepares first contacts using the public information found. You watch them make progress. You decide what comes next.",
      start: 'Install my team ↗', github: 'View the project on GitHub ↗',
      micro: 'On your computer · With your subscription · No API key',
      hq: 'PROSPER’S TERRITORY', speech: 'Have a city in mind?<br>Let’s explore together.',
      illustration: 'Animated illustration',
      teamLine: 'Different talents. Your next contacts.',
      heroCaption: 'An illustrated preview. In the application, the team follows real streets.',
      chooseAssistant: 'Your subscription, your choice.', or: 'or',
      processLabel: 'A TEAM, NOT A LIST TO SORT',
      processTitle: 'From “who should I contact?”<br>to “here is my first email”.',
      processIntro: "A city, a sector, your offer and a contact target. Prosper organises the search; you stay in control of every introduction.",
      step1Title: 'Choose your territory.',
      step1: 'Brussels, Amsterdam, Luxembourg… Léo uses OpenStreetMap to find businesses in your sector and chosen area.',
      belgium: 'Belgium', netherlands: 'The Netherlands',
      step2Title: 'Watch the team make progress.',
      step2: "Hugo, Zoé and Iris visit public websites. Available contacts, opening hours, services and useful links are gathered in a business profile, with source URLs and an explained score.",
      evidenceTag: 'Verifiable sources', contactsTag: 'Public contacts',
      step3Title: 'Prepare your next introduction.',
      step3: "Malo and Nina prepare emails based on your offer and each business. The results show your emails on the left, with the map and business list on the right.",
      draftsTag: 'Personalised emails', validationTag: 'Your approval',
      controlNote: '<strong>And sending? You decide.</strong> Review, edit, approve or reject each draft. Prosper does not send any emails automatically.',
      learnMore: 'See how it works ↗',
      teamLabel: 'MEET YOUR TEAM', teamTitle: 'Seven personalities.<br>One shared direction.',
      teamIntro: 'A team leader, a scout, three researchers and two writers. Everyone has a role and a place on the map.',
      realLabel: 'HEADQUARTERS, IN PLAIN SIGHT',
      viewTitle: 'Your city becomes<br>the mission’s terrain.',
      realIntro: 'Follow a character, explore the map, open a business profile or find all your results. In light or night mode.',
      caption: 'Actual application screenshot · Brussels · light mode',
      installLabel: 'WELCOME YOUR TEAM', installTitle: 'Your new territory.<br>On your computer.',
      installBody: 'Node.js 22.13 or later and Git are required. Sign in to Claude Code or Codex to prepare emails. Analysis alone works without an assistant.',
      installCardTitle: 'Welcome to the team.',
      installCardIntro: "Copy this command into your terminal. Then choose the drive or folder where you want to install Prosper.",
      terminal: 'LOCAL INSTALLATION', copy: 'Copy commands',
      sourceInstall: 'Read the instructions on GitHub ↗',
      localNote: 'Your missions, settings and drafts stay on your computer. Writing assistants use the service you are signed in to.',
      nextLabel: 'WHAT COMES NEXT?', nextTitle: 'Your first mission,<br>in a few steps.',
      next1Title: 'Choose a city and a sector.',
      next1: "The Benelux is your territory. Start with a target of five contacts to get to know the team.",
      next2Title: 'Introduce your offer.',
      next2: 'Your offer, a signature and the email language: the team prepares a suitable first contact for each business.',
      next3Title: 'Find your results.',
      next3: "Your emails on the left, the map and all businesses on the right. Open a business profile, check its sources, review and decide.",
      updateBody: "Git installations are notified of new versions. Start the update after the mission finishes, preserving your data and settings.",
      faqLabel: 'BEFORE YOU SET OUT', faqHeading: 'A few questions,<br>clear answers.',
      faq1q: 'Are emails sent automatically?',
      faq1a: 'No. Prosper prepares drafts. You can edit, approve, reject or copy them. You send them from your own email account.',
      faq2q: 'Which assistants can I use?',
      faq2a: 'Claude Code or Codex, signed in on your computer, write the emails. Cursor can develop and launch the project; it is not an integrated writing engine.',
      faq3q: 'Which languages does Prosper support?',
      faq3a: "The interface is available in French, Dutch and English. Email language is set separately. Your manual FR/NL/EN choice takes priority. In automatic mode, Prosper follows the language declared in the business’s HTML page if it is French, Dutch or English; otherwise, the email is prepared in French. This applies to new drafts.",
      faq4q: 'How does an update work?',
      faq4a: "A Git installation on the main branch checks for new versions at startup and periodically afterwards. An active mission is not interrupted: wait for it to finish before starting the update. Prosper then prepares the new version, restarts and preserves your settings and local database.",
      faq5q: 'Where does the information come from?',
      faq5a: "Businesses come from OpenStreetMap, with Google Places as an option. The researchers examine their public websites. A business profile gathers available information: website, contacts, address, opening hours, social accounts or services, with source URLs. A website may be incomplete or unavailable: missing information is never invented.",
      faq6q: 'How is it related to Oscar et les agents?',
      faq6a: 'Two applications from the same family. Oscar organises your projects in his office; Prosper explores the Benelux to prepare your next contacts. They share an illustrated world and the same colours.',
      meetOscar: 'Meet Oscar ↗', closingLabel: 'THE TEAM IS READY',
      closingTitle: 'Your next introduction<br>starts here.', closingCta: 'Install Prosper ↗',
      footerFamily: 'The same family as Oscar.<br>A new territory to explore.',
      credits: 'Code adapted from VibesMoney’s QG des agents, under the MIT licence. Visual world inspired by Oscar et les agents. Data: OpenStreetMap · GeoNames · Natural Earth. No advertising tracking.',
      resultsLabel: "YOUR RESULTS AT A GLANCE",
      resultsTitle: "Your emails on one side.<br>The businesses on the other.",
      resultsIntro: "Review and edit your emails on the left. On the right, select a business in the list or on the map to see its location and the public information found, with its sources.",
      resultsCaption: "Results view · fictional demonstration data",
      faq7q: "How does a target of 60 contacts work?",
      faq7a: "A target of 60 usable contacts and 60 emails may require more than 60 visits. Prosper can examine up to 250 businesses and expand the search to a maximum radius of 20 km in the Benelux. Available sources, genuinely published contact details and access to the assistant can limit the result. If the target is not reached, the summary explains what is missing and why the search stopped.",
    },
  };
  const metadata = {
    fr: {...original, language:'Langue', navigation:'Navigation', theme:'Changer l’apparence', pause:'Mettre l’animation en pause', resume:'Reprendre l’animation', copying:'Copie en cours…', copied:'La commande a été copiée.', copyFailed:'La copie a échoué. Sélectionnez et copiez les commandes ci-dessus.'},
    nl: {title:'Prosper et les prospects — Een stad. Een team. Uw volgende klanten.', description:'Een geanimeerd prospectieteam voor de Benelux. Echte bedrijven, persoonlijke e-mails en uw goedkeuring.', screenshot:'Echte schermafbeelding van het hoofdkwartier en de personages in Prosper', resultsScreenshot:'Resultaten van Prosper met e-mails links, de kaart en bedrijven rechts; fictieve demonstratiegegevens', canvas:'Het team van Prosper in een geïllustreerde stad in de Benelux', language:'Taal', navigation:'Navigatie', theme:'Weergave wijzigen', pause:'Animatie pauzeren', resume:'Animatie hervatten', copying:'Bezig met kopiëren…', copied:'De opdracht is gekopieerd.', copyFailed:'Kopiëren is mislukt. Selecteer en kopieer de opdrachten hierboven.'},
    en: {title:'Prosper et les prospects — A city. A team. Your next clients.', description:'An animated prospecting team for the Benelux. Real businesses, personalised emails and your approval.', screenshot:'Actual screenshot of the headquarters and characters in Prosper', resultsScreenshot:'Prosper results with emails on the left and the map and businesses on the right; fictional demonstration data', canvas:'Prosper’s team in an illustrated Benelux town', language:'Language', navigation:'Navigation', theme:'Change appearance', pause:'Pause animation', resume:'Resume animation', copying:'Copying…', copied:'The command has been copied.', copyFailed:'Copying failed. Select and copy the commands above.'},
  };
  const languageSelect=document.querySelector('#language');
  const copyButton=document.querySelector('#copy');
  const copyStatus=document.querySelector('#copy-status');
  const command=document.querySelector('#command');
  let currentLanguage='fr';
  let copyInProgress=false;
  let copyResult='';
  function applyLanguage(value) {
    currentLanguage=supported.has(value)?value:'fr';
    const words=metadata[currentLanguage];
    for(const node of nodes) {
      if(node.querySelector('canvas'))continue;
      node.innerHTML=currentLanguage==='fr'?french.get(node):translations[currentLanguage][node.dataset.t]??french.get(node);
    }
    document.documentElement.lang=currentLanguage;
    document.title=words.title;
    const description=document.querySelector('meta[name="description"]');
    if(description)description.content=words.description;
    const screenshot=document.querySelector('.real-application > img');
    if(screenshot)screenshot.alt=words.screenshot;
    const resultsScreenshot=document.querySelector('.results-application > img');
    if(resultsScreenshot)resultsScreenshot.alt=words.resultsScreenshot;
    document.querySelector('#town-people')?.setAttribute('aria-label',words.canvas);
    document.querySelector('.site-header nav')?.setAttribute('aria-label',words.navigation);
    document.querySelector('#site-theme')?.setAttribute('aria-label',words.theme);
    const sceneToggle=document.querySelector('#scene-toggle');
    if(sceneToggle)sceneToggle.setAttribute('aria-label',sceneToggle.getAttribute('aria-pressed')==='true'?words.resume:words.pause);
    if(languageSelect){languageSelect.value=currentLanguage;languageSelect.setAttribute('aria-label',words.language);}
    if(copyStatus)copyStatus.textContent=copyInProgress?words.copying:copyResult?words[copyResult]:'';
    try{localStorage.setItem(storageKey,currentLanguage);}catch{}
    document.dispatchEvent(new CustomEvent('prosper-language',{detail:{lang:currentLanguage}}));
  }
  languageSelect?.addEventListener('change',()=>applyLanguage(languageSelect.value));
  if(copyStatus){copyStatus.setAttribute('aria-live','polite');copyStatus.setAttribute('aria-atomic','true');}
  copyButton?.addEventListener('click',async()=>{
    if(!command||copyInProgress)return;
    copyInProgress=true;copyResult='';copyButton.disabled=true;copyButton.setAttribute('aria-busy','true');
    if(copyStatus)copyStatus.textContent=metadata[currentLanguage].copying;
    try{
      if(!navigator.clipboard?.writeText)throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(command.textContent);
      copyResult='copied';
    }catch{copyResult='copyFailed';}
    finally{
      copyInProgress=false;copyButton.disabled=false;copyButton.removeAttribute('aria-busy');
      if(copyStatus)copyStatus.textContent=metadata[currentLanguage][copyResult];
    }
  });
  let savedLanguage='fr';
  try{savedLanguage=localStorage.getItem(storageKey)??'fr';}catch{}
  applyLanguage(savedLanguage);
})();
