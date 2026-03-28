-- ============================================
-- BASE DE DONNÉES : rattrapage_db
-- Système de paiement des frais de rattrapage
-- ============================================

CREATE DATABASE IF NOT EXISTS rattrapage_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE rattrapage_db;

-- ----------------------
-- TABLE : filieres
-- ----------------------
CREATE TABLE IF NOT EXISTS filieres (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(20) NOT NULL UNIQUE,
  nom VARCHAR(100) NOT NULL,
  niveau VARCHAR(50) DEFAULT 'Licence',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ----------------------
-- TABLE : matieres
-- ----------------------
CREATE TABLE IF NOT EXISTS matieres (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(20) NOT NULL UNIQUE,
  libelle VARCHAR(150) NOT NULL,
  credits INT DEFAULT 3,
  frais DECIMAL(10,2) NOT NULL DEFAULT 5000.00,
  filiere_id INT,
  semestre VARCHAR(10) DEFAULT 'S1',
  actif BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (filiere_id) REFERENCES filieres(id) ON DELETE SET NULL
);

-- ----------------------
-- TABLE : etudiants
-- ----------------------
CREATE TABLE IF NOT EXISTS etudiants (
  id INT AUTO_INCREMENT PRIMARY KEY,
  matricule VARCHAR(30) NOT NULL UNIQUE,
  nom VARCHAR(100) NOT NULL,
  prenom VARCHAR(100) NOT NULL,
  email VARCHAR(150) UNIQUE,
  telephone VARCHAR(20) NOT NULL,
  filiere_id INT,
  niveau VARCHAR(20) DEFAULT 'L1',
  password_hash VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (filiere_id) REFERENCES filieres(id) ON DELETE SET NULL
);

-- ----------------------
-- TABLE : utilisateurs (agents + admins)
-- ----------------------
CREATE TABLE IF NOT EXISTS utilisateurs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nom VARCHAR(100) NOT NULL,
  prenom VARCHAR(100) NOT NULL,
  email VARCHAR(150) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('agent', 'admin') DEFAULT 'agent',
  actif BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ----------------------
-- TABLE : paiements
-- ----------------------
CREATE TABLE IF NOT EXISTS paiements (
  id INT AUTO_INCREMENT PRIMARY KEY,
  reference VARCHAR(50) NOT NULL UNIQUE,
  etudiant_id INT NOT NULL,
  montant_total DECIMAL(10,2) NOT NULL,
  mode_paiement ENUM('orange_money', 'mtn_money', 'cash') NOT NULL,
  statut ENUM('en_attente', 'valide', 'echoue', 'annule') DEFAULT 'en_attente',
  numero_mobile VARCHAR(20),
  transaction_id VARCHAR(100),
  agent_id INT,
  remarque TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (etudiant_id) REFERENCES etudiants(id),
  FOREIGN KEY (agent_id) REFERENCES utilisateurs(id) ON DELETE SET NULL
);

-- ----------------------
-- TABLE : paiement_matieres (pivot)
-- ----------------------
CREATE TABLE IF NOT EXISTS paiement_matieres (
  id INT AUTO_INCREMENT PRIMARY KEY,
  paiement_id INT NOT NULL,
  matiere_id INT NOT NULL,
  frais DECIMAL(10,2) NOT NULL,
  FOREIGN KEY (paiement_id) REFERENCES paiements(id) ON DELETE CASCADE,
  FOREIGN KEY (matiere_id) REFERENCES matieres(id)
);

-- ----------------------
-- TABLE : recus
-- ----------------------
CREATE TABLE IF NOT EXISTS recus (
  id INT AUTO_INCREMENT PRIMARY KEY,
  numero_recu VARCHAR(50) NOT NULL UNIQUE,
  paiement_id INT NOT NULL,
  agent_id INT,
  libelle TEXT,
  date_emission TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  imprime BOOLEAN DEFAULT FALSE,
  FOREIGN KEY (paiement_id) REFERENCES paiements(id),
  FOREIGN KEY (agent_id) REFERENCES utilisateurs(id) ON DELETE SET NULL
);

-- ============================================
-- DONNÉES DE TEST (SEEDS)
-- ============================================

-- Filières
INSERT INTO filieres (code, nom, niveau) VALUES
  ('INFO-L1', 'Informatique', 'Licence 1'),
  ('INFO-L2', 'Informatique', 'Licence 2'),
  ('INFO-L3', 'Informatique', 'Licence 3'),
  ('GESTION-L1', 'Gestion des Entreprises', 'Licence 1'),
  ('GESTION-L2', 'Gestion des Entreprises', 'Licence 2'),
  ('DROIT-L1', 'Droit Privé', 'Licence 1'),
  ('MATH-L2', 'Mathématiques', 'Licence 2');

-- Matières
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
  ('MAT201', 'Analyse Numérique', 4, 6500.00, 7, 'S3');

-- Utilisateurs (admin + agent) — mot de passe: Admin123!
-- Hash bcrypt de "Admin123!" 
INSERT INTO utilisateurs (nom, prenom, email, password_hash, role) VALUES
  ('Mballa', 'Jean-Pierre', 'admin@univ.cm', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'admin'),
  ('Ngoumou', 'Marie', 'agent1@univ.cm', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'agent'),
  ('Biyong', 'Paul', 'agent2@univ.cm', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'agent');

-- Étudiants de test (mot de passe: Etud123!)
INSERT INTO etudiants (matricule, nom, prenom, email, telephone, filiere_id, niveau, password_hash) VALUES
  ('21G0001', 'Kamga', 'Léa', 'lea.kamga@etud.cm', '699000001', 1, 'L1', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi'),
  ('21G0002', 'Essomba', 'Marc', 'marc.essomba@etud.cm', '677000002', 2, 'L2', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi'),
  ('22G0010', 'Tchoupo', 'Arlette', 'arlette.t@etud.cm', '655000010', 4, 'L1', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi');