# Éditeur de CV

Application web centrée sur les offres d'emploi : collez l'URL ou le texte d'une offre, l'analyse propose un nouveau CV dont les tirets sont réordonnés du plus pertinent au moins pertinent, le survol du CV montre les modifications par rapport au CV de base, et le résultat s'enregistre comme CV sauvegardé — sans jamais toucher au CV de base.

## Deux onglets

### « Nouveau CV » — créer un CV pour une offre

1. **Collez l'offre** en haut de page : soit l'**URL** de la page (elle est récupérée automatiquement), soit directement le **texte** de l'offre.
2. **Analysez** : chaque tiret de vos expériences est comparé aux mots-clés de l'offre. Le CV affiché en dessous devient le **nouveau CV proposé**, avec les tirets du plus pertinent au moins pertinent. Le CV de base n'est **jamais modifié** : la proposition n'est qu'un ordre alternatif, posé par-dessus.
3. **Survolez le CV** pour voir les modifications : chaque tiret déplacé est surligné et porte un badge « ↑ était n°X » indiquant sa position dans le CV de base. Le panneau résume les déplacements par expérience. Vous pouvez encore affiner à la main (glisser-déposer, flèches) : cela modifie la proposition, pas le CV de base.
4. **Enregistrez ce nouveau CV** (nom proposé d'après le site de l'offre ou la date) : il rejoint les CV sauvegardés de l'onglet « CV de base ». « Ignorer la proposition » ou « Effacer » l'abandonne — le CV de base n'a jamais bougé.

### « CV de base » — le CV de référence et les CV sauvegardés

Le CV de base s'édite ici (textes, tirets, sections, photo, liens…) ; c'est lui qui sert de matrice à chaque nouvelle analyse. À côté, la liste des **CV sauvegardés** : ceux enregistrés depuis l'onglet « Nouveau CV » et ceux que vous sauvegardez manuellement. Chacun peut être chargé (il devient le CV de base), écrasé, renommé ou supprimé.

## Utilisation

Deux façons de lancer l'application :

- **Recommandé — avec le backend PDF** (nécessite Node.js et un navigateur Chromium installé, ex. Google Chrome) :

  ```
  node server.js
  ```

  puis ouvrez <http://localhost:3333>. Le bouton « Télécharger PDF » produit alors un PDF **strictement identique au rendu écran** (voir plus bas). Aucune dépendance npm à installer.

- **Sans installation** : ouvrez simplement `index.html` dans un navigateur (double-clic suffit). Tout fonctionne, y compris le téléchargement PDF, qui bascule alors sur le générateur intégré (léger écart de coupures de ligne possible).

> Les données sont sauvegardées par le navigateur **par origine** : si vous passez de `index.html` (file://) à `http://localhost:3333`, utilisez « Exporter JSON » puis « Importer JSON » pour transférer votre CV.

## Fonctionnalités

- **Édition directe** : cliquez sur n'importe quel texte du CV (nom, titre, expériences, formation, projets, compétences) pour le modifier.
- **Deux modèles** commutables dans la barre d'outils :
  - **Pro** : mise en page classique une colonne ;
  - **Design** : barre latérale colorée contenant la photo, le nom, le contact (email, téléphone, adresse), les liens et les compétences ; colonne principale (titre, résumé, expériences, formation, projets) en mise en page resserrée pour tenir sur une seule page A4.
- **Couleur du bandeau** (modèle Design) : choisissez la teinte de la barre latérale dans la barre d'outils, parmi six couleurs sobres ou librement avec le sélecteur. Le texte de la barre passe automatiquement en sombre si la couleur choisie est claire, pour rester lisible. La couleur est conservée d'une visite à l'autre, incluse dans l'export JSON et dans les versions nommées, et reprise à l'identique dans le PDF.
- **Taille des textes** : section « Taille des textes » de l'onglet « CV de base », sous les CV sauvegardés. Chaque type de texte a son propre réglage — un curseur pour ajuster à vue, un champ chiffré pour une valeur précise (les deux se suivent), de 6 à 40 px par pas de 0,5 (nom, titre, résumé, titres de section, postes et diplômes, entreprise et détail, points, contact et liens, compétences). Le modèle Design règle séparément le **bandeau de gauche** et la **colonne principale de droite**. Chaque modèle garde ses propres tailles, conservées d'une visite à l'autre, incluses dans l'export JSON et dans les CV sauvegardés, et reprises à l'identique dans le PDF. « Tailles par défaut » rétablit celles du modèle affiché.
- **Photo de profil** : cliquez sur « + Photo » pour importer une image (recadrée en carré et réduite automatiquement) ; modifiable ou supprimable au survol.
- **Liens externes cliquables** : portfolio, GitHub, LinkedIn… Chaque ligne affiche un **texte libre** (« Portfolio », « Mon LinkedIn »…) qui est un **vrai lien hypertexte** : l'adresse se règle à part avec le bouton 🔗 et n'encombre pas le CV. Le lien reste cliquable **dans le PDF exporté** (les deux moteurs posent l'annotation), donc un recruteur ouvre la page en un clic. Ajout et suppression libres, affichage dans l'en-tête (Pro) ou la barre latérale (Design).
- **Contact sans intitulé** : les champs de contact n'affichent que leur valeur (un email, un numéro ou une ville se reconnaissent d'eux-mêmes) ; ajout et suppression libres.
- **Compétences détaillées et intérêts** (encadré du modèle Design, bas de page du modèle Pro) : sous le texte libre des compétences, ajoutez autant de **groupes** que nécessaire (intitulé en gras — « Langues », « Outils »… — suivi d'un détail sur plusieurs lignes, Entrée pour aller à la ligne), puis une section **Intérêts** dont chaque entrée s'ajoute et se supprime librement. Le tout suit la taille « Compétences », voyage dans l'export JSON et les CV sauvegardés, et se retrouve à l'identique dans le PDF.
- **CV sauvegardés** : chaque CV enregistré capture l'état complet (contenu, ordre des tirets, modèle, photo, offre analysée) sous un nom ; rechargez, écrasez, renommez ou supprimez chacun depuis l'onglet « CV de base ».
- **Tirets d'expérience** :
  - réorganisation par glisser-déposer (poignée `⠿`) ou avec les flèches ↑ / ↓ ;
  - ajout via « + Ajouter un tiret » ou en appuyant sur Entrée dans un tiret ;
  - suppression via le bouton ✕.
- **Expériences, formation et projets** : ajout, suppression et réorganisation des expériences ; ajout/suppression des lignes de formation et de projets (« + Ajouter une ligne », « + Ajouter un projet », bouton ✕).
- **Analyse de l'offre** : URL ou texte, au choix.
  - **URL** : la page est récupérée de préférence par le backend (`node server.js`, route `/fetch-job`, non soumise au CORS), sinon par un fetch direct (rarement autorisé par les sites). Le texte de l'offre est extrait des données structurées JSON-LD « JobPosting » que publient la plupart des sites d'emploi, sinon du texte visible de la page.
  - **Scores** : chaque tiret reçoit un score de pertinence (mots-clés et expressions communs avec l'offre, accents ignorés, mots vides filtrés) ; à score égal, l'ordre du CV de base est conservé.
  - **Proposition** : l'ordre suggéré n'est qu'une surcouche affichée dans l'onglet « Nouveau CV », conservée d'une visite à l'autre ; le CV de base garde son ordre. Les badges de diff n'existent que sur le CV survolé : ils n'apparaissent ni à l'impression ni dans le PDF (backend comme secours, qui reprennent l'ordre affiché).
- **Sauvegarde automatique** dans le navigateur (localStorage) : vos modifications sont conservées d'une visite à l'autre.
- **Export / import JSON** pour sauvegarder ou transférer votre CV.
- **Téléchargement PDF vectoriel (« à la Canva »)** : le bouton « Télécharger PDF » produit un PDF dont chaque texte est un vrai texte vectoriel — net à tous les niveaux de zoom, sélectionnable et copiable —, jamais une capture d'écran. Le document reste **lisible par les ATS** : titres de section explicites (Expériences professionnelles, Formation, Projets, Compétences) et contenu principal placé avant la barre latérale dans l'ordre de lecture du fichier. Deux moteurs :
  - **Backend (recommandé)** : `server.js` fait imprimer la feuille par Chrome headless — le PDF est mis en page par le **même moteur que l'écran**, donc mêmes polices, mêmes retours à la ligne, mêmes pages : correspondance exacte. Le front l'utilise automatiquement dès que le serveur répond.
  - **Secours intégré** : sans backend, `pdf.js` construit le PDF en pur JavaScript (polices Helvetica, encodage WinAnsi, photo ronde, liens cliquables, pagination A4). Fidèle, mais les coupures de ligne peuvent différer légèrement de l'écran, les métriques de police n'étant pas identiques.
- **Format A4 et impression fidèle** : la feuille affichée dans l'app fait exactement 210 × 297 mm pour les deux modèles ; le bouton « Imprimer » (`@page` A4 sans marges navigateur) reste disponible et reproduit à l'identique le rendu écran.

## Structure

- `index.html` — structure de la page (feuille CV + panneau offre/versions) ;
- `styles.css` — styles écran et impression, dont les badges de diff de la proposition ;
- `app.js` — état, rendu, édition, drag & drop, récupération et extraction de l'offre (URL ou texte), proposition de nouveau CV et diff avec le CV de base (JavaScript pur, sans dépendance) ;
- `pdf.js` — générateur de PDF vectoriel de secours : métriques Helvetica, encodage WinAnsi, mise en page avec pagination et assemblage du fichier PDF octet par octet ;
- `server.js` — backend optionnel (Node pur, sans dépendance npm) : sert l'application, imprime la feuille CV en PDF via Chrome headless pour un rendu identique à l'écran, et rapatrie le HTML d'une offre d'emploi (`POST /fetch-job`, Node ≥ 18).
