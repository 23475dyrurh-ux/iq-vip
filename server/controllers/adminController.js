// ==============================================================================
// IQ VIP Platform - Administrator Management Controller
// Comprehensive administrative controls, financial auditing, product catalog,
// user management, withdrawal processing, and system configuration.
// ==============================================================================

const { query, queryOne, execute, transaction } = require('../../database/db');
const { approveWithdrawal, rejectWithdrawal, approveDeposit, rejectDeposit, recordLedgerEntry } = require('../utils/ledger');
const { sendJson } = require('../middleware');

/**
 * Get comprehensive platform metrics & financial dashboard KPIs
 */
async function getAdminStats(req, res) {
  try {
    // 1. User stats
    const totalUsersRow = queryOne("SELECT count(*) as count FROM users WHERE role = 'USER'");
    const demoUsersRow = queryOne("SELECT count(*) as count FROM users WHERE is_demo = 1 AND role = 'USER'");
    const activeUsersRow = queryOne("SELECT count(*) as count FROM users WHERE status = 'ACTIVE' AND role = 'USER'");

    // 2. Financial totals
    const walletSums = queryOne(`
      SELECT 
        coalesce(sum(available_balance), 0) as total_available,
        coalesce(sum(pending_balance), 0) as total_pending,
        coalesce(sum(total_earned), 0) as total_commissions_paid,
        coalesce(sum(total_withdrawn), 0) as total_withdrawn_settled
      FROM wallets w
      JOIN users u ON w.user_id = u.id
      WHERE u.role = 'USER' AND u.is_demo = 0
    `);

    // Demo financial stats
    const demoWalletSums = queryOne(`
      SELECT 
        coalesce(sum(available_balance), 0) as total_available,
        coalesce(sum(total_earned), 0) as total_commissions_paid
      FROM wallets w
      JOIN users u ON w.user_id = u.id
      WHERE u.role = 'USER' AND u.is_demo = 1
    `);

    // 3. Task stats
    const totalTasksRow = queryOne('SELECT count(*) as count FROM tasks');
    const completedTasksRow = queryOne("SELECT count(*) as count FROM tasks WHERE status = 'COMPLETED'");
    const todayTasksRow = queryOne("SELECT count(*) as count FROM tasks WHERE status = 'COMPLETED' AND date(completed_at) = date('now')");

    // 4. Pending withdrawals
    const pendingWthRow = queryOne(`
      SELECT count(*) as count, coalesce(sum(amount), 0) as total_amount
      FROM withdrawals
      WHERE status = 'PENDING'
    `);

    // 5. VIP distribution
    const vipDistribution = query(`
      SELECT v.display_name_ar, count(u.id) as user_count
      FROM vip_levels v
      LEFT JOIN users u ON u.vip_level_id = v.id AND u.role = 'USER'
      GROUP BY v.id
      ORDER BY v.id ASC
    `);

    return sendJson(res, 200, {
      stats: {
        totalUsers: totalUsersRow ? Number(totalUsersRow.count) : 0,
        activeUsers: activeUsersRow ? Number(activeUsersRow.count) : 0,
        demoUsers: demoUsersRow ? Number(demoUsersRow.count) : 0,
        totalTasks: totalTasksRow ? Number(totalTasksRow.count) : 0,
        completedTasks: completedTasksRow ? Number(completedTasksRow.count) : 0,
        todayTasks: todayTasksRow ? Number(todayTasksRow.count) : 0,
        pendingWithdrawalsCount: pendingWthRow ? Number(pendingWthRow.count) : 0,
        pendingWithdrawalsAmount: pendingWthRow ? Number(pendingWthRow.total_amount) : 0,
        financials: {
          realAvailableBalance: walletSums ? Number(walletSums.total_available) : 0,
          realPendingLiability: walletSums ? Number(walletSums.total_pending) : 0,
          realCommissionsPaid: walletSums ? Number(walletSums.total_commissions_paid) : 0,
          realTotalWithdrawn: walletSums ? Number(walletSums.total_withdrawn_settled) : 0,
          demoVirtualBalance: demoWalletSums ? Number(demoWalletSums.total_available) : 0,
          demoCommissionsPaid: demoWalletSums ? Number(demoWalletSums.total_commissions_paid) : 0
        },
        vipDistribution
      }
    });
  } catch (err) {
    console.error('getAdminStats error:', err);
    return sendJson(res, 500, { error: 'حدث خطأ أثناء إحصاء بيانات لوحة التحكم' });
  }
}

/**
 * Manage Users: list, search, filter, status toggling, VIP updating
 */
async function getUsersList(req, res, queryParams) {
  try {
    const search = queryParams.search ? `%${queryParams.search.toLowerCase()}%` : null;
    const filterVip = queryParams.vip ? parseInt(queryParams.vip, 10) : null;
    const filterDemo = queryParams.demo !== undefined ? (queryParams.demo === 'true' ? 1 : 0) : null;

    let sql = `
      SELECT u.id, u.full_name, u.email, u.phone, u.role, u.vip_level_id, u.is_demo, u.status, u.referral_code, u.created_at,
             v.display_name_ar as vip_title,
             w.available_balance, w.pending_balance, w.total_earned
      FROM users u
      LEFT JOIN vip_levels v ON u.vip_level_id = v.id
      LEFT JOIN wallets w ON w.user_id = u.id
      WHERE 1=1
    `;
    const params = [];

    if (search) {
      sql += ' AND (lower(u.full_name) LIKE ? OR lower(u.email) LIKE ? OR u.phone LIKE ?)';
      params.push(search, search, search);
    }
    if (filterVip) {
      sql += ' AND u.vip_level_id = ?';
      params.push(filterVip);
    }
    if (filterDemo !== null) {
      sql += ' AND u.is_demo = ?';
      params.push(filterDemo);
    }

    sql += ' ORDER BY u.id DESC LIMIT 100';

    const users = query(sql, params);

    return sendJson(res, 200, {
      users: users.map(u => ({
        id: u.id,
        fullName: u.full_name,
        email: u.email,
        phone: u.phone,
        role: u.role,
        vipLevelId: u.vip_level_id,
        vipTitle: u.vip_title,
        isDemo: Boolean(u.is_demo),
        status: u.status,
        referralCode: u.referral_code,
        availableBalance: Number(u.available_balance || 0),
        pendingBalance: Number(u.pending_balance || 0),
        totalEarned: Number(u.total_earned || 0),
        createdAt: u.created_at
      }))
    });
  } catch (err) {
    console.error('getUsersList error:', err);
    return sendJson(res, 500, { error: 'حدث خطأ أثناء جلب قائمة المستخدمين' });
  }
}

/**
 * Update user status or VIP tier
 */
async function updateUser(req, res, body) {
  try {
    const adminId = req.user.id;
    const { userId, status, vipLevelId, isDemo, adjustBalance, reason } = body;

    if (!userId) {
      return sendJson(res, 400, { error: 'معرف المستخدم مطلوب' });
    }

    const targetUser = queryOne('SELECT * FROM users WHERE id = ?', [userId]);
    if (!targetUser) {
      return sendJson(res, 404, { error: 'المستخدم غير موجود' });
    }

    const updates = [];
    const params = [];
    const oldValues = [];
    const newValues = [];

    if (status && ['ACTIVE', 'SUSPENDED'].includes(status)) {
      updates.push('status = ?');
      params.push(status);
      oldValues.push(`status=${targetUser.status}`);
      newValues.push(`status=${status}`);
    }

    if (vipLevelId) {
      updates.push('vip_level_id = ?');
      params.push(vipLevelId);
      oldValues.push(`vip=${targetUser.vip_level_id}`);
      newValues.push(`vip=${vipLevelId}`);
    }

    if (isDemo !== undefined) {
      updates.push('is_demo = ?');
      params.push(isDemo ? 1 : 0);
      oldValues.push(`demo=${targetUser.is_demo}`);
      newValues.push(`demo=${isDemo ? 1 : 0}`);
    }

    if (updates.length > 0) {
      params.push(userId);
      execute(`UPDATE users SET ${updates.join(', ')}, updated_at = datetime('now') WHERE id = ?`, params);
    }

    // Optional Balance Adjustment
    if (adjustBalance !== undefined && Number(adjustBalance) !== 0) {
      const adjNum = Number(adjustBalance);
      transaction((tx) => {
        const wallet = tx.queryOne('SELECT id, available_balance FROM wallets WHERE user_id = ?', [userId]);
        if (wallet) {
          recordLedgerEntry(tx, {
            walletId: wallet.id,
            userId,
            type: 'ADMIN_ADJUSTMENT',
            amount: adjNum,
            status: 'COMPLETED',
            referenceType: 'ADMIN_ACTION',
            referenceId: adminId,
            descriptionAr: `تعديل رصيد إداري يدوي: ${adjNum > 0 ? '+' : ''}${adjNum} USDT (${reason || 'تعديل إداري'})`,
            isDemo: targetUser.is_demo
          });
        }
      });
      newValues.push(`balance_adj=${adjNum}`);
    }

    // Record admin audit log
    execute(`
      INSERT INTO admin_audit_logs (admin_id, action, target_type, target_id, old_values, new_values, ip_address, notes)
      VALUES (?, 'UPDATE_USER', 'user', ?, ?, ?, '127.0.0.1', ?)
    `, [adminId, userId, oldValues.join(', '), newValues.join(', '), reason || 'تحديث بيانات المستخدم']);

    return sendJson(res, 200, { message: 'تم تحديث بيانات المستخدم بنجاح' });
  } catch (err) {
    console.error('updateUser error:', err);
    return sendJson(res, 500, { error: err.message || 'حدث خطأ أثناء تحديث بيانات المستخدم' });
  }
}

/**
 * Manage Products Catalog: List, Add, Edit, Delete
 */
async function getProducts(req, res) {
  try {
    const products = query(`
      SELECT p.*, v.display_name_ar as vip_title
      FROM products p
      LEFT JOIN vip_levels v ON p.min_vip_level = v.id
      ORDER BY p.id DESC
    `);

    return sendJson(res, 200, {
      products: products.map(p => ({
        id: p.id,
        title: p.title_ar,
        description: p.description_ar,
        price: Number(p.price),
        category: p.category_ar,
        image: p.image_url,
        rating: Number(p.rating),
        minVipLevel: p.min_vip_level,
        vipTitle: p.vip_title,
        isAvailable: Boolean(p.is_available),
        createdAt: p.created_at
      }))
    });
  } catch (err) {
    console.error('getProducts error:', err);
    return sendJson(res, 500, { error: 'حدث خطأ أثناء جلب المنتجات' });
  }
}

async function addProduct(req, res, body) {
  try {
    const adminId = req.user.id;
    const { title, description, price, category, image, rating, minVipLevel } = body;

    if (!title || !price || !image) {
      return sendJson(res, 400, { error: 'اسم المنتج، السعر، ورابط الصورة حقول إجبارية' });
    }

    const resDb = execute(`
      INSERT INTO products (title_ar, description_ar, price, category_ar, image_url, rating, min_vip_level, is_available)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1)
    `, [title.trim(), description || '', Number(price), category || 'منتجات VIP', image.trim(), Number(rating) || 4.9, Number(minVipLevel) || 1]);

    const newId = resDb.lastInsertRowid;

    execute(`
      INSERT INTO admin_audit_logs (admin_id, action, target_type, target_id, new_values, ip_address, notes)
      VALUES (?, 'ADD_PRODUCT', 'product', ?, ?, '127.0.0.1', 'إضافة منتج جديد لمهام المنصة')
    `, [adminId, newId, JSON.stringify({ title, price, minVipLevel })]);

    return sendJson(res, 201, { message: 'تمت إضافة المنتج بنجاح إلى منصة المهام', productId: newId });
  } catch (err) {
    console.error('addProduct error:', err);
    return sendJson(res, 500, { error: 'حدث خطأ أثناء إضافة المنتج' });
  }
}

async function updateProduct(req, res, body) {
  try {
    const adminId = req.user.id;
    const { id, title, description, price, category, image, rating, minVipLevel, isAvailable } = body;

    if (!id) {
      return sendJson(res, 400, { error: 'معرف المنتج مطلوب' });
    }

    const current = queryOne('SELECT * FROM products WHERE id = ?', [id]);
    if (!current) {
      return sendJson(res, 404, { error: 'المنتج غير موجود' });
    }

    execute(`
      UPDATE products
      SET title_ar = ?,
          description_ar = ?,
          price = ?,
          category_ar = ?,
          image_url = ?,
          rating = ?,
          min_vip_level = ?,
          is_available = ?
      WHERE id = ?
    `, [
      title || current.title_ar,
      description !== undefined ? description : current.description_ar,
      price !== undefined ? Number(price) : current.price,
      category || current.category_ar,
      image || current.image_url,
      rating !== undefined ? Number(rating) : current.rating,
      minVipLevel !== undefined ? Number(minVipLevel) : current.min_vip_level,
      isAvailable !== undefined ? (isAvailable ? 1 : 0) : current.is_available,
      id
    ]);

    execute(`
      INSERT INTO admin_audit_logs (admin_id, action, target_type, target_id, old_values, new_values, ip_address, notes)
      VALUES (?, 'UPDATE_PRODUCT', 'product', ?, ?, ?, '127.0.0.1', 'تحديث بيانات المنتج')
    `, [adminId, id, JSON.stringify(current), JSON.stringify(body)]);

    return sendJson(res, 200, { message: 'تم تحديث بيانات المنتج بنجاح' });
  } catch (err) {
    console.error('updateProduct error:', err);
    return sendJson(res, 500, { error: 'حدث خطأ أثناء تحديث المنتج' });
  }
}

async function deleteProduct(req, res, body) {
  try {
    const adminId = req.user.id;
    const { id } = body;

    if (!id) {
      return sendJson(res, 400, { error: 'معرف المنتج مطلوب' });
    }

    execute('UPDATE products SET is_available = 0 WHERE id = ?', [id]);

    execute(`
      INSERT INTO admin_audit_logs (admin_id, action, target_type, target_id, ip_address, notes)
      VALUES (?, 'DEACTIVATE_PRODUCT', 'product', ?, '127.0.0.1', 'إلغاء تفعيل وتوفر المنتج')
    `, [adminId, id]);

    return sendJson(res, 200, { message: 'تم إلغاء تفعيل المنتج بنجاح' });
  } catch (err) {
    console.error('deleteProduct error:', err);
    return sendJson(res, 500, { error: 'حدث خطأ أثناء حذف أو إيقاف المنتج' });
  }
}

/**
 * Manage Withdrawal Requests: List, Approve, Reject
 */
async function getWithdrawals(req, res, queryParams) {
  try {
    const filterStatus = queryParams.status || null;
    let sql = `
      SELECT w.*, u.full_name, u.email, u.phone, u.vip_level_id, v.display_name_ar as vip_title
      FROM withdrawals w
      JOIN users u ON w.user_id = u.id
      LEFT JOIN vip_levels v ON u.vip_level_id = v.id
      WHERE 1=1
    `;
    const params = [];

    if (filterStatus) {
      sql += ' AND w.status = ?';
      params.push(filterStatus);
    }

    sql += ' ORDER BY w.id DESC LIMIT 100';

    const withdrawals = query(sql, params);

    return sendJson(res, 200, {
      withdrawals: withdrawals.map(w => ({
        id: w.id,
        code: w.withdrawal_code,
        userId: w.user_id,
        userName: w.full_name,
        userEmail: w.email,
        userPhone: w.phone,
        vipTitle: w.vip_title,
        amount: Number(w.amount),
        feeAmount: Number(w.fee_amount),
        netAmount: Number(w.net_amount),
        method: w.method,
        accountDetails: w.account_details,
        status: w.status,
        adminNotes: w.admin_notes,
        isDemo: Boolean(w.is_demo),
        createdAt: w.created_at,
        reviewedAt: w.reviewed_at
      }))
    });
  } catch (err) {
    console.error('getWithdrawals error:', err);
    return sendJson(res, 500, { error: 'حدث خطأ أثناء جلب طلبات السحب' });
  }
}

async function handleApproveWithdrawal(req, res, body) {
  try {
    const adminId = req.user.id;
    const { withdrawalId } = body;

    if (!withdrawalId) {
      return sendJson(res, 400, { error: 'معرف طلب السحب مطلوب' });
    }

    const result = approveWithdrawal({
      adminId,
      withdrawalId: Number(withdrawalId),
      ipAddress: req.socket.remoteAddress || '127.0.0.1'
    });

    return sendJson(res, 200, {
      message: `تم اعتماد والموافقة على طلب السحب (${result.withdrawalCode}) بنجاح وتم تسجيل القيد في السجل المالي.`,
      result
    });
  } catch (err) {
    console.error('handleApproveWithdrawal error:', err);
    return sendJson(res, 400, { error: err.message || 'فشلت معالجة الموافقة على السحب' });
  }
}

async function handleRejectWithdrawal(req, res, body) {
  try {
    const adminId = req.user.id;
    const { withdrawalId, reason } = body;

    if (!withdrawalId) {
      return sendJson(res, 400, { error: 'معرف طلب السحب مطلوب' });
    }

    const result = rejectWithdrawal({
      adminId,
      withdrawalId: Number(withdrawalId),
      reasonAr: reason,
      ipAddress: req.socket.remoteAddress || '127.0.0.1'
    });

    return sendJson(res, 200, {
      message: `تم رفض طلب السحب (${result.withdrawalCode}) وإعادة المبلغ كاملاً إلى الرصيد المتاح للمستخدم مع إرسال إشعار.`,
      result
    });
  } catch (err) {
    console.error('handleRejectWithdrawal error:', err);
    return sendJson(res, 400, { error: err.message || 'فشل رفض طلب السحب' });
  }
}

/**
 * Manage VIP Levels & Commission Rules
 */
async function updateVipLevel(req, res, body) {
  try {
    const adminId = req.user.id;
    const { id, dailyTaskLimit, commissionRate, minBalance, feePct, benefits } = body;

    if (!id) {
      return sendJson(res, 400, { error: 'معرف مستوى VIP مطلوب' });
    }

    const current = queryOne('SELECT * FROM vip_levels WHERE id = ?', [id]);
    if (!current) {
      return sendJson(res, 404, { error: 'مستوى VIP غير موجود' });
    }

    execute(`
      UPDATE vip_levels
      SET daily_task_limit = ?,
          commission_rate = ?,
          min_deposit_or_balance = ?,
          withdrawal_fee_pct = ?,
          benefits_ar = ?
      WHERE id = ?
    `, [
      dailyTaskLimit !== undefined ? Number(dailyTaskLimit) : current.daily_task_limit,
      commissionRate !== undefined ? Number(commissionRate) : current.commission_rate,
      minBalance !== undefined ? Number(minBalance) : current.min_deposit_or_balance,
      feePct !== undefined ? Number(feePct) : current.withdrawal_fee_pct,
      benefits || current.benefits_ar,
      id
    ]);

    execute(`
      INSERT INTO admin_audit_logs (admin_id, action, target_type, target_id, old_values, new_values, ip_address, notes)
      VALUES (?, 'UPDATE_VIP_LEVEL', 'vip_level', ?, ?, ?, '127.0.0.1', 'تحديث شروط وعمولات مستوى VIP')
    `, [adminId, id, JSON.stringify(current), JSON.stringify(body)]);

    return sendJson(res, 200, { message: 'تم تحديث إعدادات مستوى VIP بنجاح' });
  } catch (err) {
    console.error('updateVipLevel error:', err);
    return sendJson(res, 500, { error: 'حدث خطأ أثناء تعديل مستوى VIP' });
  }
}

/**
 * Platform System Settings
 */
async function getSettings(req, res) {
  try {
    const settings = query('SELECT * FROM system_settings');
    const settingsObj = {};
    settings.forEach(s => { settingsObj[s.key] = s.value; });
    return sendJson(res, 200, { settings: settingsObj });
  } catch (err) {
    return sendJson(res, 500, { error: 'حدث خطأ أثناء جلب إعدادات النظام' });
  }
}

async function updateSettings(req, res, body) {
  try {
    const adminId = req.user.id;
    const { settings } = body;

    if (!settings || typeof settings !== 'object') {
      return sendJson(res, 400, { error: 'بيانات الإعدادات غير صالحة' });
    }

    for (const [k, v] of Object.entries(settings)) {
      execute(`
        INSERT INTO system_settings (key, value, updated_at)
        VALUES (?, ?, datetime('now'))
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
      `, [k, String(v)]);
    }

    execute(`
      INSERT INTO admin_audit_logs (admin_id, action, target_type, new_values, ip_address, notes)
      VALUES (?, 'UPDATE_SYSTEM_SETTINGS', 'system_settings', ?, '127.0.0.1', 'تعديل إعدادات المنصة العامة')
    `, [adminId, JSON.stringify(settings)]);

    return sendJson(res, 200, { message: 'تم حفظ وتطبيق إعدادات المنصة بنجاح' });
  } catch (err) {
    console.error('updateSettings error:', err);
    return sendJson(res, 500, { error: 'حدث خطأ أثناء حفظ الإعدادات' });
  }
}

/**
 * Audit Logs & All Transactions (Financial Ledger View)
 */
async function getAuditLogs(req, res) {
  try {
    const logs = query(`
      SELECT l.*, u.full_name as admin_name, u.email as admin_email
      FROM admin_audit_logs l
      JOIN users u ON l.admin_id = u.id
      ORDER BY l.id DESC
      LIMIT 100
    `);

    return sendJson(res, 200, { logs });
  } catch (err) {
    return sendJson(res, 500, { error: 'حدث خطأ أثناء جلب سجل العمليات الإدارية' });
  }
}

async function getAllLedgerTransactions(req, res) {
  try {
    const transactions = query(`
      SELECT t.*, u.full_name, u.email, u.phone
      FROM transactions t
      JOIN users u ON t.user_id = u.id
      ORDER BY t.id DESC
      LIMIT 100
    `);

    return sendJson(res, 200, { transactions });
  } catch (err) {
    return sendJson(res, 500, { error: 'حدث خطأ أثناء جلب السجل المالي العام' });
  }
}

/**
 * Manage Payment Methods (Admin CRUD)
 */
async function getAdminPaymentMethods(req, res) {
  try {
    const methods = query('SELECT * FROM payment_methods ORDER BY id ASC');
    return sendJson(res, 200, { methods });
  } catch (err) {
    console.error('getAdminPaymentMethods error:', err);
    return sendJson(res, 500, { error: 'حدث خطأ أثناء جلب طرق الدفع' });
  }
}

async function addPaymentMethod(req, res, body) {
  try {
    const adminId = req.user.id;
    const { code, name, type, instructions, feePct, minAmount, maxAmount } = body;

    if (!code || !name) {
      return sendJson(res, 400, { error: 'رمز طريقة الدفع والاسم باللغة العربية مطلوبان' });
    }

    const cleanCode = code.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    const existing = queryOne('SELECT id FROM payment_methods WHERE code = ?', [cleanCode]);
    if (existing) {
      return sendJson(res, 400, { error: 'رمز طريقة الدفع موجود مسبقاً' });
    }

    const resDb = execute(`
      INSERT INTO payment_methods (code, name_ar, type, instructions_ar, fee_pct, min_amount, max_amount, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1)
    `, [
      cleanCode,
      name.trim(),
      type || 'E_WALLET',
      instructions || '',
      feePct !== undefined ? Number(feePct) : 2.0,
      minAmount !== undefined ? Number(minAmount) : 20.0,
      maxAmount !== undefined ? Number(maxAmount) : 50000.0
    ]);

    execute(`
      INSERT INTO admin_audit_logs (admin_id, action, target_type, target_id, new_values, ip_address, notes)
      VALUES (?, 'ADD_PAYMENT_METHOD', 'payment_method', ?, ?, '127.0.0.1', 'إضافة طريقة دفع / سحب جديدة')
    `, [adminId, resDb.lastInsertRowid, JSON.stringify(body)]);

    return sendJson(res, 201, { message: 'تمت إضافة طريقة الدفع بنجاح', id: resDb.lastInsertRowid });
  } catch (err) {
    console.error('addPaymentMethod error:', err);
    return sendJson(res, 500, { error: 'حدث خطأ أثناء إضافة طريقة الدفع' });
  }
}

async function updatePaymentMethod(req, res, body) {
  try {
    const adminId = req.user.id;
    const { id, name, type, instructions, feePct, minAmount, maxAmount, isActive } = body;

    if (!id) {
      return sendJson(res, 400, { error: 'معرف طريقة الدفع مطلوب' });
    }

    const current = queryOne('SELECT * FROM payment_methods WHERE id = ?', [id]);
    if (!current) {
      return sendJson(res, 404, { error: 'طريقة الدفع غير موجودة' });
    }

    execute(`
      UPDATE payment_methods
      SET name_ar = ?,
          type = ?,
          instructions_ar = ?,
          fee_pct = ?,
          min_amount = ?,
          max_amount = ?,
          is_active = ?
      WHERE id = ?
    `, [
      name || current.name_ar,
      type || current.type,
      instructions !== undefined ? instructions : current.instructions_ar,
      feePct !== undefined ? Number(feePct) : current.fee_pct,
      minAmount !== undefined ? Number(minAmount) : current.min_amount,
      maxAmount !== undefined ? Number(maxAmount) : current.max_amount,
      isActive !== undefined ? (isActive ? 1 : 0) : current.is_active,
      id
    ]);

    execute(`
      INSERT INTO admin_audit_logs (admin_id, action, target_type, target_id, old_values, new_values, ip_address, notes)
      VALUES (?, 'UPDATE_PAYMENT_METHOD', 'payment_method', ?, ?, ?, '127.0.0.1', 'تحديث إعدادات طريقة الدفع')
    `, [adminId, id, JSON.stringify(current), JSON.stringify(body)]);

    return sendJson(res, 200, { message: 'تم تحديث طريقة الدفع بنجاح' });
  } catch (err) {
    console.error('updatePaymentMethod error:', err);
    return sendJson(res, 500, { error: 'حدث خطأ أثناء تحديث طريقة الدفع' });
  }
}

async function togglePaymentMethod(req, res, body) {
  try {
    const adminId = req.user.id;
    const { id } = body;

    if (!id) {
      return sendJson(res, 400, { error: 'معرف طريقة الدفع مطلوب' });
    }

    const current = queryOne('SELECT * FROM payment_methods WHERE id = ?', [id]);
    if (!current) {
      return sendJson(res, 404, { error: 'طريقة الدفع غير موجودة' });
    }

    const newStatus = current.is_active ? 0 : 1;
    execute('UPDATE payment_methods SET is_active = ? WHERE id = ?', [newStatus, id]);

    execute(`
      INSERT INTO admin_audit_logs (admin_id, action, target_type, target_id, new_values, ip_address, notes)
      VALUES (?, 'TOGGLE_PAYMENT_METHOD', 'payment_method', ?, ?, '127.0.0.1', 'تغيير حالة تفعيل طريقة الدفع')
    `, [adminId, id, `is_active=${newStatus}`]);

    return sendJson(res, 200, { 
      message: `تم ${newStatus ? 'تفعيل' : 'تعطيل'} طريقة الدفع بنجاح`,
      isActive: Boolean(newStatus)
    });
  } catch (err) {
    console.error('togglePaymentMethod error:', err);
    return sendJson(res, 500, { error: 'حدث خطأ أثناء تغيير حالة طريقة الدفع' });
  }
}

/**
 * Manage Deposit Requests (Admin View & Processing)
 */
async function getDeposits(req, res, queryParams = {}) {
  try {
    const filterStatus = queryParams.status || null;
    let sql = `
      SELECT d.*, u.full_name, u.email, u.phone, u.vip_level_id, v.display_name_ar as vip_title
      FROM deposits d
      JOIN users u ON d.user_id = u.id
      LEFT JOIN vip_levels v ON u.vip_level_id = v.id
      WHERE 1=1
    `;
    const params = [];

    if (filterStatus) {
      sql += ' AND d.status = ?';
      params.push(filterStatus);
    }

    sql += ' ORDER BY d.id DESC LIMIT 100';

    const deposits = query(sql, params);

    return sendJson(res, 200, {
      deposits: deposits.map(d => ({
        id: d.id,
        code: d.deposit_code,
        userId: d.user_id,
        userName: d.full_name,
        userEmail: d.email,
        userPhone: d.phone,
        vipTitle: d.vip_title,
        amount: Number(d.amount),
        method: d.method,
        transactionRef: d.transaction_ref,
        status: d.status,
        adminNotes: d.admin_notes,
        isDemo: Boolean(d.is_demo),
        createdAt: d.created_at,
        reviewedAt: d.reviewed_at
      }))
    });
  } catch (err) {
    console.error('getDeposits error:', err);
    return sendJson(res, 500, { error: 'حدث خطأ أثناء جلب طلبات الإيداع' });
  }
}

async function handleApproveDeposit(req, res, body) {
  try {
    const adminId = req.user.id;
    const { depositId } = body;

    if (!depositId) {
      return sendJson(res, 400, { error: 'معرف طلب الإيداع مطلوب' });
    }

    const result = approveDeposit({
      adminId,
      depositId: Number(depositId),
      ipAddress: req.socket.remoteAddress || '127.0.0.1'
    });

    return sendJson(res, 200, {
      message: `تم اعتماد وتأكيد طلب الإيداع (${result.depositCode}) وإضافة المبلغ إلى محفظة المستخدم بنجاح.`,
      result
    });
  } catch (err) {
    console.error('handleApproveDeposit error:', err);
    return sendJson(res, 400, { error: err.message || 'فشلت معالجة اعتماد الإيداع' });
  }
}

async function handleRejectDeposit(req, res, body) {
  try {
    const adminId = req.user.id;
    const { depositId, reason } = body;

    if (!depositId) {
      return sendJson(res, 400, { error: 'معرف طلب الإيداع مطلوب' });
    }

    const result = rejectDeposit({
      adminId,
      depositId: Number(depositId),
      reasonAr: reason,
      ipAddress: req.socket.remoteAddress || '127.0.0.1'
    });

    return sendJson(res, 200, {
      message: `تم رفض طلب الإيداع (${result.depositCode}) وتسجيل السبب وإشعار المستخدم.`,
      result
    });
  } catch (err) {
    console.error('handleRejectDeposit error:', err);
    return sendJson(res, 400, { error: err.message || 'فشل رفض طلب الإيداع' });
  }
}

module.exports = {
  getAdminStats,
  getUsersList,
  updateUser,
  getProducts,
  addProduct,
  updateProduct,
  deleteProduct,
  getWithdrawals,
  handleApproveWithdrawal,
  handleRejectWithdrawal,
  getDeposits,
  handleApproveDeposit,
  handleRejectDeposit,
  updateVipLevel,
  getSettings,
  updateSettings,
  getAuditLogs,
  getAllLedgerTransactions,
  getAdminPaymentMethods,
  addPaymentMethod,
  updatePaymentMethod,
  togglePaymentMethod,
};
