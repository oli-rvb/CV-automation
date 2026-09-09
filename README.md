# Éditeur de CV

Application web centrée sur les offres d'emploi : donnez une offre — son texte ou son adresse —, cliquez sur « Générer le CV », et l'app enchaîne toute seule jusqu'à un CV prêt à exporter : expériences pertinentes retenues, tirets réordonnés, lignes recalibrées sur l'offre, CV nommé et enregistré. Le CV de base n'est jamais modifié ; vous n'intervenez qu'ensuite, si vous le souhaitez.

## Deux onglets

### « Nouveau CV » — créer un CV pour une offre

1. **Donnez l'offre** dans le champ unique en haut de page : son **texte** collé, ou seulement son **adresse** (elle est alors récupérée par `server.js`, le navigateur ne pouvant pas le faire lui-même).
2. **Cliquez sur « Générer le CV »**. L'app enchaîne sans étape intermédiaire : elle mesure la pertinence de chaque expérience, **écarte** celles qui ne correspondent pas (deux au minimum sont toujours gardées), **réordonne** les tirets du plus pertinent au moins pertinent, **nomme** le CV d'après l'offre (« intitulé du poste · entreprise ») et l'**enregistre** dans les CV sauvegardés. Le CV de base n'est **jamais modifié** : tout cela n'est qu'une surcouche posée par-dessus.
3. **Recalibrez les lignes** — le seul geste éventuel. Le prompt est déjà dans votre presse-papiers : collez-le dans votre IA, puis collez sa réponse dans le champ prévu. Elle s'applique **au collage**, sans rien valider. Si `server.js` tourne avec une clé `ANTHROPIC_API_KEY`, même ce geste disparaît : les lignes sont recalibrées pendant la génération.
4. **Relisez et corrigez** si vous le voulez : texte des lignes, ordre, expériences écartées, nom du CV. Chaque retouche rejoint le CV enregistré sans nouvelle sauvegarde. Le panneau « Ce que l'app a décidé seule » détaille le tri : score de chaque expérience, mots de l'offre captés, retenue ou écartée.
5. **Exportez** avec « Télécharger PDF ». « Repartir du CV de base » abandonne la génération — le CV enregistré, lui, reste dans la liste.

### « CV de base » — le CV de référence et les CV sauvegardés

Le CV de base s'édite ici (textes, tirets, sections, photo, liens…) ; c'est lui qui sert de matrice à chaque nouvelle analyse. À côté, la liste des **CV sauvegardés** : ceux enregistrés depuis l'onglet « Nouveau CV » et ceux que vous sauvegardez manuellement. Chacun peut être chargé (il devient le CV de base), écrasé, renommé ou supprimé.

## Utilisation

Deux façons de lancer l'application :

- **Recommandé — avec le backend PDF** (nécessite Node.js et un navigateur Chromium installé, ex. Google Chrome) :

  ```
  node server.js
  ```

  puis ouvrez <http://localhost:3333>. Le bouton « Télécharger PDF » produit alors un PDF **strictement identique au rendu écran** (voir plus bas), et le champ « Offre d'emploi » accepte une adresse en plus d'un texte collé. Aucune dépendance npm à installer.

  Pour que le recalibrage des lignes se fasse aussi tout seul, lancez le serveur avec une clé d'API dans son environnement :

  ```
  ANTHROPIC_API_KEY=sk-ant-... node server.js
  ```

  Sans cette variable, tout fonctionne à l'identique : seul le recalibrage repasse par le copier-coller.

- **Sans installation** : ouvrez simplement `index.html` dans un navigateur (double-clic suffit). Tout fonctionne hors ligne — police comprise, elle est embarquée dans le projet —, le téléchargement PDF basculant alors sur le générateur intégré (léger écart de coupures de ligne possible).

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
- **Génération du CV à partir de l'offre** : une entrée, un bouton, un CV prêt.
  - **Entrée unique** : le texte de l'offre, ou son adresse. Une adresse passe par `POST /fetch-job` (garde-fous anti-SSRF) ; le texte en est extrait côté client, depuis les données structurées `JobPosting` de la page quand elles existent. Sans backend, l'adresse n'est pas récupérable : le message invite à coller le texte.
  - **Scores** : chaque tiret reçoit un score de pertinence (mots-clés et expressions communs avec l'offre, accents ignorés, mots vides filtrés) ; à score égal, l'ordre du CV de base est conservé. Une expérience est notée sur ses tirets **et** son intitulé de poste, compté une fois et demie.
  - **Sélection** : les expériences pesant moins de 30 % de la meilleure sont écartées, avec un plancher de deux expériences conservées. L'ordre des expériences reste anti-chronologique — c'est ce qu'attend un lecteur de CV ; la pertinence ne joue qu'à l'intérieur de chacune.
  - **Recalibrage des lignes** : le prompt est copié tout seul, la réponse de votre IA s'applique au collage. Il demande une phrase par ligne, un verbe d'action au passé, des chiffres partout où la ligne d'origine en a, dans la **langue de l'offre** — et interdit d'inventer un chiffre, un outil ou un fait. Les identifiants inconnus dans la réponse sont ignorés.
  - **Automatisation lisible** : « Ce que l'app a décidé seule » montre, expérience par expérience, le score, les mots captés, retenue ou écartée, les tirets déplacés et les lignes recalibrées.
  - **Surcouche, jamais mutation** : ordre, textes et sélection ne vivent que dans la proposition, affichée dans l'onglet « Nouveau CV » et conservée d'une visite à l'autre ; le CV de base garde son contenu et son ordre. Les badges de diff n'existent que sur le CV survolé : ils n'apparaissent ni à l'impression ni dans le PDF (backend comme secours, qui reprennent l'ordre affiché).
  - **Recalibrage automatique (optionnel)** : si `server.js` est lancé avec `ANTHROPIC_API_KEY` dans son environnement, `POST /rewrite` relaie le prompt à l'API Anthropic et les lignes sont recalibrées pendant la génération, sans aucun aller-retour. La clé ne vient que de l'environnement, jamais du dépôt ni du client ; sans elle, l'app revient au copier-coller sans afficher la moindre erreur. `ANTHROPIC_MODEL` permet de changer de modèle (`claude-opus-5` par défaut).
- **Sauvegarde automatique** dans le navigateur (localStorage) : vos modifications sont conservées d'une visite à l'autre.
- **Export / import JSON** pour sauvegarder ou transférer votre CV.
- **Téléchargement PDF vectoriel (« à la Canva »)** : le bouton « Télécharger PDF » produit un PDF dont chaque texte est un vrai texte vectoriel — net à tous les niveaux de zoom, sélectionnable et copiable —, jamais une capture d'écran. Le document reste **lisible par les ATS** : titres de section explicites (Expériences professionnelles, Formation, Projets, Compétences) et contenu principal placé avant la barre latérale dans l'ordre de lecture du fichier. Deux moteurs :
  - **Backend (recommandé)** : `server.js` fait imprimer la feuille par Chrome headless — le PDF est mis en page par le **même moteur que l'écran**, donc mêmes polices, mêmes retours à la ligne, mêmes pages : correspondance exacte. Open Sans y est embarquée avec ses tables `ToUnicode`, ce qui rend l'extraction de texte fiable pour les ATS. Le front l'utilise automatiquement dès que le serveur répond.
  - **Secours intégré** : sans backend, `pdf.js` construit le PDF en pur JavaScript (polices Helvetica, encodage WinAnsi, photo ronde, liens cliquables, pagination A4). Fidèle, mais les coupures de ligne peuvent différer légèrement de l'écran, les métriques de police n'étant pas identiques.
- **Une seule page pour le modèle Design** : sa feuille est fixée à 297 mm (et non simplement « au moins 297 mm »), sinon quelques millimètres de contenu en trop suffisent à ouvrir une deuxième page à l'impression comme dans le PDF. Ce qui dépasse est coupé, et un avis au-dessus du CV indique de combien — la coupure n'est jamais silencieuse. Le modèle Pro, lui, peut s'étendre sur plusieurs pages.
- **Police identique partout** : Open Sans est embarquée dans le projet (`fonts.css`, data-URI), donc le CV s'affiche et s'imprime de la même façon sur toutes les machines, hors ligne et sans CDN.
- **Format A4 et impression fidèle** : la feuille affichée dans l'app fait exactement 210 × 297 mm pour les deux modèles ; le bouton « Imprimer » (`@page` A4 sans marges navigateur) reste disponible et reproduit à l'identique le rendu écran.

## Structure

- `index.html` — structure de la page (feuille CV + panneau offre/versions) ;
- `fonts.css` — Open Sans (fichier variable, sous-ensemble latin, licence Apache 2.0) embarqué en data-URI : la même police à l'écran, à l'impression et dans le PDF, sans CDN et sans installation ;
- `styles.css` — styles écran et impression, dont les badges de diff de la proposition ;
- `app.js` — état, rendu, édition, drag & drop, analyse de l'offre, chaîne de génération du CV (sélection, recalibrage, nommage, enregistrement) et diff avec le CV de base (JavaScript pur, sans dépendance) ;
- `pdf.js` — générateur de PDF vectoriel de secours : métriques Helvetica, encodage WinAnsi, mise en page avec pagination et assemblage du fichier PDF octet par octet ;
- `server.js` — backend (Node pur, sans dépendance npm) : sert l'application, imprime la feuille CV via Chrome headless — PDF identique au rendu écran, Open Sans embarquée, texte extractible par les ATS —, récupère une offre depuis son adresse (`/fetch-job`) et, si `ANTHROPIC_API_KEY` est définie, relaie le recalibrage des lignes à l'API Anthropic (`/rewrite`).
