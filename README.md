# 🎓 PayRattrapage — Système de Paiement des Frais de Rattrapage

Plateforme complète de gestion des paiements de frais de rattrapage avec support Orange Money, MTN MoMo et Cash.

---

## 📁 Structure du projet

```
rattrapage-pay/
├── backend/
│   ├── server.js               ← Point d'entrée Express
│   ├── config/
│   │   └── db.js               ← Connexion MySQL
│   ├── middlewares/
│   │   └── auth.js             ← Middleware JWT + rôles
│   └── routes/
│       ├── auth.js             ← Connexion étudiant/staff
│       ├── paiements.js        ← Mobile Money + Cash
│       ├── recus.js            ← Génération PDF reçu
│       ├── catalogue.js        ← Filières + Matières
│       └── etudiants.js        ← CRUD étudiants
├── frontend/
│   ├── index.html              ← Page de connexion
│   ├── paiement.html           ← Espace étudiant (paiement)
│   ├── agent.html              ← Espace agent (cash + reçu)
│   ├── admin.html              ← Administration
│   ├── css/
│   │   └── styles.css          ← Styles globaux
│   └── js/
│       └── api.js              ← Utilitaires API / Auth
├── database/
│   └── schema.sql              ← Schéma + données de test
├── .env                        ← Variables d'environnement
└── package.json
```

---

## 🚀 Installation

### 1. Prérequis
- Node.js 18+
- MySQL 8.0+
- npm

### 2. Installer les dépendances
```bash
npm install
```

### 3. Configurer la base de données MySQL
```bash
mysql -u root -p < database/schema.sql
```

### 4. Configurer les variables d'environnement
Éditer le fichier `.env` :
```
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=votre_mot_de_passe
DB_NAME=rattrapage_db
JWT_SECRET=une_clé_secrète_forte
```

### 5. Lancer le serveur
```bash
# Production
npm start

# Développement (avec rechargement automatique)
npm run dev
```

Accéder à l'application : **http://localhost:3000**

---

## 👤 Comptes de test

### Étudiant
| Champ | Valeur |
|-------|--------|
| Matricule | `21G0001` |
| Téléphone | `699000001` |

### Agent financier
| Email | Mot de passe |
|-------|--------------|
| `agent1@univ.cm` | `password` |

### Administrateur
| Email | Mot de passe |
|-------|--------------|
| `admin@univ.cm` | `password` |

> ⚠️ **Note** : Les hash dans schema.sql sont des exemples. Pour la production, générer des vrais hash bcrypt.

---

## 🔌 API Endpoints

### Authentification
| Méthode | URL | Description |
|---------|-----|-------------|
| POST | `/api/auth/etudiant` | Connexion étudiant (matricule + téléphone) |
| POST | `/api/auth/staff` | Connexion agent/admin (email + password) |

### Paiements
| Méthode | URL | Description |
|---------|-----|-------------|
| POST | `/api/paiements/mobile` | Paiement Orange Money / MTN MoMo |
| POST | `/api/paiements/cash` | Paiement cash par agent |
| GET | `/api/paiements` | Liste des paiements (agent/admin) |
| GET | `/api/paiements/etudiant/:id` | Historique d'un étudiant |
| GET | `/api/paiements/stats` | Statistiques |

### Reçus
| Méthode | URL | Description |
|---------|-----|-------------|
| GET | `/api/recus/:numero` | Détail d'un reçu JSON |
| GET | `/api/recus/:numero/pdf` | Télécharger le reçu PDF |

### Catalogue
| Méthode | URL | Description |
|---------|-----|-------------|
| GET | `/api/filieres` | Liste des filières |
| POST | `/api/filieres` | Créer une filière (admin) |
| PUT | `/api/filieres/:id` | Modifier une filière (admin) |
| DELETE | `/api/filieres/:id` | Supprimer une filière (admin) |
| GET | `/api/matieres` | Liste des matières |
| POST | `/api/matieres` | Créer une matière (admin) |
| PUT | `/api/matieres/:id` | Modifier une matière (admin) |

### Étudiants
| Méthode | URL | Description |
|---------|-----|-------------|
| GET | `/api/etudiants` | Liste des étudiants |
| GET | `/api/etudiants/:id` | Détail étudiant |
| POST | `/api/etudiants` | Créer un étudiant (admin) |
| PUT | `/api/etudiants/:id` | Modifier un étudiant (admin) |

---

## 💳 Intégration Mobile Money (Production)

### Orange Money Cameroun
Remplacer la fonction `simulerPaiementMobileMoney()` dans `backend/routes/paiements.js` par l'appel réel :
```
API: https://api.orange.com/orange-money-webpay/cm/v1
Documentation: https://developer.orange.com
```

### MTN Mobile Money
```
API: https://sandbox.momodeveloper.mtn.com
Documentation: https://momodeveloper.mtn.com
```

---

## 🔒 Sécurité en production

- Changer `JWT_SECRET` par une clé forte aléatoire
- Activer HTTPS
- Hasher correctement les mots de passe avec bcrypt
- Configurer des limites de taux (rate limiting)
- Ajouter validation des entrées (express-validator)
