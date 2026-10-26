# Prosper et les prospects

Une équipe de sept personnages explore les commerces du **Benelux**, lit leurs sites et prépare des premiers contacts. Vous choisissez la ville, le métier et votre offre. Prosper coordonne Léo, Hugo, Zoé, Iris, Malo et Nina sur la carte réelle, dans une ville illustrée.

**Interface et mails en français, néerlandais et anglais. Aucun mail n’est envoyé par le logiciel.**

Adaptation du [QG des agents](https://github.com/devlikemasta/qg-des-agents), sous licence MIT. Le thème clair et nuit reprend les couleurs de [Oscar et les agents](https://github.com/renaud-bxl/oscar-et-les-agents), l’autre application de cette famille.

![Le QG et son équipe illustrée](docs/qg.png)

## Installer et démarrer

Prérequis déjà installés : **Node.js 22.13 ou plus récent** et **Git**. Aucun droit administrateur n’est demandé et l’installateur n’installe pas ces outils à votre place. Pour écrire des mails, connectez Claude Code ou Codex sur votre ordinateur. La collecte et l’analyse seules fonctionnent sans assistant de rédaction.

Sur **macOS ou Linux**, collez cette commande dans un Terminal interactif :

```sh
curl -fsSL https://raw.githubusercontent.com/renaud-bxl/prosper-et-les-prospects/main/install.sh | sh
```

Sur **Windows**, ouvrez PowerShell et collez :

```powershell
irm 'https://raw.githubusercontent.com/renaud-bxl/prosper-et-les-prospects/main/install.ps1' | iex
```

L’installateur Windows est préparé mais son exécution doit encore être validée sur Windows ; les tests natifs sont explicitement sautés sur le Mac de développement.

L’installateur propose **Documents**, les **disques montés** disponibles et un **chemin personnalisé**. Les noms et chemins des disques sont affichés dans le terminal, pas détectés par la page web. Pour un disque, un sous-dossier `Prosper et les prospects` est proposé ; un chemin personnalisé désigne le **dossier final exact**. Les chemins contenant des espaces sont pris en charge.

Un récapitulatif affiche le dossier exact avant toute création, tout téléchargement du projet et toute installation de dépendances. Confirmez avec `o` sur macOS/Linux ou `INSTALLER` sur Windows. Une annulation ne crée aucun fichier du projet. Sur macOS/Linux, les questions passent par `/dev/tty` quand le script est reçu dans le pipe ; un lancement sans terminal interactif est refusé.

Le projet est ensuite cloné depuis ce dépôt, sur la branche **main**, puis ses dépendances sont installées, l’interface est construite et Prosper démarre. Les missions, réglages et brouillons restent dans le dossier choisi. Si vous choisissez un disque externe, gardez-le branché pendant l’utilisation.

**Un dossier non vide, un fichier ou un lien symbolique est refusé. Aucun dossier existant n’est effacé ou remplacé.** Pour une installation déjà présente, ouvrez son dossier et relancez `npm start` ; utilisez ensuite le bouton de mise à jour du logiciel. Après un téléchargement ou une construction interrompus, le dossier partiellement installé est conservé pour inspection : ne relancez pas l’installateur dessus sans avoir vérifié son contenu.

Le logiciel ouvre **http://127.0.0.1:5577** et n’écoute que sur votre ordinateur. Pour les lancements suivants :

```sh
cd "/chemin/exact/choisi/Prosper et les prospects"
npm start
```

Remplacez le chemin par celui du récapitulatif. Sur macOS, `Lancer Prosper.command` propose le même démarrage ; sur Windows, utilisez `Lancer Prosper.cmd` dans le dossier installé.

Pour préciser un dossier macOS/Linux dès le départ tout en conservant la confirmation :

```sh
curl -fsSL https://raw.githubusercontent.com/renaud-bxl/prosper-et-les-prospects/main/install.sh | sh -s -- --dir "/chemin/absolu/Prosper et les prospects"
```

## Reprendre une mission

Après un arrêt du logiciel, les commerces et les mails déjà enregistrés restent dans la base locale. Si les objectifs de la mission sont connus, le bouton **Reprendre la mission** continue cette même mission : les commerces non terminés repartent en lecture, les mails manquants sont préparés, puis la recherche se poursuit si nécessaire. Les brouillons existants et les décisions sont conservés. Une mission active ne peut pas être relancée en parallèle.

Chaque site est analysé dans un travailleur isolé avec un délai maximal ; une page qui dépasse ce délai est signalée sur sa fiche et ne bloque pas le reste de l’équipe.

## Première mission

1. Choisissez la langue de l’interface et le thème clair/nuit.
2. Cherchez une ville en Belgique, aux Pays-Bas ou au Luxembourg. Les variantes de noms sont reconnues, comme Bruxelles/Brussel et Anvers/Antwerpen.
3. Sélectionnez un métier, un rayon de départ et un objectif de contacts qualifiés. Commencez par cinq. Le nombre de commerces à visiter peut être supérieur à cet objectif.
4. Choisissez **Lecture seule**, **Claude Code** ou **Codex**. Pour les mails, renseignez votre offre et votre signature. La langue des mails est indépendante de celle de l’interface ; le mode automatique suit la langue déclarée par le site, sinon le français.
5. Lancez la mission. Le scout découvre les commerces ; les lecteurs empruntent les rues et entrent dans les bâtiments. Cliquez sur un commerce pour consulter contacts, observations et score.
6. La fenêtre de résultats réunit une carte, tous les commerces repérés et tous les mails préparés. Les commerces écartés, non lus ou sans coordonnées restent consultables. Chaque mail peut être corrigé, validé, refusé ou copié. En mode analyse seule ou après une préparation partielle, renseignez votre offre et préparez uniquement les mails manquants, sans refaire la recherche.
7. Relisez et corrigez chaque brouillon, puis validez ou refusez. L’envoi éventuel se fait depuis votre messagerie.

Les sites publics peuvent être incomplets ou inaccessibles. Les signaux sont des observations automatiques, à vérifier avant usage : l’absence d’un module détecté ne prouve pas l’absence du service. Les commerces sans contact public peuvent être écartés. Les données cartographiques dépendent d’OpenStreetMap et des services de tuiles publics.

## Suivi fiable des missions — 1.0.5

Le suivi attend le journal enregistré avant de jouer les nouveaux événements. Une reconnexion récupère les gestes manqués dans leur ordre, sans redémarrer la recherche. Les compteurs du haut utilisent les résultats enregistrés ; les personnages jouent les visites à leur rythme.

Un délai temporaire de rédaction n’arrête plus la mission après trois commerces. L’équipe essaie d’autres candidats jusqu’à l’objectif ou aux limites de recherche et de rédaction. Pour un objectif de 60 mails, le budget est de 80 commerces soumis à la rédaction par exécution, avec au plus deux essais par commerce. Un défaut permanent de connexion ou de configuration demande une intervention ; le bilan conserve les résultats et permet la reprise des éléments manquants.

## Objectifs, reprise et informations — 1.0.3

Un **objectif de contacts qualifiés** ne compte pas les commerces simplement repérés : il faut une adresse de contact relevée et un score suffisant. Avec un assistant actif, l’objectif de mails compte les brouillons réellement préparés. La recherche peut donc examiner davantage de commerces et élargir le rayon de départ, avec des bornes de **250 commerces** et **20 km**. Les compteurs distinguent commerces repérés, examinés, contacts retenus et mails préparés.

Ces objectifs ne sont pas une garantie : des contacts peuvent être absents, des sites inaccessibles ou les sources épuisées. Le bilan indique si l’objectif est atteint et la raison d’un arrêt anticipé : zone parcourue, limite de recherche, source indisponible ou rédaction bloquée. Une mission partielle conserve les commerces, leurs coordonnées, leurs informations et les mails déjà écrits.

Un délai local de rédaction déclenche **une seule reprise automatique**, avec **90 secondes puis 180 secondes par défaut**. Les autres erreurs de connexion, de configuration ou de sortie refusée demandent une vérification ; elles ne provoquent pas cette reprise automatique. Les erreurs restent associées au commerce concerné. **Préparer les mails manquants** reprend les fiches éligibles déjà enregistrées et conserve les brouillons existants ; cela ne crée pas les contacts absents et ne garantit pas d’atteindre le quota initial.

La **langue des mails** est indépendante de l’interface. Un choix explicite français, néerlandais ou anglais est prioritaire. En automatique, Prosper suit uniquement la langue déclarée dans `<html lang>` de la page d’accueil reçue ; si elle est absente ou hors FR/NL/EN, le français est utilisé. Le pays, la ville et le suffixe du domaine ne décident pas de cette langue. Chaque nouveau mail conserve la langue demandée au moteur et son origine : choix manuel, site ou défaut. Pour un ancien brouillon sans ces métadonnées, la provenance reste inconnue. Cette indication ne constitue pas une détection linguistique après une modification manuelle du texte.

Les fiches conservent aussi les **informations publiques sourcées** trouvées sur les pages lues : sites, adresses, téléphones, e-mails, horaires, réseaux sociaux, services mentionnés et liens utiles. Le lecteur exploite le HTML et les données structurées JSON-LD ou microdata, dans la limite des quatre pages déjà prévues, sans nouvelle visite pour cet enrichissement. Chaque information affichée renvoie à sa page source. Une donnée absente n’est ni inventée ni assimilée à l’absence du service.

## Claude Code, Codex et Cursor

| Usage | Prise en charge |
| --- | --- |
| Développer et lancer depuis Claude Code, Codex ou Cursor | Même projet Node.js, consignes partagées dans AGENTS.md et CLAUDE.md |
| Rédiger avec l’abonnement Claude | Claude Code connecté, commande `claude` |
| Rédiger avec l’accès Codex | Codex connecté, commande `codex` |
| Utiliser Cursor comme moteur de rédaction du serveur | Pas implémenté ; Cursor peut développer et démarrer l’application |
| Appeler directement le modèle OpenAI o1 par API | Pas implémenté ; o1 est signalé obsolète dans la [documentation OpenAI](https://developers.openai.com/api/docs/models/o1) |

Le champ modèle passe le nom au CLI choisi : sa disponibilité dépend du compte et du CLI. Une option inconnue produit une erreur visible, sans brouillon de remplacement. Aucune clé OpenAI n’est nécessaire pour les moteurs CLI. Le logiciel ne crée aucune clé et n’enregistre aucun identifiant de connexion.

Les pages des commerces sont des données non fiables. Les consignes de rédaction sont séparées de leurs extraits. Claude est appelé sans outils et sans configuration MCP ; Codex utilise un dossier isolé, une session éphémère et une lecture seule avec les principales surfaces d’outils désactivées. Ces CLI et leurs versions doivent être maintenus à jour. Les informations nécessaires au brouillon sont transmises au fournisseur de l’assistant choisi ; les fichiers locaux de missions ne sont pas publiés sur GitHub.

## Mises à jour en un clic

Pour une installation faite avec **git clone** sur la branche **main**, le logiciel vérifie le dépôt GitHub au démarrage puis périodiquement (cache de 30 minutes). Une notification présente les nouvelles modifications. Le bouton **Mettre à jour** :

- vérifie le dépôt d’origine et l’absence de mission active ou de modifications locales bloquantes ;
- prépare les dépendances et construit la nouvelle version dans un dossier isolé ;
- applique uniquement une avance directe de l’historique Git ;
- redémarre le serveur, puis recharge l’interface après vérification.

`config.json`, `.env` et `data/` sont préservés. Une erreur de préparation conserve la version actuelle ; un échec de redémarrage déclenche la restauration prévue. Une copie ZIP sans Git ne bénéficie pas des mises à jour automatiques. Une modification locale du code doit être résolue avant de mettre à jour. La mise à jour n’installe pas Node.js, Git ou les assistants à votre place.

Pour publier une modification destinée aux installations existantes, testez et construisez le projet, puis poussez les changements sur `main`. Les installations ouvertes détectent le nouveau commit ; les autres le détectent au prochain lancement. Aucun service de notification ne fonctionne quand le logiciel est fermé.

## Données et configuration

- `config.json` : votre offre et les derniers réglages, créé depuis `config.example.json` au premier démarrage.
- `data/agents.db` : missions, contacts, informations sourcées, scores, brouillons, langue de rédaction et décisions dans une base SQLite locale. La migration ajoute les champs manquants sans réécrire les anciens mails.
- `data/overpass` et `data/tuiles` : cache des réponses publiques.
- `.env` : seulement la clé Google Maps facultative si vous choisissez cette intégration ; modèle fourni dans `.env.example`.

Ces chemins sont ignorés par Git. Ne publiez jamais votre configuration personnelle, votre base de contacts ou vos clés. Aucune intégration Gmail, SMTP ou d’envoi de masse n’est présente.

## Développement et validation

```sh
npm run dev
npm test
npm run build
```

Le serveur reste sur `127.0.0.1:5577`. Les tests utilisent des réponses HTTP, CLI et dépôts Git de contrôle ; ils ne contactent pas des prospects et n’exécutent pas de génération payante. Les moteurs Claude Code et Codex ont aussi produit chacun un brouillon de validation sur un exemple fictif, sans envoi. Les aides CLI sont vérifiées sur les versions installées pendant le développement ; l’authentification du compte reste propre à chaque utilisateur.

Le sous-dossier `site/` contient la page de présentation statique. Les contrôles clavier de la scène : `N` change la lumière, `R` rejoue, `C` recentre le réalisateur ; la molette et le glisser déplacent la caméra. `?cinema` rejoue une mission enregistrée en version cinéma.

## Sources et licences

- Code de départ : [devlikemasta/qg-des-agents](https://github.com/devlikemasta/qg-des-agents), commit `c262a413544b6c6ed80d4739e100d87b8ac26e34`, MIT ; copyright original conservé dans LICENSE.
- Explication du fonctionnement : [guide VibesMoney](https://vibesmoney.com/guides/clients-agents-ia). La vidéo transmise a servi de référence de travail ; elle n’est pas redistribuée dans ce dépôt.
- Thème : [Oscar et les agents](https://github.com/renaud-bxl/oscar-et-les-agents).
- Données : © contributeurs [OpenStreetMap](https://www.openstreetmap.org/copyright), ODbL ; tuiles [OpenFreeMap](https://openfreemap.org) ; [GeoNames](https://www.geonames.org), CC BY 4.0 ; contours Natural Earth, domaine public.
- Polices Pixelify Sans et Plus Jakarta Sans, OFL.

La liste de villes contient **1 181 villes d’au moins 5 000 habitants**, issues de GeoNames (686 BE, 476 NL, 19 LU), hors quartiers, avec alias officiels. Pour la régénérer, télécharger les fichiers GeoNames `cities5000.txt` et `admin1CodesASCII.txt` dans un dossier local puis lancer `node scripts/carte-donnees.mjs --geonames=/chemin/du/dossier`.
