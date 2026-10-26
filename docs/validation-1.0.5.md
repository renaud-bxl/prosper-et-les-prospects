# Validation de Prosper 1.0.5 — 26 octobre 2026

- Suite complète : 178 tests, 175 réussis, aucun échec, trois tests Windows ignorés sur macOS. Construction Vite réussie.
- Journal et suivi : arrivée SSE avant la réponse du journal, doublons, reconnexion, événements manqués, changement de mission pendant un chargement, échec de journal avec nouvel essai automatique, annulation des essais lors d’un changement de mission.
- Coordinateur réel, API HTTP, SQLite et workers de lecture : réponses HTTP et rédacteur factices. Trois délais transitoires puis succès, authentification permanente, reprise du même identifiant, conservation d’un mail validé, quota exact malgré deux rédacteurs, 80 candidats échoués avec bilan explicite et API réactive.
- Chronologie de démarrage anonymisée : huit lieux, trois lecteurs, départ avant la fin du repérage ; rejeu suivi d’une reprise sans remise à zéro.
- Interface réelle dans le navigateur : formulaire café à Bruxelles, huit commerces explicitement fictifs, journal retardé de 1,2 seconde et coupure SSE simulée. Huit visites terminées, sept contacts fictifs et un brouillon fixe affichés ; déplacements et suivi d’un lecteur vérifiés. Aucun appel IA ni envoi de mail dans cette fixture.
- Contrôles de lancement dans les trois langues FR/NL/EN et les thèmes clair/nuit ; présentation publique vérifiée en français, néerlandais et anglais, clair/nuit.

Ces essais ne garantissent ni l’accès à chaque site externe ni les délais du fournisseur de rédaction. Un problème externe reste visible, avec conservation des résultats. Aucune donnée privée de mission ne fait partie des sources publiques de validation.

Mesure sur les mêmes 100 tuiles de Bruxelles en cache : placement exact du QG de 71,424 à 3,469 secondes ; constructeur de scène de 73,108 à 5,122 secondes. Même emplacement, mêmes 307 619 nœuds du graphe. Les tests comparent les résultats géométriques avant/après (parties de bâtiments, trous, distances aux routes, limites et égalités), sans assertion de durée dépendant de la machine.
