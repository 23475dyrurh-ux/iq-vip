// ==============================================================================
// IQ VIP Platform - Wallet & Financial Ledger Controller
// Features: Task completion precondition enforcement, dynamic payment methods,
// full transaction history with filtering, and dynamic currency display.
// ==============================================================================

const { query, queryOne, transaction } = require('../../database/db');
const { createWithdrawalRequest, createDepositRequest } = require('../utils/ledger');
const { sendJson } = require('../middleware');

/**
 * Get active payment methods for deposit/withdrawal
 */
async function getPaymentMethods(req, res) {
  try {
    const methods = query(`
      SELECT id, code, name_ar, type, instructions_ar, fee_pct, min_amount, max_amount
      FROM payment_methods
      WHERE is_active = 1
      ORDER BY id ASC
    `);

    const currencySetting = queryOne("SELECT value FROM system_settings WHERE key = 'platform_currency'");
    const currency = currencySetting ? currencySetting.value : 'USDT';

    return sendJson(res, 200, {
      currency,
      methods: methods.map(m => ({
        id: m.id,
        code: m.code,
        name: m.name_ar,
        type: m.type,
        instructions: m.instructions_ar,
        feePercentage: Number(m.fee_pct),
        minAmount: Number(m.min_amount),
        maxAmount: Number(m.max_amount)
      }))
    });
  } catch (err) {
    console.error('getPaymentMethods error:', err);
    return sendJson(res, 500, { error: 'حدث خطأ أثناء تحميل طرق الدفع' });
  }
}

/**
 * Get user wallet overview, withdrawal conditions, and daily task completion status
 */
async function getWalletOverview(req, res) {
  try {
    const userId = req.user.id;

    // 1. Fetch wallet
    const wallet = queryOne('SELECT * FROM wallets WHERE user_id = ?', [userId]);
    if (!wallet) {
      return sendJson(res, 404, { error: 'المحفظة غير موجودة' });
    }

    // 2. Platform Currency & Settings
    const currencySetting = queryOne("SELECT value FROM system_settings WHERE key = 'platform_currency'");
    const currency = currencySetting ? currencySetting.value : 'USDT';

    const minSetting = queryOne("SELECT value FROM system_settings WHERE key = 'min_withdrawal_amount'");
    const feeSetting = queryOne("SELECT value FROM system_settings WHERE key = 'withdrawal_fee_pct'");

    // 3. User VIP details
    const userVip = queryOne(`
      SELECT u.vip_level_id, v.withdrawal_fee_pct, v.display_name_ar, v.daily_task_limit, v.min_deposit_or_balance
      FROM users u
      LEFT JOIN vip_levels v ON u.vip_level_id = v.id
      WHERE u.id = ?
    `, [userId]);

    const feePct = userVip && userVip.withdrawal_fee_pct !== undefined
      ? Number(userVip.withdrawal_fee_pct)
      : (feeSetting ? Number(feeSetting.value) : 2.0);

    const minAmount = minSetting ? Number(minSetting.value) : 20.00;

    // 4. Daily tasks completion status (Mandatory withdrawal condition)
    const todayTasksRow = queryOne(`
      SELECT count(*) as count 
      FROM tasks 
      WHERE user_id = ? AND status = 'COMPLETED' AND date(completed_at) = date('now')
    `, [userId]);

    const completedToday = todayTasksRow ? Number(todayTasksRow.count) : 0;
    const dailyLimit = userVip ? Number(userVip.daily_task_limit) : 5;
    const isEligibleToWithdraw = completedToday >= dailyLimit;

    // 5. Fetch recent transactions from the immutable ledger
    const transactions = query(`
      SELECT id, type, amount, balance_before, balance_after, status, reference_type, description_ar, is_demo, created_at
      FROM transactions
      WHERE user_id = ?
      ORDER BY id DESC
      LIMIT 50
    `, [userId]);

    return sendJson(res, 200, {
      currency,
      wallet: {
        availableBalance: Number(wallet.available_balance),
        pendingBalance: Number(wallet.pending_balance),
        totalEarned: Number(wallet.total_earned),
        totalWithdrawn: Number(wallet.total_withdrawn),
        currency,
        isLocked: Boolean(wallet.is_locked),
        isDemo: Boolean(req.user.is_demo)
      },
      taskCompletionStatus: {
        completedToday,
        dailyLimit,
        remainingTasks: Math.max(0, dailyLimit - completedToday),
        isEligibleToWithdraw,
        conditionMessage: isEligibleToWithdraw 
          ? 'تم استيفاء شرط إكمال جميع المهام اليومية بنجاح' 
          : `يجب إكمال جميع المهام اليومية أولاً (${completedToday} من ${dailyLimit} مكتملة)`
      },
      withdrawalRules: {
        minAmount,
        feePercentage: feePct,
        currency,
        conditions: [
          `الشرط الأول والأساسي: إكمال جميع المهام اليومية (${completedToday} من ${dailyLimit}) لتفعيل زر السحب.`,
          'يتم السحب حصراً من الرصيد المتاح (Available Balance).',
          'لا يمكن سحب الرصيد المعلق (Pending Balance) إلا بعد اكتمال تسويته النظامية.',
          'المنصة لا تشترط إطلاقاً أي مبالغ إيداع إضافية لفتح أو سحب أرباحك وعمولاتك المكتسبة.',
          'الرسوم تخصم تلقائياً وبشكل شفاف من إجمالي مبلغ السحب المحدد.'
        ]
      },
      transactions: transactions.map(t => ({
        id: t.id,
        type: t.type,
        amount: Number(t.amount),
        balanceBefore: Number(t.balance_before),
        balanceAfter: Number(t.balance_after),
        status: t.status,
        description: t.description_ar,
        isDemo: Boolean(t.is_demo),
        createdAt: t.created_at
      }))
    });
  } catch (err) {
    console.error('getWalletOverview error:', err);
    return sendJson(res, 500, { error: 'حدث خطأ أثناء تحميل بيانات المحفظة' });
  }
}

/**
 * Submit a withdrawal request with mandatory daily task completion enforcement
 */
async function requestWithdrawal(req, res, body) {
  try {
    const userId = req.user.id;
    const { amount, method, accountDetails } = body;

    if (!amount || !method || !accountDetails) {
      return sendJson(res, 400, { error: 'يرجى تحديد المبلغ، طريقة السحب، وبيانات الحساب/المحفظة المستلمة' });
    }

    // MANDATORY CONDITION: User MUST complete ALL daily tasks before withdrawal!
    const userVip = queryOne(`
      SELECT u.id, v.daily_task_limit 
      FROM users u 
      JOIN vip_levels v ON u.vip_level_id = v.id 
      WHERE u.id = ?
    `, [userId]);

    const todayTasksRow = queryOne(`
      SELECT count(*) as count 
      FROM tasks 
      WHERE user_id = ? AND status = 'COMPLETED' AND date(completed_at) = date('now')
    `, [userId]);

    const completedToday = todayTasksRow ? Number(todayTasksRow.count) : 0;
    const dailyLimit = userVip ? Number(userVip.daily_task_limit) : 5;

    if (completedToday < dailyLimit) {
      const remaining = dailyLimit - completedToday;
      return sendJson(res, 400, {
        error: `عذراً، شرط السحب الأساسي لم يكتمل: يجب عليك إكمال جميع مهام اليوم أولاً (${completedToday} من ${dailyLimit} مكتملة). يرجى إنجاز الـ (${remaining}) مهام المتبقية لتتمكن من تقديم طلب السحب.`
      });
    }

    // Verify method exists in active payment methods
    const paymentMethod = queryOne('SELECT * FROM payment_methods WHERE code = ? AND is_active = 1', [method]);
    if (!paymentMethod) {
      return sendJson(res, 400, { error: 'طريقة السحب المحددة غير مدعومة أو تم تعطيلها مؤقتاً' });
    }

    const numAmount = Number(amount);
    if (isNaN(numAmount) || numAmount < Number(paymentMethod.min_amount)) {
      return sendJson(res, 400, {
        error: `الحد الأدنى للسحب عبر ${paymentMethod.name_ar} هو $${Number(paymentMethod.min_amount).toFixed(2)}`
      });
    }

    const result = createWithdrawalRequest({
      userId,
      amount: numAmount,
      method: paymentMethod.name_ar,
      accountDetails: accountDetails.trim(),
      isDemo: req.user.is_demo
    });

    return sendJson(res, 201, {
      message: 'تم تسجيل طلب السحب بنجاح وهو قيد المراجعة والمعالجة الإدارية',
      withdrawal: result
    });
  } catch (err) {
    console.error('requestWithdrawal error:', err);
    return sendJson(res, 400, { error: err.message || 'فشل تقديم طلب السحب' });
  }
}

/**
 * Get comprehensive transaction history (سجل المعاملات) with filtering
 */
async function getTransactions(req, res, queryParams = {}) {
  try {
    const userId = req.user.id;
    const filterType = queryParams.type || null;

    let sql = `
      SELECT id, type, amount, balance_before, balance_after, status, reference_type, reference_id, description_ar, is_demo, created_at
      FROM transactions
      WHERE user_id = ?
    `;
    const params = [userId];

    if (filterType && filterType !== 'ALL') {
      sql += ' AND type = ?';
      params.push(filterType);
    }

    sql += ' ORDER BY id DESC LIMIT 100';

    const list = query(sql, params);
    const currencySetting = queryOne("SELECT value FROM system_settings WHERE key = 'platform_currency'");
    const currency = currencySetting ? currencySetting.value : 'USDT';

    return sendJson(res, 200, {
      currency,
      transactions: list.map(t => ({
        id: t.id,
        type: t.type,
        amount: Number(t.amount),
        balanceBefore: Number(t.balance_before),
        balanceAfter: Number(t.balance_after),
        status: t.status,
        description: t.description_ar,
        isDemo: Boolean(t.is_demo),
        createdAt: t.created_at
      }))
    });
  } catch (err) {
    console.error('getTransactions error:', err);
    return sendJson(res, 500, { error: 'حدث خطأ أثناء جلب سجل المعاملات' });
  }
}

/**
 * Get user withdrawal requests history
 */
async function getWithdrawalHistory(req, res) {
  try {
    const userId = req.user.id;
    const withdrawals = query(`
      SELECT id, withdrawal_code, amount, fee_amount, net_amount, method, account_details, status, admin_notes, is_demo, created_at
      FROM withdrawals
      WHERE user_id = ?
      ORDER BY id DESC
      LIMIT 50
    `, [userId]);

    const currencySetting = queryOne("SELECT value FROM system_settings WHERE key = 'platform_currency'");
    const currency = currencySetting ? currencySetting.value : 'USDT';

    return sendJson(res, 200, {
      currency,
      withdrawals: withdrawals.map(w => ({
        id: w.id,
        code: w.withdrawal_code,
        grossAmount: Number(w.amount),
        feeAmount: Number(w.fee_amount),
        netAmount: Number(w.net_amount),
        method: w.method,
        accountDetails: w.account_details,
        status: w.status,
        adminNotes: w.admin_notes,
        isDemo: Boolean(w.is_demo),
        createdAt: w.created_at
      }))
    });
  } catch (err) {
    console.error('getWithdrawalHistory error:', err);
    return sendJson(res, 500, { error: 'حدث خطأ أثناء تحميل سجل طلبات السحب' });
  }
}

/**
 * Submit a deposit request
 */
async function requestDeposit(req, res, body) {
  try {
    const userId = req.user.id;
    const { amount, method, transactionRef } = body;

    if (!amount || !method || !transactionRef) {
      return sendJson(res, 400, { error: 'يرجى تحديد المبلغ، طريقة الدفع، ورقم الحوالة أو المعرف المالي' });
    }

    const numAmount = Number(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      return sendJson(res, 400, { error: 'مبلغ الإيداع غير صالح' });
    }

    // Verify payment method
    const pm = queryOne('SELECT * FROM payment_methods WHERE code = ? AND is_active = 1', [method]);
    if (!pm) {
      return sendJson(res, 400, { error: 'طريقة الدفع غير متوفرة أو معطلة' });
    }

    if (numAmount < Number(pm.min_amount)) {
      return sendJson(res, 400, {
        error: `الحد الأدنى للإيداع عبر ${pm.name_ar} هو ${Number(pm.min_amount).toFixed(2)}`
      });
    }

    const result = createDepositRequest({
      userId,
      amount: numAmount,
      method: pm.name_ar,
      paymentMethodId: pm.id,
      transactionRef: transactionRef.trim(),
      isDemo: req.user.is_demo
    });

    return sendJson(res, 201, {
      message: 'تم إرسال طلب الإيداع وتأكيد الحوالة بنجاح وهو قيد التدقيق والاعتماد الفوري',
      deposit: result
    });
  } catch (err) {
    console.error('requestDeposit error:', err);
    return sendJson(res, 400, { error: err.message || 'فشل إرسال طلب الإيداع' });
  }
}

/**
 * Get deposit requests history
 */
async function getDepositHistory(req, res) {
  try {
    const userId = req.user.id;
    const deposits = query(`
      SELECT id, deposit_code, amount, method, transaction_ref, status, admin_notes, is_demo, created_at
      FROM deposits
      WHERE user_id = ?
      ORDER BY id DESC
      LIMIT 50
    `, [userId]);

    const currencySetting = queryOne("SELECT value FROM system_settings WHERE key = 'platform_currency'");
    const currency = currencySetting ? currencySetting.value : 'USDT';

    return sendJson(res, 200, {
      currency,
      deposits: deposits.map(d => ({
        id: d.id,
        code: d.deposit_code,
        amount: Number(d.amount),
        method: d.method,
        transactionRef: d.transaction_ref,
        status: d.status,
        adminNotes: d.admin_notes,
        isDemo: Boolean(d.is_demo),
        createdAt: d.created_at
      }))
    });
  } catch (err) {
    console.error('getDepositHistory error:', err);
    return sendJson(res, 500, { error: 'حدث خطأ أثناء تحميل سجل الإيداعات' });
  }
}

module.exports = {
  getPaymentMethods,
  getWalletOverview,
  requestWithdrawal,
  requestDeposit,
  getDepositHistory,
  getTransactions,
  getWithdrawalHistory,
};
