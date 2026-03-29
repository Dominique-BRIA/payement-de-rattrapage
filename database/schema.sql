-- ============================================
-- BASE DE DONNÉES PostgreSQL : rattrapage_db
-- ============================================

-- ----------------------
-- TABLE : filieres
-- ----------------------
CREATE TABLE IF NOT EXISTS filieres (
  id SERIAL PRIMARY KEY,
  code VARCHAR(20) NOT NULL UNIQUE,
  nom VARCHAR(100) NOT NULL,
  niveau VARCHAR(50) DEFAULT 'Licence',
  created_at TIMESTAMP DEFAULT NOW()
);

-- ----------------------
-- TABLE : matieres
-- ----------------------
CREATE TABLE IF NOT EXISTS matieres (
  id SERIAL PRIMARY KEY,
  code VARCHAR(20) NOT NULL UNIQUE,
  libelle VARCHAR(150) NOT NULL,
  credits INT DEFAULT 3,
  frais DECIMAL(10,2) NOT NULL DEFAULT 5000.00,
  filiere_id INT REFERENCES filieres(id) ON DELETE SET NULL,
  semestre VARCHAR(10) DEFAULT 'S1',
  actif BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ----------------------
-- TABLE : etudiants
-- ----------------------
CREATE TABLE IF NOT EXISTS etudiants (
  id SERIAL PRIMARY KEY,
  matricule VARCHAR(30) NOT NULL UNIQUE,
  nom VARCHAR(100) NOT NULL,
  prenom VARCHAR(100) NOT NULL,
  email VARCHAR(150) UNIQUE,
  telephone VARCHAR(20) NOT NULL,
  filiere_id INT REFERENCES filieres(id) ON DELETE SET NULL,
  niveau VARCHAR(20) DEFAULT 'L1',
  password_hash VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW()
);

-- ----------------------
-- TABLE : utilisateurs
-- ----------------------
CREATE TABLE IF NOT EXISTS utilisateurs (
  id SERIAL PRIMARY KEY,
  nom VARCHAR(100) NOT NULL,
  prenom VARCHAR(100) NOT NULL,
  email VARCHAR(150) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(10) DEFAULT 'agent' CHECK (role IN ('agent', 'admin')),
  actif BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ----------------------
-- TABLE : paiements
-- ----------------------
CREATE TABLE IF NOT EXISTS paiements (
  id SERIAL PRIMARY KEY,
  reference VARCHAR(50) NOT NULL UNIQUE,
  etudiant_id INT NOT NULL REFERENCES etudiants(id),
  montant_total DECIMAL(10,2) NOT NULL,
  mode_paiement VARCHAR(20) NOT NULL CHECK (mode_paiement IN ('orange_money','mtn_money','cash')),
  statut VARCHAR(20) DEFAULT 'en_attente' CHECK (statut IN ('en_attente','valide','echoue','annule')),
  numero_mobile VARCHAR(20),
  transaction_id VARCHAR(100),
  agent_id INT REFERENCES utilisateurs(id) ON DELETE SET NULL,
  remarque TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ----------------------
-- TABLE : paiement_matieres
-- ----------------------
CREATE TABLE IF NOT EXISTS paiement_matieres (
  id SERIAL PRIMARY KEY,
  paiement_id INT NOT NULL REFERENCES paiements(id) ON DELETE CASCADE,
  matiere_id INT NOT NULL REFERENCES matieres(id),
  frais DECIMAL(10,2) NOT NULL
);

-- ----------------------
-- TABLE : recus
-- ----------------------
CREATE TABLE IF NOT EXISTS recus (
  id SERIAL PRIMARY KEY,
  numero_recu VARCHAR(50) NOT NULL UNIQUE,
  paiement_id INT NOT NULL REFERENCES paiements(id),
  agent_id INT REFERENCES utilisateurs(id) ON DELETE SET NULL,
  libelle TEXT,
  date_emission TIMESTAMP DEFAULT NOW(),
  imprime BOOLEAN DEFAULT FALSE
);

-- ----------------------
-- TABLE : password_resets
-- ----------------------
CREATE TABLE IF NOT EXISTS password_resets (
  id SERIAL PRIMARY KEY,
  email VARCHAR(150) NOT NULL,
  token VARCHAR(255) NOT NULL UNIQUE,
  expires_at TIMESTAMP NOT NULL,
  used BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================
-- DONNÉES DE TEST
-- ============================================

INSERT INTO filieres (code, nom, niveau) VALUES
  ('INFO-L1', 'Informatique', 'Licence 1'),
  ('INFO-L2', 'Informatique', 'Licence 2'),
  ('INFO-L3', 'Informatique', 'Licence 3'),
  ('GESTION-L1', 'Gestion des Entreprises', 'Licence 1'),
  ('GESTION-L2', 'Gestion des Entreprises', 'Licence 2'),
  ('DROIT-L1', 'Droit Privé', 'Licence 1'),
  ('MATH-L2', 'Mathématiques', 'Licence 2')
ON CONFLICT (code) DO NOTHING;

INSERT INTO matieres (code, libelle, credits, frais, filiere_id, semestre) VALUES
  ('INF101', 'Algorithmique et Structures de Données', 4, 7500.00, 1, 'S1'),
  ('INF102', 'Programmation Orientée Objet (Java)', 4, 7500.00, 1, 'S1'),
  ('INF103', 'Bases de Données Relationnelles', 3, 6000.00, 1, 'S2'),
  ('INF104', 'Réseaux Informatiques', 3, 6000.00, 1, 'S2'),
  ('INF201', 'Développement Web Avancé', 4, 7500.00, 2, 'S3'),
  ('INF202', 'Systèmes d''Exploitation', 3, 6000.00, 2, 'S3'),
  ('GES101', 'Comptabilité Générale', 4, 6500.00, 4, 'S1'),
  ('GES102', 'Management des Organisations', 3, 5500.00, 4, 'S1'),
  ('GES201', 'Finance d''Entreprise', 4, 7000.00, 5, 'S3'),
  ('DRT101', 'Droit Civil', 4, 6000.00, 6, 'S1'),
  ('MAT201', 'Analyse Numérique', 4, 6500.00, 7, 'S3')
ON CONFLICT (code) DO NOTHING;

INSERT INTO utilisateurs (nom, prenom, email, password_hash, role) VALUES
  ('Mballa', 'Jean-Pierre', 'admin@univ.cm', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'admin'),
  ('Ngoumou', 'Marie', 'agent1@univ.cm', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'agent'),
  ('Biyong', 'Paul', 'agent2@univ.cm', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'agent')
ON CONFLICT (email) DO NOTHING;

INSERT INTO etudiants (matricule, nom, prenom, email, telephone, filiere_id, niveau, password_hash) VALUES
  ('21G0001', 'Kamga', 'Léa', 'lea.kamga@etud.cm', '699000001', 1, 'L1', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi'),
  ('21G0002', 'Essomba', 'Marc', 'marc.essomba@etud.cm', '677000002', 2, 'L2', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi'),
  ('22G0010', 'Tchoupo', 'Arlette', 'arlette.t@etud.cm', '655000010', 4, 'L1', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi')
ON CONFLICT (matricule) DO NOTHING;
