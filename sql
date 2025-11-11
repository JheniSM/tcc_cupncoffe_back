drop database coffe;
-- coffe_schema_mysql8.sql
-- MySQL 8 schema for: usuarios, produtos, pedidos, pedido_produto
-- Includes: DB creation, tables, indexes, FKs, view, and optional stock triggers.

-- 1) Database
CREATE DATABASE IF NOT EXISTS coffe
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_0900_ai_ci;
USE coffe;

-- 2) Table: usuarios
CREATE TABLE IF NOT EXISTS usuarios (
  id           VARCHAR(36)  NOT NULL,
  nome         VARCHAR(120) NOT NULL,
  email        VARCHAR(255) NOT NULL,
  senha_hash   VARCHAR(100) NOT NULL,
  reset_code VARCHAR(100) NULL,
  role         ENUM('ADMIN','USER') NOT NULL DEFAULT 'USER',
  ativo        TINYINT(1) NOT NULL DEFAULT 1,
  assinante    TINYINT(1) NOT NULL DEFAULT 0,
  cashbacktotal DECIMAL(10,2) NOT NULL DEFAULT 0,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_usuarios_email (email)
) ENGINE=InnoDB;

-- 3) Table: produtos
CREATE TABLE IF NOT EXISTS produtos (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  nome          VARCHAR(200) NOT NULL,
  descricao     TEXT NULL,
  preco         DECIMAL(10,2) NOT NULL,
  estoque       INT NOT NULL DEFAULT 0,
  ativo         TINYINT(1) NOT NULL DEFAULT 1,
  slug          VARCHAR(220) NULL,
  imagem VARCHAR(220) NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_produtos_slug (slug),
  INDEX ix_produtos_nome (nome),
  CONSTRAINT ck_produtos_preco_nonneg CHECK (preco >= 0),
  CONSTRAINT ck_produtos_estoque_nonneg CHECK (estoque >= 0)
) ENGINE=InnoDB;


CREATE TABLE IF NOT EXISTS pedidos (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  usuario_id     VARCHAR(36) NOT NULL,
  status         ENUM('CRIADO','PAGO','ENVIADO','CANCELADO','CONCLUIDO') NOT NULL DEFAULT 'CRIADO',
  obs            VARCHAR(500) NULL,
  endereco       VARCHAR(300) NULL,
  mensagem         VARCHAR(500) NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  descontoAssinatura DECIMAL(10,2) NOT NULL DEFAULT  0,
  descontoCashback DECIMAL(10,2) NOT NULL DEFAULT  0,
  total_bruto 	DECIMAL(10,2) NOT NULL,
  total_desconto DECIMAL(10,2) NOT NULL,
  total_final DECIMAL(10,2) NOT NULL,
  feedback DECIMAL(10,2) NULL,
  PRIMARY KEY (id),
  INDEX ix_pedidos_usuario_data (usuario_id, created_at),
  INDEX ix_pedidos_status (status),
  CONSTRAINT fk_pedidos_usuario
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT
) ENGINE=InnoDB;

-- 5) Table: pedido_produto (order items)
CREATE TABLE IF NOT EXISTS pedido_produto (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  pedido_id        BIGINT UNSIGNED NOT NULL,
  produto_id       BIGINT UNSIGNED NOT NULL,
  quantidade       INT NOT NULL,
  preco_unitario   DECIMAL(10,2) NOT NULL,      -- snapshot do preço na hora do pedido
  desconto         DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  subtotal         DECIMAL(12,2) AS ((quantidade * preco_unitario) - desconto) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY uk_pedido_item_unico (pedido_id, produto_id),
  INDEX ix_itens_pedido (pedido_id),
  INDEX ix_itens_produto (produto_id),
  CONSTRAINT fk_itens_pedido
    FOREIGN KEY (pedido_id) REFERENCES pedidos(id)
    ON UPDATE CASCADE
    ON DELETE CASCADE,
  CONSTRAINT fk_itens_produto
    FOREIGN KEY (produto_id) REFERENCES produtos(id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,
  CONSTRAINT ck_qtd_pos CHECK (quantidade > 0),
  CONSTRAINT ck_preco_unit_nonneg CHECK (preco_unitario >= 0),
  CONSTRAINT ck_desconto_nonneg CHECK (desconto >= 0)
) ENGINE=InnoDB;

-- 6) View: totais por pedido
DROP VIEW IF EXISTS vw_pedidos_totais;
CREATE VIEW vw_pedidos_totais AS
SELECT
  p.id,
  p.usuario_id,
  p.status,
  p.created_at,
  p.updated_at,
  COALESCE(SUM(i.subtotal), 0.00) AS total_itens,
  p.total_final
FROM pedidos p
LEFT JOIN pedido_produto i ON i.pedido_id = p.id
GROUP BY p.id, p.usuario_id, p.status, p.created_at, p.updated_at;

-- 7) Triggers para estoque (opcionais)
-- Drop if exists (MySQL 8 supports IF EXISTS)
DROP TRIGGER IF EXISTS trg_itens_ai_debita_estoque;
DROP TRIGGER IF EXISTS trg_itens_au_ajusta_estoque;
DROP TRIGGER IF EXISTS trg_itens_ad_devolve_estoque;

DELIMITER $$

CREATE TRIGGER trg_itens_ai_debita_estoque
AFTER INSERT ON pedido_produto
FOR EACH ROW
BEGIN
  UPDATE produtos
     SET estoque = estoque - NEW.quantidade
   WHERE id = NEW.produto_id;
END$$

CREATE TRIGGER trg_itens_au_ajusta_estoque
AFTER UPDATE ON pedido_produto
FOR EACH ROW
BEGIN
  UPDATE produtos
     SET estoque = estoque + OLD.quantidade - NEW.quantidade
   WHERE id = NEW.produto_id;
END$$

CREATE TRIGGER trg_itens_ad_devolve_estoque
AFTER DELETE ON pedido_produto
FOR EACH ROW
BEGIN
  UPDATE produtos
     SET estoque = estoque + OLD.quantidade
   WHERE id = OLD.produto_id;
END$$

DELIMITER ;

INSERT INTO usuarios (id, nome, email, senha_hash, role, ativo, assinante) VALUES (
  UUID(),                             -- gera o id
  'Admin',
  'admin@admin.com',
  '$2b$10$uVf2fs4wXW5DcphWLqikdO0Y95rI9NJI4T9/eypHNGzrvNiaFLdoK',-- hash da senha 'admin'
  'ADMIN',
  1,
  0
);

INSERT INTO usuarios (id, nome, email, senha_hash, role, ativo, assinante) VALUES (
  UUID(),                             -- gera o id
  'xxx',
  'xxx@xxx.com',
  '$2b$10$GpKlmSUk4HD2MSRvzmRW7.nKbev8ywG3NBfgSKK93RHql3G4OE4Va',-- hash da senha 'xxx'
  'USER',
  1,
  0
);

INSERT INTO produtos (
  nome,
  descricao,
  preco,
  estoque,
  ativo,
  slug,
  imagem
) VALUES (
  'Embalagem Econômica',
  'Opção adicional de embalagem sustentável e econômica, adicionada automaticamente conforme o número de itens do pedido.',
  1.00,
  999999,
  1,
  'embalagem-economica',
  'https://via.placeholder.com/150?text=Embalagem+Econômica'
);

INSERT INTO produtos (
  nome,
  descricao,
  preco,
  estoque,
  ativo,
  slug,
  imagem
) VALUES (
  'Mensagem Personalizada',
  'Mensagem Personalizada',
  5,
  99999,
  1,
  'Mensagem Personalizada',
  ''
);

INSERT INTO produtos (
  nome,
  descricao,
  preco,
  estoque,
  ativo,
  slug,
  imagem
) VALUES (
  'Assinatura',
  'Assinatura',
  100,
  99999,
  1,
  'Assinatura',
  'https://qapseg.com.br/wp-content/uploads/2023/06/botao-assine.png'
);


INSERT INTO produtos (
  nome,
  descricao,
  preco,
  estoque,
  ativo,
  slug,
  imagem
) VALUES (
  'Café Melita Tradicional',
  'Café Melita Tradicional',
  21.90,
  100,
  1,
  'Café Melita Tradicional',
  'https://m.media-amazon.com/images/I/61SjElhuQtL._AC_SX679_.jpg'
);



INSERT INTO produtos (
  nome,
  descricao,
  preco,
  estoque,
  ativo,
  slug,
  imagem
) VALUES (
  'Mini cup cake',
  'Mini cup cake',
  10,
  100,
  1,
  'Mini cup cake',
  'https://cdn.leroymerlin.com.br/products/forma_greasypel_mini_cup_cake_preta_n_02_45_unid_mago_1570077518_621d_600x600.jpg'
);


CREATE TABLE IF NOT EXISTS admin_logs (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  usuario_id    VARCHAR(36) NULL,
  action        VARCHAR(120) NOT NULL,   -- ex: "CREATE_PRODUCT", "UPDATE_ORDER"
  resource      VARCHAR(120) NULL,       -- ex: "produtos", "pedidos"
  resource_id   VARCHAR(255) NULL,       -- id do recurso afetado (quando aplicável)
  details       JSON NULL,               -- info extra como payload (opcional)
  ip            VARCHAR(45) NULL,
  user_agent    VARCHAR(255) NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX ix_admin_logs_usuario (usuario_id),
  INDEX ix_admin_logs_action (action),
  INDEX ix_admin_logs_resource (resource),
  INDEX ix_admin_logs_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

