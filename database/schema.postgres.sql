-- ==============================================================================
-- IQ VIP Task Platform - PostgreSQL Production Schema
-- Description: Complete schema with foreign keys, indexes, and audit logs.
-- ==============================================================================

-- Drop tables if re-initializing (in dependency order)
DROP TABLE IF EXISTS admin_audit_logs CASCADE;
DROP TABLE IF EXISTS notifications CASCADE;
DROP TABLE IF EXISTS commissions CASCADE;
DROP TABLE IF EXISTS transactions CASCADE;
DROP TABLE IF EXISTS withdrawals CASCADE;
DROP TABLE IF EXISTS tasks CASCADE;
DROP TABLE IF EXISTS wallets CASCADE;
DROP TABLE IF EXISTS products CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS vip_levels CASCADE;
DROP TABLE IF EXISTS system_settings CASCADE;

-- 1. System Settings Table
CREATE TABLE system_settings (
    key VARCHAR(50) PRIMARY KEY,
    value TEXT NOT NULL,
    description_ar TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 1.1 Payment Methods Table (Dynamically Configured by Admin)
CREATE TABLE payment_methods (
    id SERIAL PRIMARY KEY,
    code VARCHAR(50) NOT NULL UNIQUE,
    name_ar VARCHAR(100) NOT NULL,
    type VARCHAR(50) NOT NULL,
    instructions_ar TEXT,
    fee_pct NUMERIC(4, 2) DEFAULT 2.00,
    min_amount NUMERIC(10, 2) DEFAULT 20.00,
    max_amount NUMERIC(12, 2) DEFAULT 50000.00,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. VIP Membership Levels
CREATE TABLE vip_levels (
    id SERIAL PRIMARY KEY,
    level_name VARCHAR(50) NOT NULL UNIQUE,
    display_name_ar VARCHAR(100) NOT NULL,
    badge_color VARCHAR(30) DEFAULT '#D4AF37',
    min_deposit_or_balance NUMERIC(12, 2) DEFAULT 0.00,
    daily_task_limit INT NOT NULL DEFAULT 5,
    commission_rate NUMERIC(5, 4) NOT NULL DEFAULT 0.0060, -- e.g. 0.0060 = 0.6%
    min_product_price NUMERIC(10, 2) DEFAULT 10.00,
    max_product_price NUMERIC(10, 2) DEFAULT 1000.00,
    withdrawal_fee_pct NUMERIC(4, 2) DEFAULT 2.00,
    benefits_ar TEXT NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Users Table
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    full_name VARCHAR(120) NOT NULL,
    email VARCHAR(150) NOT NULL UNIQUE,
    phone VARCHAR(40) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) DEFAULT 'USER' CHECK (role IN ('USER', 'ADMIN', 'SUPER_ADMIN')),
    vip_level_id INT NOT NULL DEFAULT 1 REFERENCES vip_levels(id),
    is_demo BOOLEAN DEFAULT FALSE,
    status VARCHAR(20) DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED', 'PENDING')),
    referral_code VARCHAR(30) UNIQUE,
    referred_by INT REFERENCES users(id) ON DELETE SET NULL,
    reset_token VARCHAR(100),
    reset_expires TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 4. Products Table
CREATE TABLE products (
    id SERIAL PRIMARY KEY,
    title_ar VARCHAR(255) NOT NULL,
    description_ar TEXT,
    price NUMERIC(10, 2) NOT NULL,
    category_ar VARCHAR(60) DEFAULT 'منتجات VIP الممتازة',
    image_url TEXT NOT NULL,
    rating NUMERIC(2, 1) DEFAULT 4.9,
    min_vip_level INT DEFAULT 1 REFERENCES vip_levels(id),
    is_available BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 5. Wallets Table
CREATE TABLE wallets (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    available_balance NUMERIC(14, 4) DEFAULT 0.0000 CHECK (available_balance >= 0),
    pending_balance NUMERIC(14, 4) DEFAULT 0.0000 CHECK (pending_balance >= 0),
    total_earned NUMERIC(14, 4) DEFAULT 0.0000,
    total_withdrawn NUMERIC(14, 4) DEFAULT 0.0000,
    currency VARCHAR(10) DEFAULT 'USDT',
    is_locked BOOLEAN DEFAULT FALSE,
    version INT DEFAULT 1,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 6. Tasks Table
CREATE TABLE tasks (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    product_id INT NOT NULL REFERENCES products(id),
    task_code VARCHAR(40) NOT NULL UNIQUE,
    vip_level_id INT NOT NULL REFERENCES vip_levels(id),
    product_price NUMERIC(10, 2) NOT NULL,
    commission_rate NUMERIC(5, 4) NOT NULL,
    commission_amount NUMERIC(12, 4) NOT NULL,
    status VARCHAR(20) DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')),
    duration_seconds INT DEFAULT 30,
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    client_token VARCHAR(100),
    is_demo BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 7. Immutable Financial Ledger (Transactions Table)
CREATE TABLE transactions (
    id SERIAL PRIMARY KEY,
    wallet_id INT NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(40) NOT NULL CHECK (type IN (
        'COMMISSION', 'WITHDRAWAL_REQUEST', 'WITHDRAWAL_APPROVED',
        'WITHDRAWAL_REJECTED', 'DEMO_CREDIT', 'SETTLEMENT_RELEASE', 'ADMIN_ADJUSTMENT'
    )),
    amount NUMERIC(14, 4) NOT NULL,
    balance_before NUMERIC(14, 4) NOT NULL,
    balance_after NUMERIC(14, 4) NOT NULL,
    status VARCHAR(20) DEFAULT 'COMPLETED' CHECK (status IN ('COMPLETED', 'PENDING', 'CANCELLED', 'REJECTED')),
    reference_type VARCHAR(40),
    reference_id INT,
    description_ar TEXT NOT NULL,
    is_demo BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 8. Commissions Table
CREATE TABLE commissions (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    task_id INT NOT NULL UNIQUE REFERENCES tasks(id) ON DELETE CASCADE,
    amount NUMERIC(12, 4) NOT NULL,
    settlement_status VARCHAR(20) DEFAULT 'SETTLED' CHECK (settlement_status IN ('SETTLED', 'PENDING')),
    settlement_time TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    is_demo BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 9. Withdrawals Table
CREATE TABLE withdrawals (
    id SERIAL PRIMARY KEY,
    withdrawal_code VARCHAR(40) NOT NULL UNIQUE,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    wallet_id INT NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
    amount NUMERIC(12, 4) NOT NULL,
    fee_amount NUMERIC(12, 4) NOT NULL,
    net_amount NUMERIC(12, 4) NOT NULL,
    method VARCHAR(40) NOT NULL CHECK (method IN ('USDT_TRC20', 'ZAIN_CASH', 'QI_CARD', 'BANK_TRANSFER')),
    account_details TEXT NOT NULL,
    status VARCHAR(20) DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
    admin_notes TEXT,
    reviewed_by INT REFERENCES users(id),
    reviewed_at TIMESTAMP WITH TIME ZONE,
    is_demo BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 9.1 Deposits Table (طلبات شحن وإيداع الرصيد)
CREATE TABLE deposits (
    id SERIAL PRIMARY KEY,
    deposit_code VARCHAR(40) NOT NULL UNIQUE,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    wallet_id INT NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
    amount NUMERIC(12, 4) NOT NULL,
    method VARCHAR(100) NOT NULL,
    payment_method_id INT REFERENCES payment_methods(id),
    transaction_ref VARCHAR(100) NOT NULL,
    receipt_image TEXT,
    status VARCHAR(20) DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
    admin_notes TEXT,
    reviewed_by INT REFERENCES users(id),
    reviewed_at TIMESTAMP WITH TIME ZONE,
    is_demo BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 10. Notifications Table
CREATE TABLE notifications (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title_ar VARCHAR(150) NOT NULL,
    message_ar TEXT NOT NULL,
    type VARCHAR(40) DEFAULT 'SYSTEM',
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 11. Administrator Audit Logs
CREATE TABLE admin_audit_logs (
    id SERIAL PRIMARY KEY,
    admin_id INT NOT NULL REFERENCES users(id),
    action VARCHAR(100) NOT NULL,
    target_type VARCHAR(50),
    target_id INT,
    old_values TEXT,
    new_values TEXT,
    ip_address VARCHAR(45),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Performance Indexes
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_phone ON users(phone);
CREATE INDEX idx_tasks_user_date ON tasks(user_id, created_at);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_code ON tasks(task_code);
CREATE INDEX idx_transactions_user_wallet ON transactions(user_id, wallet_id);
CREATE INDEX idx_transactions_created_at ON transactions(created_at);
CREATE INDEX idx_withdrawals_status ON withdrawals(status);
CREATE INDEX idx_withdrawals_user ON withdrawals(user_id);
CREATE INDEX idx_audit_created ON admin_audit_logs(created_at);
