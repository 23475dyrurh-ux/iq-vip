// ==============================================================================
// IQ VIP Platform - Unified Database Engine
// Supports zero-dependency native SQLite (with full relational schema, WAL mode,
// foreign keys, and ACID transactions) matching PostgreSQL production tables.
// ==============================================================================

const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const { hashPassword } = require('../server/utils/security');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'iq_vip.db');

// Initialize database
let db = null;

function getDb() {
  if (!db) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    db = new DatabaseSync(DB_PATH);
    // Enable WAL mode for high concurrency & enable foreign keys
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA foreign_keys = ON;');
  }
  return db;
}

/**
 * Initialize all database tables matching the PostgreSQL architecture
 */
function initializeSchema() {
  const database = getDb();

  database.exec(`
    -- 1. System Settings
    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      description_ar TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- 1.1 Payment Methods Table (Dynamically Managed by Admin)
    CREATE TABLE IF NOT EXISTS payment_methods (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name_ar TEXT NOT NULL,
      type TEXT NOT NULL,
      instructions_ar TEXT,
      fee_pct REAL DEFAULT 2.0,
      min_amount REAL DEFAULT 20.0,
      max_amount REAL DEFAULT 50000.0,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- 2. VIP Levels
    CREATE TABLE IF NOT EXISTS vip_levels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      level_name TEXT NOT NULL UNIQUE,
      display_name_ar TEXT NOT NULL,
      badge_color TEXT DEFAULT '#D4AF37',
      min_deposit_or_balance REAL DEFAULT 0.00,
      daily_task_limit INTEGER NOT NULL DEFAULT 5,
      commission_rate REAL NOT NULL DEFAULT 0.0060,
      min_product_price REAL DEFAULT 10.00,
      max_product_price REAL DEFAULT 1000.00,
      withdrawal_fee_pct REAL DEFAULT 2.00,
      benefits_ar TEXT NOT NULL,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- 3. Users Table
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      phone TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'USER' CHECK(role IN ('USER', 'ADMIN', 'SUPER_ADMIN')),
      vip_level_id INTEGER NOT NULL DEFAULT 1 REFERENCES vip_levels(id),
      is_demo INTEGER DEFAULT 0,
      status TEXT DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE', 'SUSPENDED', 'PENDING')),
      referral_code TEXT UNIQUE,
      referred_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      reset_token TEXT,
      reset_expires TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- 4. Products Table
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title_ar TEXT NOT NULL,
      description_ar TEXT,
      price REAL NOT NULL,
      category_ar TEXT DEFAULT 'منتجات VIP الممتازة',
      image_url TEXT NOT NULL,
      rating REAL DEFAULT 4.9,
      min_vip_level INTEGER DEFAULT 1 REFERENCES vip_levels(id),
      is_available INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- 5. Wallets Table
    CREATE TABLE IF NOT EXISTS wallets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      available_balance REAL DEFAULT 0.0000,
      pending_balance REAL DEFAULT 0.0000,
      total_earned REAL DEFAULT 0.0000,
      total_withdrawn REAL DEFAULT 0.0000,
      currency TEXT DEFAULT 'USDT',
      is_locked INTEGER DEFAULT 0,
      version INTEGER DEFAULT 1,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- 6. Tasks Table
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id),
      task_code TEXT NOT NULL UNIQUE,
      vip_level_id INTEGER NOT NULL REFERENCES vip_levels(id),
      product_price REAL NOT NULL,
      commission_rate REAL NOT NULL,
      commission_amount REAL NOT NULL,
      status TEXT DEFAULT 'PENDING' CHECK(status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')),
      duration_seconds INTEGER DEFAULT 30,
      started_at TEXT,
      completed_at TEXT,
      client_token TEXT,
      is_demo INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- 7. Immutable Financial Ledger (Transactions)
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wallet_id INTEGER NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      amount REAL NOT NULL,
      balance_before REAL NOT NULL,
      balance_after REAL NOT NULL,
      status TEXT DEFAULT 'COMPLETED',
      reference_type TEXT,
      reference_id INTEGER,
      description_ar TEXT NOT NULL,
      is_demo INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- 8. Commissions Table
    CREATE TABLE IF NOT EXISTS commissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      task_id INTEGER NOT NULL UNIQUE REFERENCES tasks(id) ON DELETE CASCADE,
      amount REAL NOT NULL,
      settlement_status TEXT DEFAULT 'SETTLED',
      settlement_time TEXT DEFAULT (datetime('now')),
      is_demo INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- 9. Withdrawals Table
    CREATE TABLE IF NOT EXISTS withdrawals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      withdrawal_code TEXT NOT NULL UNIQUE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      wallet_id INTEGER NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
      amount REAL NOT NULL,
      fee_amount REAL NOT NULL,
      net_amount REAL NOT NULL,
      method TEXT NOT NULL,
      account_details TEXT NOT NULL,
      status TEXT DEFAULT 'PENDING' CHECK(status IN ('PENDING', 'APPROVED', 'REJECTED')),
      admin_notes TEXT,
      reviewed_by INTEGER REFERENCES users(id),
      reviewed_at TEXT,
      is_demo INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- 9.1 Deposits Table (إيداعات وشحن الرصيد)
    CREATE TABLE IF NOT EXISTS deposits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deposit_code TEXT NOT NULL UNIQUE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      wallet_id INTEGER NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
      amount REAL NOT NULL,
      method TEXT NOT NULL,
      payment_method_id INTEGER REFERENCES payment_methods(id),
      transaction_ref TEXT NOT NULL,
      receipt_image TEXT,
      status TEXT DEFAULT 'PENDING' CHECK(status IN ('PENDING', 'APPROVED', 'REJECTED')),
      admin_notes TEXT,
      reviewed_by INTEGER REFERENCES users(id),
      reviewed_at TEXT,
      is_demo INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- 10. Notifications Table
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title_ar TEXT NOT NULL,
      message_ar TEXT NOT NULL,
      type TEXT DEFAULT 'SYSTEM',
      is_read INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- 11. Administrator Audit Logs
    CREATE TABLE IF NOT EXISTS admin_audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_id INTEGER NOT NULL REFERENCES users(id),
      action TEXT NOT NULL,
      target_type TEXT,
      target_id INTEGER,
      old_values TEXT,
      new_values TEXT,
      ip_address TEXT,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- 12. Support Conversations (محادثات خدمة العملاء المباشرة)
    CREATE TABLE IF NOT EXISTS support_conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL UNIQUE,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      sender_name TEXT NOT NULL,
      sender_contact TEXT,
      subject TEXT DEFAULT 'استفسار ودعم فني',
      status TEXT DEFAULT 'OPEN' CHECK(status IN ('OPEN', 'RESOLVED', 'CLOSED')),
      unread_admin INTEGER DEFAULT 1,
      unread_user INTEGER DEFAULT 0,
      last_message_at TEXT DEFAULT (datetime('now')),
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- 13. Support Messages (رسائل المحادثة المباشرة)
    CREATE TABLE IF NOT EXISTS support_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL REFERENCES support_conversations(id) ON DELETE CASCADE,
      sender_type TEXT NOT NULL CHECK(sender_type IN ('USER', 'ADMIN')),
      sender_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      sender_name TEXT NOT NULL,
      message TEXT NOT NULL,
      is_read INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Performance Indexes
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
    CREATE INDEX IF NOT EXISTS idx_tasks_user_date ON tasks(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_code ON tasks(task_code);
    CREATE INDEX IF NOT EXISTS idx_transactions_user_wallet ON transactions(user_id, wallet_id);
    CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at);
    CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON withdrawals(status);
    CREATE INDEX IF NOT EXISTS idx_support_conv_session ON support_conversations(session_id);
    CREATE INDEX IF NOT EXISTS idx_support_conv_user ON support_conversations(user_id);
    CREATE INDEX IF NOT EXISTS idx_support_msg_conv ON support_messages(conversation_id);
  `);

  try {
    db.exec("ALTER TABLE tasks ADD COLUMN escrow_held INTEGER DEFAULT 0;");
  } catch (e) {}
  try {
    db.exec("ALTER TABLE tasks ADD COLUMN escrow_amount REAL DEFAULT 0.0;");
  } catch (e) {}
}

/**
 * Execute a query that returns multiple rows
 */
function query(sql, params = []) {
  const database = getDb();
  const stmt = database.prepare(sql);
  return stmt.all(...params);
}

/**
 * Execute a query that returns a single row
 */
function queryOne(sql, params = []) {
  const database = getDb();
  const stmt = database.prepare(sql);
  const rows = stmt.all(...params);
  return rows.length > 0 ? rows[0] : null;
}

/**
 * Execute an INSERT, UPDATE, or DELETE
 */
function execute(sql, params = []) {
  const database = getDb();
  const stmt = database.prepare(sql);
  const result = stmt.run(...params);
  return {
    lastInsertRowid: result.lastInsertRowid !== undefined ? Number(result.lastInsertRowid) : null,
    changes: result.changes !== undefined ? Number(result.changes) : 0,
  };
}

/**
 * Execute within a Database Transaction (with ACID guarantees)
 */
function transaction(callback) {
  const database = getDb();
  database.exec('BEGIN IMMEDIATE TRANSACTION;');
  try {
    const result = callback({
      query,
      queryOne,
      execute,
    });
    database.exec('COMMIT;');
    return result;
  } catch (error) {
    try {
      database.exec('ROLLBACK;');
    } catch (rbErr) {
      // rollback error ignored
    }
    throw error;
  }
}

module.exports = {
  getDb,
  initializeSchema,
  query,
  queryOne,
  execute,
  transaction,
};
