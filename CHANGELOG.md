# Historique des versions

## 1.0.5 — 26 octobre 2026

- Le journal de la mission est synchronisé avant les événements en direct : un lecteur rapide ne peut plus être effacé par l’initialisation tardive de la scène.
- Après une coupure du suivi, les événements manqués sont récupérés dans l’ordre, sans doublons ni remise à zéro de la mission.
- Un échec temporaire du journal est réessayé automatiquement ; le chargement de la ville n’abandonne plus une recherche déjà lancée. Le statut de fin d’un lot de rédaction est reconnu après reconnexion.
- Les délais transitoires du rédacteur ne déclenchent plus un arrêt après trois commerces : l’équipe poursuit avec les autres candidats dans les limites annoncées. Un défaut permanent de connexion ou de configuration reste signalé.
- Les compteurs affichent les progrès enregistrés, indépendamment du rythme des personnages. Les erreurs déjà réparées ne restent plus comptées comme des erreurs en cours.
- La reprise réserve les deux appels de rédaction actifs pour respecter le quota exact. Le vidage d’une longue file laisse l’API répondre.
- Les échecs du CLI conservent des mesures bornées d’activité et de durée, sans texte privé ; une authentification refusée propose une reconnexion au lieu d’un nouvel essai automatique.

## 1.0.4 — 26 octobre 2026

- Les lecteurs partent pendant le repérage adaptatif, sans attendre sa fin.
- Analyse HTML linéaire et isolée dans un travailleur avec délai maximal : une page bloquée ne fige plus le serveur ni les autres commerces. Les essais de pages et les délais DNS/HTTP sont bornés.
- Détection du Codex fourni avec les applications officielles sur macOS, même lorsque le terminal ne le trouve pas dans son chemin habituel.
- Reprise explicite d’une mission interrompue depuis ses commerces enregistrés, avec les mêmes objectifs et sans réécrire les brouillons ou décisions existants.
- Une perte de réponse du serveur est signalée à l’écran.

## 1.0.3 — 23 octobre 2026

- Résultats réunis avec carte des commerces et tous les mails préparés. Consultation des commerces écartés, non lus ou sans coordonnées ; édition, validation, refus et copie des brouillons.
- Objectifs fondés sur les contacts qualifiés et les mails réellement préparés. Recherche élargie et bornée à 250 commerces et 20 km ; bilan détaillant le résultat et la raison d’un objectif non atteint, sans promettre des données indisponibles.
- Une reprise automatique des seuls délais locaux de rédaction : 90 puis 180 secondes par défaut. Mission partielle et erreur conservées avec les fiches ; reprise manuelle des seuls mails manquants, sans effacer les brouillons existants.
- Langue demandée et provenance enregistrées pour les nouveaux mails : choix explicite, langue HTML du site ou français par défaut. Aucune provenance reconstituée pour les anciens brouillons.
- Fiches publiques enrichies et sourcées : contacts, adresses, horaires, réseaux, services et pages utiles issus du HTML, de JSON-LD et de microdata, sans requête supplémentaire. Les données absentes restent absentes.

Aucun envoi de mail automatique. Les assistants utilisent le compte CLI connecté ; aucune clé API de rédaction n’est créée par le logiciel.
