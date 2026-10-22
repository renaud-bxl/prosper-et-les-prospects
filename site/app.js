(() => {
  'use strict';

  const supported = new Set(['fr', 'nl', 'en']);
  const storageKey = 'prosper.site.lang';
  const nodes = [...document.querySelectorAll('[data-t]')];
  // Preserve each original French fragment, including its own emphasis and line breaks.
  const french = new Map(nodes.map((node) => [node, node.innerHTML]));
  const original = {
    title: document.title,
    description: document.querySelector('meta[name="description"]')?.content ?? '',
    screenshot: document.querySelector('.app-window > img')?.alt ?? '',
    map: document.querySelector('img.benelux')?.alt ?? '',
    robot: document.querySelector('img.hero-robot')?.alt ?? '',
  };

  // Only these locally authored strings and the saved French HTML enter innerHTML.
  const translations = {
    nl: {
      navHow: 'De missie',
      navMap: 'Het werkgebied',
      install: 'Prosper installeren ↗',
      kicker: 'ÉÉN TEAM. DRIE LANDEN. UW BESLISSING.',
      hero: 'Het terrein is groot.<br><em>Ga samen op pad.</em>',
      lead: 'Prosper en zijn verkenners vinden bedrijven in de Benelux, bekijken hun websites en bereiden uw eerste contact voor. U ziet het team aan het werk. U houdt de regie.',
      start: 'Ontmoet mijn team <b>↗</b>',
      discover: 'Ontdek hoe het werkt ↓',
      micro: 'Open source · Op uw computer · Geen automatische verzending',
      hq: 'HET HOOFDKWARTIER · BENELUX',
      speech: 'Het team is klaar.<br>Waar beginnen we?',
      explore: 'UW VOLGENDE CONTACT IS ERGENS HIER.',
      belgium: 'België',
      netherlands: 'Nederland',
      strip: 'Echte steden.<br>Controleerbare informatie.',
      processLabel: '01 — DE MISSIE',
      processTitle: 'De agents gaan op pad.<br>U neemt de beslissingen.',
      processIntro: 'Een stad, een sector en uw aanbod. Elke rol heeft een duidelijke taak die u op het scherm kunt volgen.',
      step1Title: 'Verkennen',
      step1: 'De verkenner zoekt met OpenStreetMap naar bedrijven in uw sector en werkgebied.',
      step2Title: 'Begrijpen',
      step2: 'De onderzoekers bekijken openbare websites, verzamelen contactgegevens en leggen elk onderdeel van de score uit.',
      step3Title: 'Voorbereiden',
      step3: 'De schrijvers stellen een eerste e-mail voor op basis van uw aanbod en een waarneming over het bedrijf.',
      step4Title: 'Nu bent u aan zet',
      step4: 'Lees na, pas aan, keur goed of wijs af. De software verstuurt geen e-mails.',
      viewLabel: 'HET HOOFDKWARTIER, VOOR UW OGEN',
      viewTitle: 'Uw stad wordt<br>het terrein van de missie.',
      caption: 'Schermafbeelding van de applicatie · geïllustreerd hoofdkwartier · bewegende personages',
      territoryLabel: '02 — UW WERKGEBIED',
      territoryTitle: 'Bonjour.<br>Goedendag.<br><em>Hello.</em>',
      territoryBody: 'Een interface in het Frans, Nederlands en Engels. U kiest de taal van uw e-mails afzonderlijk, zodat die bij elk bedrijf past.',
      cities: '1.181 steden met meer dan 5.000 inwoners geïndexeerd vanuit GeoNames, inclusief hun naamvarianten.',
      controlLabel: 'EEN TOOL DIE VAN U IS',
      localTitle: 'Uw gegevens blijven lokaal.',
      localBody: 'Aanbiedingen, missies en concepten worden op uw computer bewaard. De schrijfassistenten gebruiken de dienst waarbij u bent aangemeld.',
      engineTitle: 'Kies uw assistent.',
      engineBody: 'Claude Code of Codex voor het schrijven. Het project kan worden ontwikkeld en gestart vanuit Claude Code, Cursor of Codex.',
      updateTitle: 'Prosper blijft zich ontwikkelen.',
      updateBody: 'Git-installaties krijgen een melding over nieuwe versies. Eén knop start de update, met behoud van uw gegevens en instellingen.',
      installLabel: '03 — GA OP VERKENNING',
      installTitle: 'Uw volgende missie<br>begint hier.',
      installBody: 'Node.js 22.13 of nieuwer en Git zijn vereist. Meld u aan bij Claude Code of Codex om e-mails voor te bereiden; alleen analyseren werkt ook zonder schrijfassistent.',
      github: 'Open het project op GitHub ↗',
      terminal: 'LOKALE INSTALLATIE',
      copy: 'Kopiëren',
      installNote: 'Het hoofdkwartier opent in uw browser. Begin met één stad en vijf bedrijven.',
      faqTitle: 'Worden e-mails automatisch verstuurd?',
      faqBody: 'Nee. Prosper maakt concepten. U beslist over de inhoud en het gebruik. U verstuurt ze vanuit uw eigen e-mailprogramma, nadat u de regels hebt gecontroleerd die op uw situatie van toepassing zijn.',
      credits: 'Gebaseerd op QG des agents van VibesMoney, onder de MIT-licentie.<br>Gegevens van OpenStreetMap · GeoNames · Natural Earth.',
      original: 'Het oorspronkelijke project ↗',
    },
    en: {
      navHow: 'The mission',
      navMap: 'The territory',
      install: 'Install Prosper ↗',
      kicker: 'ONE TEAM. THREE COUNTRIES. YOUR DECISION.',
      hero: 'There is ground to cover.<br><em>Set out as a team.</em>',
      lead: 'Prosper and his scouts find businesses in the Benelux, explore their websites and prepare your first contact. You watch the team work. You stay in control.',
      start: 'Meet my team <b>↗</b>',
      discover: 'See how it works ↓',
      micro: 'Open source · On your computer · No automatic sending',
      hq: 'HEADQUARTERS · BENELUX',
      speech: 'The team is ready.<br>Where do we start?',
      explore: 'YOUR NEXT CONTACT IS SOMEWHERE HERE.',
      belgium: 'Belgium',
      netherlands: 'The Netherlands',
      strip: 'Real cities.<br>Verifiable information.',
      processLabel: '01 — THE MISSION',
      processTitle: 'The agents move forward.<br>You make the decisions.',
      processIntro: 'A city, a sector and your offer. Each role has a clear task you can follow on screen.',
      step1Title: 'Scout',
      step1: 'The scout uses OpenStreetMap to find businesses in your sector and search area.',
      step2Title: 'Understand',
      step2: 'The researchers examine public websites, collect contact details and explain every part of the score.',
      step3Title: 'Prepare',
      step3: 'The writers suggest a first email based on your offer and an observation about the business.',
      step4Title: 'Your turn',
      step4: 'Review, edit, approve or reject. The software does not send any emails.',
      viewLabel: 'HEADQUARTERS, IN PLAIN SIGHT',
      viewTitle: 'Your city becomes<br>the mission’s terrain.',
      caption: 'Application screenshot · illustrated HQ · animated characters',
      territoryLabel: '02 — YOUR TERRITORY',
      territoryTitle: 'Bonjour.<br>Goedendag.<br><em>Hello.</em>',
      territoryBody: 'An interface in French, Dutch and English. Choose your email language separately to suit each business.',
      cities: '1,181 cities with more than 5,000 inhabitants indexed from GeoNames, including alternative names.',
      controlLabel: 'A TOOL THAT BELONGS TO YOU',
      localTitle: 'Your records stay local.',
      localBody: 'Offers, missions and drafts are stored on your computer. Writing assistants use the service you are signed in to.',
      engineTitle: 'Choose your assistant.',
      engineBody: 'Claude Code or Codex for writing. The project can be developed and launched from Claude Code, Cursor or Codex.',
      updateTitle: 'Prosper keeps evolving.',
      updateBody: 'Git installations are notified of new versions. One button starts the update while preserving your data and settings.',
      installLabel: '03 — TIME TO EXPLORE',
      installTitle: 'Your next mission<br>starts here.',
      installBody: 'Node.js 22.13 or later and Git are required. Sign in to Claude Code or Codex to prepare emails; analysis alone works without a writing engine.',
      github: 'Open the project on GitHub ↗',
      terminal: 'LOCAL INSTALLATION',
      copy: 'Copy',
      installNote: 'Headquarters opens in your browser. Start with one city and five businesses.',
      faqTitle: 'Are emails sent automatically?',
      faqBody: 'No. Prosper prepares drafts. You decide on their content and use. You send them from your own email account after checking the rules that apply to your situation.',
      credits: 'Based on VibesMoney’s QG des agents, under the MIT licence.<br>Data from OpenStreetMap · GeoNames · Natural Earth.',
      original: 'The original project ↗',
    },
  };

  const metadata = {
    fr: {
      ...original,
      language: 'Langue',
      copying: 'Copie en cours…',
      copied: 'La commande a été copiée.',
      copyFailed: 'La copie a échoué. Sélectionnez et copiez la commande ci-dessus.',
    },
    nl: {
      title: 'Prosper et les prospects — Samen de Benelux verkennen.',
      description: 'Prosper et les prospects: een team van agents dat de Benelux verkent, bedrijven analyseert en uw eerste contacten voorbereidt. U neemt de beslissing.',
      screenshot: 'De interface van Prosper et les prospects op de kaart van de Benelux',
      map: 'België, Nederland, Luxemburg',
      robot: 'Prosper, de teamleider',
      language: 'Taal',
      copying: 'Bezig met kopiëren…',
      copied: 'De opdracht is gekopieerd.',
      copyFailed: 'Kopiëren is mislukt. Selecteer en kopieer de opdracht hierboven.',
    },
    en: {
      title: 'Prosper et les prospects — Explore the Benelux as a team.',
      description: 'Prosper et les prospects: a team of agents that explores the Benelux, analyses businesses and prepares your first contacts. You make the decision.',
      screenshot: 'The Prosper et les prospects interface on the Benelux map',
      map: 'Belgium, the Netherlands, Luxembourg',
      robot: 'Prosper, the team leader',
      language: 'Language',
      copying: 'Copying…',
      copied: 'The command has been copied.',
      copyFailed: 'Copying failed. Select and copy the command above.',
    },
  };

  const languageSelect = document.querySelector('#language');
  const copyButton = document.querySelector('#copy');
  const copyStatus = document.querySelector('#copy-status');
  const command = document.querySelector('#command');
  let currentLanguage = 'fr';
  let copyInProgress = false;

  function applyLanguage(value) {
    currentLanguage = supported.has(value) ? value : 'fr';
    const words = metadata[currentLanguage];
    for (const node of nodes) {
      node.innerHTML = currentLanguage === 'fr'
        ? french.get(node)
        : translations[currentLanguage][node.dataset.t] ?? french.get(node);
    }
    document.documentElement.lang = currentLanguage;
    document.title = words.title;
    const description = document.querySelector('meta[name="description"]');
    if (description) description.content = words.description;
    for (const [selector, key] of [
      ['.app-window > img', 'screenshot'],
      ['img.benelux', 'map'],
      ['img.hero-robot', 'robot'],
    ]) {
      const image = document.querySelector(selector);
      if (image) image.alt = words[key];
    }
    if (languageSelect) {
      languageSelect.value = currentLanguage;
      languageSelect.setAttribute('aria-label', words.language);
    }
    if (copyStatus) copyStatus.textContent = copyInProgress ? words.copying : '';
    try { localStorage.setItem(storageKey, currentLanguage); } catch {}
  }

  languageSelect?.addEventListener('change', () => applyLanguage(languageSelect.value));
  if (copyStatus) {
    copyStatus.setAttribute('aria-live', 'polite');
    copyStatus.setAttribute('aria-atomic', 'true');
  }
  copyButton?.addEventListener('click', async () => {
    if (!command || copyInProgress) return;
    copyInProgress = true;
    copyButton.disabled = true;
    copyButton.setAttribute('aria-busy', 'true');
    if (copyStatus) copyStatus.textContent = metadata[currentLanguage].copying;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(command.textContent);
      if (copyStatus) copyStatus.textContent = metadata[currentLanguage].copied;
    } catch {
      if (copyStatus) copyStatus.textContent = metadata[currentLanguage].copyFailed;
    } finally {
      copyInProgress = false;
      copyButton.disabled = false;
      copyButton.removeAttribute('aria-busy');
    }
  });

  let savedLanguage = 'fr';
  try { savedLanguage = localStorage.getItem(storageKey) ?? 'fr'; } catch {}
  applyLanguage(savedLanguage);
})();
