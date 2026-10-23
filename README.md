# Crypto Radar — version gratuite (GitHub)

Pas de serveur, pas de carte bancaire.
- **GitHub Actions** lance l'analyse complète chaque jour vers **06 h (Paris)**, et une actualisation toutes les 3 h.
- La base de données est gardée dans la branche `data` du dépôt.
- L'app et les données sont publiées sur **GitHub Pages** : https://paulthiry2104-ship-it.github.io/Detectionapp/
- Sur iPhone : ouvre ce lien dans Safari, puis **Partager → Sur l'écran d'accueil**.

> Rien ici n'est un conseil en investissement. Les scores et scénarios sont des estimations, pas des promesses.

## Ce qui marche / ce qui change par rapport à la version serveur
- ✅ Analyse quotidienne, rapport du jour, classements 7 j / 30 j / 12 mois, scénarios, suspects, historique, performances.
- ✅ Si une analyse échoue : l'exécution GitHub passe en rouge (e-mail de GitHub), l'app affiche l'avertissement et garde les dernières données avec leur date.
- ⚠️ GitHub peut retarder une exécution de 10 à 30 min.
- ⚠️ Favoris et alertes sont gardés sur ton téléphone. Les alertes sont vérifiées à l'ouverture de l'app : il n'y a pas de push serveur.
- ⚠️ Le dépôt doit être **public** pour GitHub Pages gratuit. Il ne contient aucun secret : les clés optionnelles vont dans *Settings → Secrets*.

## Clés optionnelles (Settings → Secrets and variables → Actions → New repository secret)
- `COINGECKO_API_KEY` : clé Demo gratuite (coingecko.com/en/api). Recommandée si CoinGecko bloque les serveurs GitHub.
- `COINMARKETCAL_API_KEY` : catalyseurs datés.

## Lancer une analyse à la main
Onglet **Actions → Crypto Radar → Run workflow**.

## Structure
- `backend/` : collecte, scoring, tâche quotidienne (`src/jobs/ci.ts` = point d'entrée GitHub), tests (`npm test`)
- `mobile/` : app Expo (iPhone + web)
- `.github/workflows/radar.yml` : planification + publication

La version avec serveur (Fly.io, push iPhone) reste dans le code (`npm start` dans `backend/`) si tu veux y revenir plus tard.
