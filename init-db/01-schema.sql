-- MariaDB Schema for Valio Aimo Catalog & Autonomous Procurement Engine
CREATE DATABASE IF NOT EXISTS aimogate CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE aimogate;

CREATE TABLE IF NOT EXISTS valio_catalog_products (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  gtin VARCHAR(32) NOT NULL DEFAULT '',
  sales_unit VARCHAR(32) NOT NULL DEFAULT 'PCE',
  name_fi VARCHAR(512) NOT NULL DEFAULT '',
  name_en VARCHAR(512) NOT NULL DEFAULT '',
  name_sv VARCHAR(512) NOT NULL DEFAULT '',
  display_name VARCHAR(512) NOT NULL,
  vendor_name VARCHAR(256) NOT NULL DEFAULT 'Valio Aimo',
  brand VARCHAR(256) NOT NULL DEFAULT 'Valio',
  category VARCHAR(64) NOT NULL DEFAULT 'dairy',
  dietary_tags JSON,
  pack_format VARCHAR(128) NOT NULL DEFAULT 'PCE',
  pack_volume_litres DECIMAL(10,3) NOT NULL DEFAULT 1.000,
  temperature_condition INT NOT NULL DEFAULT 4,
  search_corpus TEXT,
  synkka_json LONGTEXT,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_category (category),
  INDEX idx_brand (brand),
  INDEX idx_gtin (gtin),
  INDEX idx_active (is_active),
  FULLTEXT INDEX idx_valio_catalog_fts (display_name, brand, name_fi, name_en, search_corpus)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS procurement_rag_audit (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL,
  prompt TEXT NOT NULL,
  retrieved_skus JSON NOT NULL,
  selected_sku VARCHAR(64) NOT NULL,
  quote_id VARCHAR(64),
  evaluation_verdict VARCHAR(32) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_tenant (tenant_id),
  INDEX idx_verdict (evaluation_verdict)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
