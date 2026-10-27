// ==============================================================================
// IQ VIP Platform - Immutable Financial Ledger & Wallet Engine
// Enforces ACID compliance, atomic balance updates, double-entry auditability,
// and protects against balance desynchronization or duplicate credits.
// ==============================================================================

const { transaction, queryOne, query, execute } = require('../../database/db');
const { generateCode } = require('./security');

/**
 * Record an immutable transaction entry and update wallet balance atomically
 * @param {object} tx - Database transaction handle
 * @param {object} params
 */
function recordLedgerEntry(tx, {
  walletId,
  userId,
  type, // 'COMMISSION', 'WITHDRAWAL_REQUEST', 'WITHDRAWAL_APPROVED', 'WITHDRAWAL_REJECTED', 'DEMO_CREDIT', etc.
  amount, // positive for credit, negative for debit
  status = 'COMPLETED',
  referenceType = null,
  referenceId = null,
  descriptionAr,
  isDemo = 0
}) {
  // Fetch current wallet with pessimistic lock equivalent
  const wallet = tx.queryOne('SELECT * FROM wallets WHERE id = ?', [walletId]);
  if (!wallet) {
    throw new Error('المحفظة غير موجودة في النظام');
  }

  const currentAvailable = Number(wallet.available_balance);
  const currentPending = Number(wallet.pending_balance);
  const currentTotalEarned = Number(wallet.total_earned);
  const currentTotalWithdrawn = Number(wallet.total_withdrawn);

  let newAvailable = currentAvailable;
  let newPending = currentPending;
  let newTotalEarned = currentTotalEarned;
  let newTotalWithdrawn = currentTotalWithdrawn;

  // Calculate new balances based on transaction type
  if (type === 'COMMISSION' || type === 'DEMO_CREDIT' || type === 'SETTLEMENT_RELEASE' || type === 'DEPOSIT') {
    newAvailable = currentAvailable + Number(amount);
    if (type === 'COMMISSION') {
      newTotalEarned = currentTotalEarned + Number(amount);
    }
  } else if (type === 'WITHDRAWAL_REQUEST') {
    // When a withdrawal is requested, funds move from available to pending
    const withdrawAmount = Math.abs(Number(amount));
    if (currentAvailable < withdrawAmount) {
      throw new Error('الرصيد المتاح غير كافٍ لإتمام عملية السحب');
    }
    newAvailable = currentAvailable - withdrawAmount;
    newPending = currentPending + withdrawAmount;
  } else if (type === 'WITHDRAWAL_APPROVED') {
    // When approved, pending funds are deducted permanently
    const netDeduct = Math.abs(Number(amount));
    if (currentPending < netDeduct) {
      throw new Error('الرصيد المعلق لا يكفي لتسوية عملية السحب المعتمدة');
    }
    newPending = currentPending - netDeduct;
    newTotalWithdrawn = currentTotalWithdrawn + netDeduct;
  } else if (type === 'WITHDRAWAL_REJECTED') {
    // When rejected, funds return from pending back to available
    const returnAmount = Math.abs(Number(amount));
    newPending = Math.max(0, currentPending - returnAmount);
    newAvailable = currentAvailable + returnAmount;
  } else if (type === 'TASK_ESCROW_HOLD') {
    // When a task starts, product price moves from available to pending (held in escrow)
    const holdAmount = Math.abs(Number(amount));
    if (currentAvailable < holdAmount) {
      throw new Error('الرصيد المتاح غير كافٍ لتغطية وحجز قيمة المنتج المطلوب');
    }
    newAvailable = currentAvailable - holdAmount;
    newPending = currentPending + holdAmount;
  } else if (type === 'TASK_ESCROW_RELEASE') {
    // When task finishes, product price returns from pending back to available
    const releaseAmount = Math.abs(Number(amount));
    newPending = Math.max(0, currentPending - releaseAmount);
    newAvailable = currentAvailable + releaseAmount;
  } else if (type === 'ADMIN_ADJUSTMENT') {
    newAvailable = currentAvailable + Number(amount);
    if (newAvailable < 0) {
      throw new Error('لا يمكن أن يصبح الرصيد بعد التعديل سالباً');
    }
  }

  // Round to 4 decimal places for precision
  newAvailable = Math.round(newAvailable * 10000) / 10000;
  newPending = Math.round(newPending * 10000) / 10000;
  newTotalEarned = Math.round(newTotalEarned * 10000) / 10000;
  newTotalWithdrawn = Math.round(newTotalWithdrawn * 10000) / 10000;

  // 1. Update wallet record
  tx.execute(`
    UPDATE wallets
    SET available_balance = ?,
        pending_balance = ?,
        total_earned = ?,
        total_withdrawn = ?,
        version = version + 1,
        updated_at = datetime('now')
    WHERE id = ? AND version = ?
  `, [newAvailable, newPending, newTotalEarned, newTotalWithdrawn, walletId, wallet.version]);

  // 2. Insert into immutable ledger
  const txRes = tx.execute(`
    INSERT INTO transactions (
      wallet_id, user_id, type, amount, balance_before, balance_after,
      status, reference_type, reference_id, description_ar, is_demo
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    walletId,
    userId,
    type,
    amount,
    currentAvailable,
    newAvailable,
    status,
    referenceType,
    referenceId,
    descriptionAr,
    isDemo ? 1 : 0
  ]);

  return {
    transactionId: txRes.lastInsertRowid,
    balanceBefore: currentAvailable,
    balanceAfter: newAvailable,
    availableBalance: newAvailable,
    pendingBalance: newPending,
    totalEarned: newTotalEarned
  };
}

/**
 * Atomically hold task product price in escrow when user starts a task
 */
function holdTaskEscrow({ userId, taskId, productPrice, isDemo, productTitle }) {
  return transaction((tx) => {
    // 1. Fetch task
    const task = tx.queryOne('SELECT * FROM tasks WHERE id = ? AND user_id = ?', [taskId, userId]);
    if (!task) {
      throw new Error('المهمة غير موجودة أو لا تنتمي لهذا المستخدم');
    }
    if (task.status !== 'PENDING') {
      throw new Error('لا يمكن بدء أو حجز قيمة منتج لمهمة قيد المعالجة أو مكتملة بالفعل');
    }

    const wallet = tx.queryOne('SELECT * FROM wallets WHERE user_id = ?', [userId]);
    if (!wallet) {
      throw new Error('لم يتم العثور على محفظة المستخدم');
    }

    const currentAvailable = Number(wallet.available_balance);
    const price = Math.round(Number(productPrice) * 100) / 100;

    // Check if available balance is sufficient to cover product price
    if (currentAvailable < price) {
      const deficit = Math.round((price - currentAvailable) * 100) / 100;
      const err = new Error(`رصيدك المتاح (${currentAvailable.toFixed(2)}) غير كافٍ لتغطية وحجز قيمة المنتج (${price.toFixed(2)}). يجب تعويض النقص عبر إيداع مبلغ (${deficit.toFixed(2)}) لبدء المهمة.`);
      err.insufficientBalance = true;
      err.deficit = deficit;
      err.productPrice = price;
      err.availableBalance = currentAvailable;
      throw err;
    }

    // 2. Record hold transaction in immutable ledger
    const prefix = isDemo ? '[تجريبي] ' : '';
    const desc = `${prefix}حجز قيمة طلب المنتج (${productTitle || 'منتج المهمة'}) مؤقتاً لبدء التنفيذ`;

    const ledgerRes = recordLedgerEntry(tx, {
      walletId: wallet.id,
      userId,
      type: 'TASK_ESCROW_HOLD',
      amount: -price,
      status: 'COMPLETED',
      referenceType: 'TASK',
      referenceId: taskId,
      descriptionAr: desc,
      isDemo: isDemo ? 1 : 0
    });

    // 3. Update task status to PROCESSING with escrow tracking
    tx.execute(`
      UPDATE tasks
      SET status = 'PROCESSING',
          started_at = datetime('now'),
          escrow_held = 1,
          escrow_amount = ?
      WHERE id = ?
    `, [price, taskId]);

    return {
      success: true,
      taskId,
      taskCode: task.task_code,
      heldAmount: price,
      newAvailableBalance: ledgerRes.newAvailableBalance || ledgerRes.availableBalance,
      newPendingBalance: ledgerRes.newPendingBalance || ledgerRes.pendingBalance
    };
  });
}

/**
 * Atomically credit a task commission to the user AND release held product escrow
 */
function creditTaskCommission({ userId, taskId, commissionAmount, isDemo, productTitle }) {
  return transaction((tx) => {
    // 1. Verify task exists, belongs to user, and is in PROCESSING state
    const task = tx.queryOne('SELECT * FROM tasks WHERE id = ? AND user_id = ?', [taskId, userId]);
    if (!task) {
      throw new Error('المهمة غير موجودة أو لا تنتمي لهذا المستخدم');
    }
    if (task.status === 'COMPLETED') {
      throw new Error('تم احتساب عمولة هذه المهمة مسبقاً، لا يمكن تكرار الصرف');
    }

    // 2. Prevent duplicate commission entry in commissions table
    const existingCommission = tx.queryOne('SELECT id FROM commissions WHERE task_id = ?', [taskId]);
    if (existingCommission) {
      throw new Error('سجل العمولة موجود مسبقاً في النظام');
    }

    // 3. Mark task as COMPLETED
    tx.execute(`
      UPDATE tasks 
      SET status = 'COMPLETED',
          completed_at = datetime('now')
      WHERE id = ?
    `, [taskId]);

    // 4. Insert commission record
    tx.execute(`
      INSERT INTO commissions (user_id, task_id, amount, settlement_status, settlement_time, is_demo)
      VALUES (?, ?, ?, 'SETTLED', datetime('now'), ?)
    `, [userId, taskId, commissionAmount, isDemo ? 1 : 0]);

    // 5. Fetch user wallet
    const wallet = tx.queryOne('SELECT id FROM wallets WHERE user_id = ?', [userId]);
    if (!wallet) {
      throw new Error('لم يتم العثور على محفظة المستخدم');
    }

    const prefix = isDemo ? '[تجريبي] ' : '';
    const escrowPrice = Number(task.escrow_amount || task.product_price);

    // 6. Release escrow back to available balance if it was held!
    let releaseRes = null;
    if (task.escrow_held) {
      releaseRes = recordLedgerEntry(tx, {
        walletId: wallet.id,
        userId,
        type: 'TASK_ESCROW_RELEASE',
        amount: escrowPrice,
        status: 'COMPLETED',
        referenceType: 'TASK',
        referenceId: taskId,
        descriptionAr: `${prefix}فك حجز واسترداد قيمة المنتج (${productTitle}) بعد اكتمال التقييم`,
        isDemo: isDemo ? 1 : 0
      });
    }

    // 7. Credit commission in immutable financial ledger
    const desc = `${prefix}إيداع عمولة إنجاز مهمة تقييم المنتج (${productTitle})`;

    const ledgerRes = recordLedgerEntry(tx, {
      walletId: wallet.id,
      userId,
      type: 'COMMISSION',
      amount: commissionAmount,
      status: 'COMPLETED',
      referenceType: 'TASK',
      referenceId: taskId,
      descriptionAr: desc,
      isDemo: isDemo ? 1 : 0
    });

    // 8. Add user notification
    tx.execute(`
      INSERT INTO notifications (user_id, title_ar, message_ar, type)
      VALUES (?, 'تمت تسوية المهمة واسترداد المبلغ مع العمولة', ?, 'COMMISSION_CREDITED')
    `, [userId, `تم فك حجز $${escrowPrice.toFixed(2)} وإيداع عمولة $${commissionAmount.toFixed(4)} في محفظتك بنجاح.`]);

    return {
      success: true,
      taskCode: task.task_code,
      productPriceReturned: task.escrow_held ? escrowPrice : 0,
      commissionAmount,
      totalReturned: (task.escrow_held ? escrowPrice : 0) + commissionAmount,
      newAvailableBalance: ledgerRes.newAvailableBalance || ledgerRes.availableBalance,
      newPendingBalance: ledgerRes.newPendingBalance || ledgerRes.pendingBalance,
      isDemo: Boolean(isDemo)
    };
  });
}

/**
 * Create a withdrawal request atomically
 */
function createWithdrawalRequest({ userId, amount, method, accountDetails, isDemo }) {
  return transaction((tx) => {
    const numAmount = Number(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      throw new Error('مبلغ السحب غير صالح');
    }

    // Read minimum withdrawal setting and fee
    const minSetting = tx.queryOne("SELECT value FROM system_settings WHERE key = 'min_withdrawal_amount'");
    const minWithdrawal = minSetting ? Number(minSetting.value) : 20.00;

    if (numAmount < minWithdrawal) {
      throw new Error(`الحد الأدنى لطلب السحب هو $${minWithdrawal.toFixed(2)} USDT`);
    }

    // Fetch user and VIP level for fee
    const user = tx.queryOne(`
      SELECT u.*, v.withdrawal_fee_pct 
      FROM users u
      LEFT JOIN vip_levels v ON u.vip_level_id = v.id
      WHERE u.id = ?
    `, [userId]);

    if (!user) {
      throw new Error('المستخدم غير موجود');
    }

    const feePct = user.withdrawal_fee_pct !== undefined ? Number(user.withdrawal_fee_pct) : 2.0;
    const feeAmount = Math.round((numAmount * (feePct / 100)) * 10000) / 10000;
    const netAmount = Math.round((numAmount - feeAmount) * 10000) / 10000;

    const wallet = tx.queryOne('SELECT * FROM wallets WHERE user_id = ?', [userId]);
    if (!wallet || Number(wallet.available_balance) < numAmount) {
      throw new Error(`الرصيد المتاح غير كافٍ. رصيدك الحالي: $${wallet ? Number(wallet.available_balance).toFixed(2) : 0}`);
    }

    const withdrawalCode = generateCode('WTH');

    // Insert withdrawal request
    const wthRes = tx.execute(`
      INSERT INTO withdrawals (
        withdrawal_code, user_id, wallet_id, amount, fee_amount, net_amount,
        method, account_details, status, is_demo
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)
    `, [
      withdrawalCode,
      userId,
      wallet.id,
      numAmount,
      feeAmount,
      netAmount,
      method,
      accountDetails,
      isDemo ? 1 : 0
    ]);

    const withdrawalId = wthRes.lastInsertRowid;

    // Deduct available balance and increase pending balance in ledger
    const prefix = isDemo ? '[تجريبي] ' : '';
    const desc = `${prefix}طلب سحب رصيد (${withdrawalCode}) عبر ${method} - رسوم: $${feeAmount}`;

    const ledgerRes = recordLedgerEntry(tx, {
      walletId: wallet.id,
      userId,
      type: 'WITHDRAWAL_REQUEST',
      amount: -numAmount,
      status: 'PENDING',
      referenceType: 'WITHDRAWAL',
      referenceId: withdrawalId,
      descriptionAr: desc,
      isDemo: isDemo ? 1 : 0
    });

    // Create notification
    tx.execute(`
      INSERT INTO notifications (user_id, title_ar, message_ar, type)
      VALUES (?, 'تم استلام طلب السحب بنجاح', ?, 'WITHDRAWAL_STATUS')
    `, [userId, `طلب السحب رقم ${withdrawalCode} بمبلغ صافي $${netAmount.toFixed(2)} قيد المراجعة والمعالجة.`]);

    return {
      withdrawalId,
      withdrawalCode,
      grossAmount: numAmount,
      feeAmount,
      netAmount,
      newAvailableBalance: ledgerRes.availableBalance,
      pendingBalance: ledgerRes.pendingBalance
    };
  });
}

/**
 * Approve withdrawal (Admin action with audit log)
 */
function approveWithdrawal({ adminId, withdrawalId, ipAddress = '127.0.0.1' }) {
  return transaction((tx) => {
    const wth = tx.queryOne('SELECT * FROM withdrawals WHERE id = ?', [withdrawalId]);
    if (!wth) {
      throw new Error('طلب السحب غير موجود');
    }
    if (wth.status !== 'PENDING') {
      throw new Error(`لا يمكن تغيير حالة طلب السحب؛ حالته الحالية: ${wth.status}`);
    }

    // Update withdrawal status
    tx.execute(`
      UPDATE withdrawals
      SET status = 'APPROVED',
          reviewed_by = ?,
          reviewed_at = datetime('now')
      WHERE id = ?
    `, [adminId, withdrawalId]);

    // Ledger entry for permanent settlement of pending funds
    const prefix = wth.is_demo ? '[تجريبي] ' : '';
    const desc = `${prefix}تمت الموافقة على طلب السحب (${wth.withdrawal_code}) وتأكيد الحوالة بنجاح`;

    recordLedgerEntry(tx, {
      walletId: wth.wallet_id,
      userId: wth.user_id,
      type: 'WITHDRAWAL_APPROVED',
      amount: -Number(wth.amount),
      status: 'COMPLETED',
      referenceType: 'WITHDRAWAL',
      referenceId: withdrawalId,
      descriptionAr: desc,
      isDemo: wth.is_demo
    });

    // Audit log
    tx.execute(`
      INSERT INTO admin_audit_logs (admin_id, action, target_type, target_id, old_values, new_values, ip_address, notes)
      VALUES (?, 'APPROVE_WITHDRAWAL', 'withdrawal', ?, 'status=PENDING', 'status=APPROVED', ?, ?)
    `, [adminId, withdrawalId, ipAddress, `تمت الموافقة على طلب السحب رقم ${wth.withdrawal_code} بمبلغ $${wth.net_amount}`]);

    // Notification
    tx.execute(`
      INSERT INTO notifications (user_id, title_ar, message_ar, type)
      VALUES (?, 'تمت الموافقة على طلب السحب', ?, 'WITHDRAWAL_STATUS')
    `, [wth.user_id, `تم تحويل مبلغ $${Number(wth.net_amount).toFixed(2)} بنجاح وفق بيانات حسابك (${wth.method}).`]);

    return { success: true, withdrawalCode: wth.withdrawal_code };
  });
}

/**
 * Reject withdrawal (Admin action with refund and audit log)
 */
function rejectWithdrawal({ adminId, withdrawalId, reasonAr, ipAddress = '127.0.0.1' }) {
  return transaction((tx) => {
    const wth = tx.queryOne('SELECT * FROM withdrawals WHERE id = ?', [withdrawalId]);
    if (!wth) {
      throw new Error('طلب السحب غير موجود');
    }
    if (wth.status !== 'PENDING') {
      throw new Error(`لا يمكن تغيير حالة طلب السحب؛ حالته الحالية: ${wth.status}`);
    }

    const rejectionReason = reasonAr || 'بيانات الحساب غير مطابقة أو لم يتم استيفاء شروط المعالجة';

    // Update withdrawal record
    tx.execute(`
      UPDATE withdrawals
      SET status = 'REJECTED',
          admin_notes = ?,
          reviewed_by = ?,
          reviewed_at = datetime('now')
      WHERE id = ?
    `, [rejectionReason, adminId, withdrawalId]);

    // Return funds from pending to available
    const prefix = wth.is_demo ? '[تجريبي] ' : '';
    const desc = `${prefix}استرجاع مبلغ السحب المرفوض (${wth.withdrawal_code}) إلى الرصيد المتاح. السبب: ${rejectionReason}`;

    recordLedgerEntry(tx, {
      walletId: wth.wallet_id,
      userId: wth.user_id,
      type: 'WITHDRAWAL_REJECTED',
      amount: Number(wth.amount),
      status: 'REJECTED',
      referenceType: 'WITHDRAWAL',
      referenceId: withdrawalId,
      descriptionAr: desc,
      isDemo: wth.is_demo
    });

    // Audit log
    tx.execute(`
      INSERT INTO admin_audit_logs (admin_id, action, target_type, target_id, old_values, new_values, ip_address, notes)
      VALUES (?, 'REJECT_WITHDRAWAL', 'withdrawal', ?, 'status=PENDING', 'status=REJECTED', ?, ?)
    `, [adminId, withdrawalId, ipAddress, `رفض السحب ${wth.withdrawal_code}: ${rejectionReason}`]);

    // Notification
    tx.execute(`
      INSERT INTO notifications (user_id, title_ar, message_ar, type)
      VALUES (?, 'تم رفض طلب السحب وإعادة الرصيد', ?, 'WITHDRAWAL_STATUS')
    `, [wth.user_id, `تم رفض طلب السحب رقم ${wth.withdrawal_code} وإعادة $${Number(wth.amount).toFixed(2)} إلى رصيدك المتاح. السبب: ${rejectionReason}`]);

    return { success: true, withdrawalCode: wth.withdrawal_code };
  });
}

/**
 * Create a deposit / balance recharge request
 */
function createDepositRequest({ userId, amount, method, paymentMethodId, transactionRef, isDemo = 0 }) {
  return transaction((tx) => {
    const numAmount = Number(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      throw new Error('مبلغ الإيداع غير صالح');
    }

    const wallet = tx.queryOne('SELECT id FROM wallets WHERE user_id = ?', [userId]);
    if (!wallet) {
      throw new Error('محفظة المستخدم غير موجودة');
    }

    const depositCode = generateCode('DEP');

    const depRes = tx.execute(`
      INSERT INTO deposits (
        deposit_code, user_id, wallet_id, amount, method, payment_method_id,
        transaction_ref, status, is_demo
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)
    `, [
      depositCode,
      userId,
      wallet.id,
      numAmount,
      method,
      paymentMethodId || null,
      transactionRef || 'N/A',
      isDemo ? 1 : 0
    ]);

    const depositId = depRes.lastInsertRowid;

    // Send notification
    tx.execute(`
      INSERT INTO notifications (user_id, title_ar, message_ar, type)
      VALUES (?, 'تم استلام طلب الإيداع', ?, 'DEPOSIT_STATUS')
    `, [userId, `تم تسجيل طلب إيداع برقم (${depositCode}) بمبلغ $${numAmount.toFixed(2)} بنجاح وهو قيد المراجعة والاعتماد.`]);

    return {
      depositId,
      depositCode,
      amount: numAmount,
      method,
      transactionRef
    };
  });
}

/**
 * Approve deposit and credit funds into available balance
 */
function approveDeposit({ adminId, depositId, ipAddress = '127.0.0.1' }) {
  return transaction((tx) => {
    const dep = tx.queryOne('SELECT * FROM deposits WHERE id = ?', [depositId]);
    if (!dep) {
      throw new Error('طلب الإيداع غير موجود');
    }
    if (dep.status !== 'PENDING') {
      throw new Error(`لا يمكن تعديل حالة طلب الإيداع؛ حالته الحالية: ${dep.status}`);
    }

    // Update status to APPROVED
    tx.execute(`
      UPDATE deposits
      SET status = 'APPROVED',
          reviewed_by = ?,
          reviewed_at = datetime('now')
      WHERE id = ?
    `, [adminId, depositId]);

    // Credit wallet and add immutable ledger entry
    const desc = `إيداع وشحن رصيد المحفظة (${dep.deposit_code}) عبر ${dep.method} - رقم الحوالة: ${dep.transaction_ref}`;
    const ledgerRes = recordLedgerEntry(tx, {
      walletId: dep.wallet_id,
      userId: dep.user_id,
      type: 'DEPOSIT',
      amount: Number(dep.amount),
      status: 'COMPLETED',
      referenceType: 'DEPOSIT',
      referenceId: depositId,
      descriptionAr: desc,
      isDemo: dep.is_demo
    });

    // Record audit log
    tx.execute(`
      INSERT INTO admin_audit_logs (admin_id, action, target_type, target_id, old_values, new_values, ip_address, notes)
      VALUES (?, 'APPROVE_DEPOSIT', 'deposit', ?, 'status=PENDING', 'status=APPROVED', ?, ?)
    `, [adminId, depositId, ipAddress, `تمت الموافقة على طلب إيداع رقم ${dep.deposit_code} وإيداع مبلغ $${dep.amount} في المحفظة`]);

    // Send user notification
    tx.execute(`
      INSERT INTO notifications (user_id, title_ar, message_ar, type)
      VALUES (?, 'تم اعتماد وتأكيد الإيداع بنجاح', ?, 'DEPOSIT_STATUS')
    `, [dep.user_id, `تم تأكيد إيداعك بمبلغ $${Number(dep.amount).toFixed(2)} وإضافته إلى رصيدك المتاح بنجاح.`]);

    return {
      success: true,
      depositCode: dep.deposit_code,
      amount: Number(dep.amount),
      newAvailableBalance: ledgerRes.availableBalance
    };
  });
}

/**
 * Reject deposit request
 */
function rejectDeposit({ adminId, depositId, reasonAr, ipAddress = '127.0.0.1' }) {
  return transaction((tx) => {
    const dep = tx.queryOne('SELECT * FROM deposits WHERE id = ?', [depositId]);
    if (!dep) {
      throw new Error('طلب الإيداع غير موجود');
    }
    if (dep.status !== 'PENDING') {
      throw new Error(`لا يمكن تعديل حالة طلب الإيداع؛ حالته الحالية: ${dep.status}`);
    }

    const rejectionReason = reasonAr || 'رقم الحوالة غير مطابق أو لم يتم تأكيد استلام التحويل البنكي';

    tx.execute(`
      UPDATE deposits
      SET status = 'REJECTED',
          admin_notes = ?,
          reviewed_by = ?,
          reviewed_at = datetime('now')
      WHERE id = ?
    `, [rejectionReason, adminId, depositId]);

    // Audit log
    tx.execute(`
      INSERT INTO admin_audit_logs (admin_id, action, target_type, target_id, old_values, new_values, ip_address, notes)
      VALUES (?, 'REJECT_DEPOSIT', 'deposit', ?, 'status=PENDING', 'status=REJECTED', ?, ?)
    `, [adminId, depositId, ipAddress, `رفض الإيداع ${dep.deposit_code}: ${rejectionReason}`]);

    // Notification
    tx.execute(`
      INSERT INTO notifications (user_id, title_ar, message_ar, type)
      VALUES (?, 'تم رفض طلب الإيداع', ?, 'DEPOSIT_STATUS')
    `, [dep.user_id, `تم رفض طلب الإيداع رقم ${dep.deposit_code} بمبلغ $${Number(dep.amount).toFixed(2)}. السبب: ${rejectionReason}`]);

    return { success: true, depositCode: dep.deposit_code };
  });
}

module.exports = {
  recordLedgerEntry,
  holdTaskEscrow,
  creditTaskCommission,
  createWithdrawalRequest,
  approveWithdrawal,
  rejectWithdrawal,
  createDepositRequest,
  approveDeposit,
  rejectDeposit,
};
