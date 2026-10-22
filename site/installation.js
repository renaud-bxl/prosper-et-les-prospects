// The web page selects a command. Disk discovery and folder confirmation
// happen in the installer, on the visitor's computer.
const base='https://raw.githubusercontent.com/renaud-bxl/prosper-et-les-prospects/main/';
const words={
 fr:{windows:'à valider',platform:'1 · Sur quel ordinateur ?',intro:'Copiez cette commande dans votre terminal. L’installateur vous présente les disques disponibles, puis vous choisissez un disque ou un dossier personnalisé.',note:'2 · Le choix du disque se fait dans le terminal. Le dossier exact est récapitulé et vous le confirmez avant toute installation.',source:'Consulter le script avant de le lancer ↗',summary:'Node.js 22.13 ou plus récent et Git sont nécessaires. Vous choisissez où installer Prosper. Connectez ensuite Claude Code ou Codex pour rédiger les mails.',terminal:'COMMANDE D’INSTALLATION',copy:'Copier la commande'},
 nl:{windows:'nog te testen',platform:'1 · Op welke computer?',intro:'Kopieer deze opdracht naar uw terminal. Het installatieprogramma toont de beschikbare schijven. U kiest een schijf of een eigen map.',note:'2 · U kiest de schijf in de terminal. U ziet de exacte map en bevestigt deze voordat de installatie begint.',source:'Bekijk het script voordat u het uitvoert ↗',summary:'Node.js 22.13 of nieuwer en Git zijn vereist. U kiest waar Prosper wordt geïnstalleerd. Meld u daarna aan bij Claude Code of Codex om e-mails te schrijven.',terminal:'INSTALLATIEOPDRACHT',copy:'Opdracht kopiëren'},
 en:{windows:'needs validation',platform:'1 · Which computer?',intro:'Copy this command into your terminal. The installer shows the available drives, then you choose a drive or a custom folder.',note:'2 · Choose the drive in the terminal. Review the exact folder and confirm it before installation begins.',source:'Read the script before running it ↗',summary:'Node.js 22.13 or later and Git are required. You choose where to install Prosper. Then sign in to Claude Code or Codex to write emails.',terminal:'INSTALLATION COMMAND',copy:'Copy command'}
};
let platform=/Windows/i.test(navigator.userAgent)?'windows':/Mac/i.test(navigator.userAgent)?'mac':'linux';
const control=document.querySelector('#install-platform');
function update(){
 const text=words[document.documentElement.lang]??words.fr;
 control.querySelector('legend').textContent=text.platform;
 document.querySelector('#windows-installer-status').textContent=text.windows;
 for(const input of control.querySelectorAll('input'))input.checked=input.value===platform;
 document.querySelector('[data-t=installCardIntro]').textContent=text.intro;
 document.querySelector('[data-t=installBody]').textContent=text.summary;
 document.querySelector('#installation-location-note').textContent=text.note;
 document.querySelector('[data-t=terminal]').textContent=text.terminal+' · '+({mac:'macOS',linux:'Linux',windows:'PowerShell'})[platform];
 document.querySelector('#copy').textContent=text.copy;
 const windows=platform==='windows';
 const command=windows?'irm '+base+'install.ps1 | iex':'curl -fsSL '+base+'install.sh | sh';
 document.querySelector('#command').textContent=command;
 const source=document.querySelector('[data-t=sourceInstall]');source.textContent=text.source;source.href='https://github.com/renaud-bxl/prosper-et-les-prospects/blob/main/'+(windows?'install.ps1':'install.sh');
}
control.addEventListener('change',e=>{if(e.target.name==='install-platform'){platform=e.target.value;document.querySelector('#copy-status').textContent='';update();}});
document.addEventListener('prosper-language',update);update();
