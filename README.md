# JVFinder

Un site en français, adapté aux téléphones, pour choisir un jeu entre cinq amis : chacun entre son prénom et swipe les jeux. Un match apparaît lorsque **les cinq personnes ont dit oui au même jeu**. Les votes sont indépendants et peuvent être annulés.

## Lancer sous Windows

Double-cliquer sur **Demarrer.bat**, puis garder la fenêtre ouverte. Le site est disponible sur **http://localhost:8765**. Node.js 22 ou supérieur suffit ; aucune dépendance npm à installer. Sans configuration Supabase, le catalogue et les favoris fonctionnent en solo, et l’interface indique que les salons ne sont pas configurés.

Ou dans PowerShell, depuis ce dossier :

```powershell
npm run dev
```

Pour changer le port : définir `PORT` dans `.env.local`.

Pour ouvrir le site sur un téléphone, connecter les deux appareils au même réseau puis utiliser l’adresse « Réseau local » affichée au lancement (par exemple `http://192.168.1.29:8765`). Le PC doit rester allumé et le serveur démarré. Si Windows le demande, autoriser Node.js sur le réseau privé.

## Mettre en ligne sur Vercel + Supabase

Le code est prêt pour ces services, mais la publication exige vos accès. Aucun projet cloud n’est créé automatiquement par le lancement local.

1. Créer un projet Supabase vide, de préférence dans une région européenne. Exécuter le fichier `supabase/migrations/202611140001_rooms.sql` dans le SQL Editor, ou appliquer cette migration avec la CLI Supabase.
2. Déployer ce dossier avec Vercel (CLI `vercel`, ou dépôt Git importé). Framework : **Other** ; commande de build : `npm run build` ; dossier de sortie : `dist`. `vercel.json` configure les fonctions et le routage. Utiliser Node.js 22 ou supérieur.
3. Configurer dans les variables **serveur** Vercel `SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY` (clé serveur service role / secret Supabase). Puis redéployer. Ne jamais ajouter cette clé dans `public/`, dans Git ou dans un paramètre `VITE_` / `NEXT_PUBLIC_`.
4. Vérifier `/api/health` : `configured: true` signale la présence des variables, pas la validité de la migration. Créer un salon et vérifier l’enregistrement effectif pour valider la connexion.
5. Entrer son prénom, créer le salon et copier le **lien d’invitation** pour les quatre autres personnes. Le sixième participant est refusé. Les votes et matchs sont rafraîchis toutes les six secondes, sans serveur permanent.

Pour utiliser le salon partagé en développement, copier `.env.example` vers `.env.local` et y renseigner le projet Supabase. Le serveur local utilise les mêmes routes que Vercel.

### Accès et confidentialité

Pas de compte ni de mot de passe : chaque participant reçoit une clé aléatoire de 256 bits, conservée dans son navigateur. Seul son hash SHA-256 est stocké dans la base. Les prénoms identiques dans un salon sont refusés pour éviter les confusions ; saisir un prénom déjà utilisé ne permet pas de récupérer ses votes.

Le lien du salon est une invitation privée à prendre une place. Le **lien personnel de reprise** contient la clé du participant dans le fragment de l’URL : il permet de retrouver sa place sur un autre appareil et doit rester privé. Sans le navigateur original ni ce lien, une place ne peut pas être récupérée simplement par son prénom. Il n’y a pas encore de gestion d’expulsion ou de récupération par email.

Les membres voient les prénoms, le nombre de votes et les matchs à cinq. Les votes individuels restent privés. RLS est activé sur les tables, aucun accès `anon` / `authenticated` n’est accordé ; seule la fonction serveur peut appeler la procédure dédiée. La clé Supabase reste côté serveur. Les groupes et votes ne sont pas effacés automatiquement.

## Utilisation

- Glisser une fiche à droite pour garder, à gauche pour passer. Les boutons et les flèches du clavier fonctionnent aussi. Le bouton Revenir annule le dernier swipe.
- Filtrer le nombre de joueurs, le mode local/en ligne, le budget par exemplaire, le genre et la durée indicative d’une session.
- « Compatible avec la bande » exclut les capacités inconnues. Les mods sont désactivés au départ ; PlateUp! nécessite un mod à 5. Les jeux en vote/relais sont aussi désactivés au départ.
- Cliquer sur l’image pour lire la bande-annonce officielle. Plusieurs vidéos sont sélectionnables lorsqu’elles sont disponibles.
- Retrouver ses favoris dans Ma sélection, puis copier la liste pour la partager manuellement.
- Le catalogue permet d’examiner toutes les fiches correspondant aux filtres. Désactiver le filtre strict et la disponibilité pour consulter les titres incertains, annoncés ou retirés.
- Données & sources explique la provenance des prix et vidéos Steam France. Les sources et restrictions sont également indiquées sur les fiches. Le script de maintenance permet d’actualiser le catalogue avant un redéploiement.

## Données et limites

42 fiches : les 18 propositions initiales et 24 ajouts, dont Counter-Strike 2, Deadlock, League of Legends, VALORANT, Dota 2 et des jeux de survie en ligne. Le nombre de joueurs correspond au groupe pouvant jouer ensemble dans le mode indiqué, pas au total des adversaires dans une partie. Capacités renseignées manuellement dans `data_catalog.py`, avec sources Steam. Co-Optimus bloque l’accès automatisé (403) : aucun contenu n’y a été extrait. Les durées sont des suggestions éditoriales de session, **pas** des durées de campagne vérifiées. Les tarifs proviennent de l’API Steam, région France, euros, et restent soumis à variation. Les données inconnues ne sont pas remplacées par des estimations.

Les bandes-annonces sont celles des éditeurs, lues avec hls.js. Internet est nécessaire pour les vidéos et les salons. Les images sont mises en cache localement lors de leur première récupération. Les polices Google disposent d’une police système de secours. En solo, les favoris restent dans le stockage du navigateur. Dans un salon, les votes sont conservés dans Supabase. Aucun outil d’analyse d’audience, achat ou inscription.

Le serveur de développement écoute sur le réseau local (0.0.0.0). Le terminal affiche les adresses accessibles depuis les autres appareils. Pour limiter l’accès à cet ordinateur, définir HOST=127.0.0.1 dans .env.local. Docker n’est pas nécessaire pour utiliser le site. Arrêt avec Ctrl+C dans la fenêtre du serveur.

Pour réactualiser le catalogue en terminal : `python refresh_catalog.py` (Python 3.10+). Le fichier `catalog.json` conserve les dernières données quand Steam ne répond pas. Puis redéployer pour publier les nouveaux tarifs. Le serveur Python historique `python server.py` reste utilisable pour le catalogue solo, mais ne gère pas les salons.

## Vérifications

`npm run build` prépare les fichiers statiques. `npm test` vérifie l’API, les entrées invalides, les origines et l’absence de fuite de clé. Le test PostgreSQL est activé avec `JVF_TEST_DB` pointant vers un conteneur PostgreSQL de test ayant les rôles Supabase et la migration appliquée. Il vérifie les cinq votes indépendants, l’annulation d’un match, la limite de places, les noms dupliqués, les reprises de requêtes et les accès SQL interdits.

L’interface a été inspectée à 390 × 844, avec lecture effective d’une bande-annonce et ajout d’un favori. Les tests cloud nécessitent un projet Supabase configuré et le déploiement Vercel.

## Fichiers

`public/` : interface et hls.js ; `api/index.js` : API Vercel ; `supabase/migrations/` : schéma et procédure SQL ; `dev-server.mjs` : serveur local ; `data_catalog.py` : données éditoriales ; `refresh_catalog.py` : récupération Steam ; `catalog.json` : cache ; `tests/` : vérifications.

## Suggestions et super-likes

Le bouton ★ ajoute un super-like. Il compte comme un oui dans le calcul des matchs, et pèse quatre fois un like dans le classement personnel. Un refus réduit la priorité des jeux similaires. L’algorithme compare genre, type de jeu, durée, budget et mode ; il varie les genres après deux suggestions similaires consécutives. Il ne prédit pas une probabilité de plaisir et n’utilise pas les votes privés des autres membres. Le classement « Ordre du catalogue » reste disponible.

Les choix déjà enregistrés orientent immédiatement le classement. Les super-likes sont conservés dans Supabase dans les salons et dans le navigateur en solo. Les matchs restent unanimes : cinq personnes distinctes dans **le même salon**, chacune avec un like ou un super-like.

## Diagnostic et historique

La table privée `jvf_events` journalise les créations, les arrivées et les changements de votes à partir de l’installation de la migration `20261114154512_superlikes_and_vote_history.sql`. Elle contient identifiants de salon/personne/jeu, ancien et nouveau vote, date et action. Aucun token, hash de token ni appel périodique n’y est journalisé. Elle n’est accessible ni aux clients anonymes ni aux membres via l’API de l’application. Les anciennes valeurs de vote antérieures à cette migration ne peuvent pas être reconstituées.

Les logs d’erreurs techniques restent consultables dans Supabase et Vercel. Les données de test sont supprimées après vérification.

## Compte Steam et amis

« Connexion Steam » utilise OpenID 2.0 : Steam authentifie la personne sur son propre site. JVFinder vérifie l’identité, la signature auprès de Steam, le domaine de retour, l’état de connexion et un nonce à usage unique. Les sessions sont conservées dans des cookies HttpOnly de 30 jours, révocables par déconnexion ; seuls leurs hash sont stockés dans Supabase. Un compte ne peut prendre qu’une place par salon. Les accès invités existants continuent de fonctionner ; une place rattachée à Steam nécessite ensuite la connexion à ce compte.

Les votes et filtres sont liés au profil Steam. La première connexion rattache l’accès invité courant et conserve les votes existants. Les choix du compte déjà enregistrés ont priorité lors de l’import de données locales. Les nouveaux salons reprennent les préférences personnelles ; les votes déjà présents dans un ancien salon sont préservés. « Mon compte » permet de retrouver ses salons sur un autre appareil et de consulter ses jeux aimés.

Configurer `APP_URL=https://multiplayerfinder.vercel.app` dans Vercel et appliquer la migration `20261114161451_steam_accounts_and_preferences.sql`. Pour le développement local, utiliser `APP_URL=http://localhost:8765`. Cette URL est canonique et n’est jamais déduite d’un en-tête Host non fiable.

La connexion et les préférences fonctionnent sans clé Steam Web API. Pour charger les amis, ajouter **`STEAM_WEB_API_KEY`** comme secret serveur Vercel, puis redéployer. Créer la clé sur `https://steamcommunity.com/dev/apikey` pour le domaine du site. Ne jamais publier cette clé dans Git ou dans le chat. Une liste d’amis privée renvoie un état explicite et laisse disponible l’invitation par lien. Les amis sont mis en cache deux minutes en mémoire, sans copie intégrale en base ; au plus 500 profils sont affichés.

Les invitations sont des invitations **JVFinder**, visibles par le destinataire connecté au même compte Steam. Aucun message Steam n’est envoyé automatiquement. Les amis sélectionnés ne sont pas ajoutés à une place avant d’avoir rejoint eux-mêmes le salon. La liste d’amis n’est accessible qu’à la personne connectée ; les préférences privées ne sont pas exposées aux autres membres.
