// ==============================================================================
// IQ VIP Platform - Task Management Controller
// Handles task assignment, random product selection, server-side 30s timer,
// state transitions (PENDING -> PROCESSING -> COMPLETED), and duplicate prevention.
// ==============================================================================

const { query, queryOne, execute, transaction } = require('../../database/db');
const { generateCode } = require('../utils/security');
const { creditTaskCommission, holdTaskEscrow } = require('../utils/ledger');
const { sendJson } = require('../middleware');

/**
 * Get or assign an available task for the logged-in user
 */
async function getAvailableTask(req, res) {
  try {
    const userId = req.user.id;

    // 1. Fetch user & VIP details
    const user = queryOne(`
      SELECT u.id, u.vip_level_id, u.is_demo, v.daily_task_limit, v.commission_rate, v.display_name_ar as vip_title,
             v.min_deposit_or_balance as min_required_balance, v.level_name as vip_name
      FROM users u
      JOIN vip_levels v ON u.vip_level_id = v.id
      WHERE u.id = ?
    `, [userId]);

    if (!user) {
      return sendJson(res, 404, { error: 'المستخدم غير موجود' });
    }

    // Platform Currency
    const currencySetting = queryOne("SELECT value FROM system_settings WHERE key = 'platform_currency'");
    const currency = currencySetting ? currencySetting.value : 'USDT';

    // Check user's wallet balance vs VIP min_required_balance
    const wallet = queryOne('SELECT available_balance, pending_balance FROM wallets WHERE user_id = ?', [userId]);
    const availableBalance = wallet ? Number(wallet.available_balance) : 0;
    const pendingBalance = wallet ? Number(wallet.pending_balance) : 0;
    const totalBalance = Math.round((availableBalance + pendingBalance) * 100) / 100;
    const minRequiredBalance = Number(user.min_required_balance) || 10.0;

    // 1. MEMBERSHIP ACTIVATION CHECK:
    // Tasks do NOT appear until user activates their membership by depositing the tier minimum
    if (totalBalance < minRequiredBalance) {
      const deficit = Math.round((minRequiredBalance - availableBalance) * 100) / 100;
      return sendJson(res, 200, {
        task: null,
        isActivated: false,
        activationRequired: true,
        currentBalance: availableBalance,
        minRequiredBalance,
        deficit,
        vipName: user.vip_name,
        vipTitle: user.vip_title,
        currency,
        message: `تفعيل العضوية مطلوب: لا يمكنك استعراض أو بدء المهام حتى يتم تفعيل عضوية (${user.vip_title}) بإيداع رصيد لا يقل عن ${minRequiredBalance.toFixed(2)} ${currency}. رصيدك الحالي هو ${availableBalance.toFixed(2)} ${currency}.`
      });
    }

    // 2. Check if user already has an active task in PENDING or PROCESSING state
    const activeTask = queryOne(`
      SELECT t.*, p.title_ar, p.description_ar, p.price, p.category_ar, p.image_url, p.rating
      FROM tasks t
      JOIN products p ON t.product_id = p.id
      WHERE t.user_id = ? AND t.status IN ('PENDING', 'PROCESSING')
      ORDER BY t.id DESC LIMIT 1
    `, [userId]);

    // Read configured task duration
    const durationSetting = queryOne("SELECT value FROM system_settings WHERE key = 'task_processing_duration_seconds'");
    const durationSeconds = durationSetting ? parseInt(durationSetting.value, 10) : 30;

    // Check today's completed task count
    const todayCountRow = queryOne(`
      SELECT count(*) as count
      FROM tasks
      WHERE user_id = ? AND status = 'COMPLETED' AND date(completed_at) = date('now')
    `, [userId]);

    const completedToday = todayCountRow ? Number(todayCountRow.count) : 0;
    const dailyLimit = user.daily_task_limit || 5;

    // If active task exists, return it immediately so user can resume
    if (activeTask) {
      let remainingSeconds = durationSeconds;
      if (activeTask.status === 'PROCESSING' && activeTask.started_at) {
        const isoString = activeTask.started_at.includes('T') ? activeTask.started_at : activeTask.started_at.replace(' ', 'T') + 'Z';
        const startTime = new Date(isoString).getTime();
        const now = Date.now();
        const elapsed = Math.floor((now - startTime) / 1000);
        remainingSeconds = Math.max(0, durationSeconds - elapsed);
      }

      return sendJson(res, 200, {
        task: {
          id: activeTask.id,
          taskCode: activeTask.task_code,
          status: activeTask.status,
          productPrice: Number(activeTask.product_price),
          commissionRate: Number(activeTask.commission_rate),
          commissionAmount: Number(activeTask.commission_amount),
          hasSufficientBalance: activeTask.status === 'PROCESSING' ? true : (availableBalance >= Number(activeTask.product_price)),
          productDeficit: activeTask.status === 'PROCESSING' ? 0 : Math.max(0, Math.round((Number(activeTask.product_price) - availableBalance) * 100) / 100),
          userAvailableBalance: availableBalance,
          currency,
          durationSeconds: activeTask.duration_seconds || durationSeconds,
          remainingSeconds,
          startedAt: activeTask.started_at,
          clientToken: activeTask.client_token,
          isDemo: Boolean(activeTask.is_demo),
          product: {
            id: activeTask.product_id,
            title: activeTask.title_ar,
            description: activeTask.description_ar,
            price: Number(activeTask.price),
            category: activeTask.category_ar,
            image: activeTask.image_url,
            rating: Number(activeTask.rating)
          }
        },
        dailyStats: {
          completedToday,
          dailyLimit,
          remainingTasksToday: Math.max(0, dailyLimit - completedToday)
        }
      });
    }

    // 3. Check if daily limit reached
    if (completedToday >= dailyLimit) {
      return sendJson(res, 200, {
        task: null,
        message: 'لقد أكملت جميع المهام المخصصة لمستواك اليوم! يمكنك ترقية مستوى VIP أو العودة غداً.',
        dailyStats: {
          completedToday,
          dailyLimit,
          remainingTasksToday: 0
        }
      });
    }

    // 4. Select an eligible product randomly from the database
    // Requirement: The first two task orders must have product price <= $9.00
    const totalCompletedRow = queryOne(`
      SELECT count(*) as count
      FROM tasks
      WHERE user_id = ? AND status = 'COMPLETED'
    `, [userId]);
    const totalCompletedCount = totalCompletedRow ? Number(totalCompletedRow.count) : 0;
    const isFirstTwoTasks = totalCompletedCount < 2;

    let products = [];
    if (isFirstTwoTasks) {
      // First 2 task orders: product balance/price MUST NOT EXCEED $9.00
      products = query(`
        SELECT * FROM products
        WHERE is_available = 1 AND price <= 9.00
        ORDER BY RANDOM() LIMIT 1
      `);
      if (!products || products.length === 0) {
        products = query(`
          SELECT * FROM products
          WHERE is_available = 1
          ORDER BY price ASC LIMIT 1
        `);
      }
    } else {
      // Starting from 3rd task onwards: standard VIP tier products
      products = query(`
        SELECT * FROM products
        WHERE min_vip_level <= ? AND is_available = 1
        ORDER BY RANDOM() LIMIT 1
      `, [user.vip_level_id]);
    }

    if (!products || products.length === 0) {
      return sendJson(res, 404, { error: 'لا توجد منتجات متاحة لمستواك حالياً' });
    }

    const selectedProduct = products[0];
    const productPrice = Number(selectedProduct.price);
    const commRate = Number(user.commission_rate);
    const commissionAmount = Math.round((productPrice * commRate) * 10000) / 10000;
    const taskCode = generateCode('TSK');
    const clientToken = generateCode('TOK');

    // 5. Create new task in PENDING status
    const taskRes = execute(`
      INSERT INTO tasks (
        user_id, product_id, task_code, vip_level_id, product_price,
        commission_rate, commission_amount, status, duration_seconds, client_token, is_demo
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?)
    `, [
      userId,
      selectedProduct.id,
      taskCode,
      user.vip_level_id,
      productPrice,
      commRate,
      commissionAmount,
      durationSeconds,
      clientToken,
      user.is_demo ? 1 : 0
    ]);

    const taskId = taskRes.lastInsertRowid;

    return sendJson(res, 200, {
      task: {
        id: taskId,
        taskCode,
        status: 'PENDING',
        productPrice,
        commissionRate: commRate,
        commissionAmount,
        hasSufficientBalance: availableBalance >= productPrice,
        productDeficit: Math.max(0, Math.round((productPrice - availableBalance) * 100) / 100),
        userAvailableBalance: availableBalance,
        currency,
        durationSeconds,
        remainingSeconds: durationSeconds,
        clientToken,
        isDemo: Boolean(user.is_demo),
        product: {
          id: selectedProduct.id,
          title: selectedProduct.title_ar,
          description: selectedProduct.description_ar,
          price: productPrice,
          category: selectedProduct.category_ar,
          image: selectedProduct.image_url,
          rating: Number(selectedProduct.rating)
        }
      },
      dailyStats: {
        completedToday,
        dailyLimit,
        remainingTasksToday: Math.max(0, dailyLimit - completedToday)
      }
    });
  } catch (err) {
    console.error('getAvailableTask error:', err);
    return sendJson(res, 500, { error: 'حدث خطأ أثناء جلب المهمة المتاحة' });
  }
}

/**
 * Start the task: Transitions state from PENDING to PROCESSING
 */
async function startTask(req, res, body) {
  try {
    const userId = req.user.id;
    const { taskId, clientToken } = body;

    if (!taskId) {
      return sendJson(res, 400, { error: 'معرف المهمة مطلوب' });
    }

    // Mandatory Account/Task Activation Check:
    const user = queryOne(`
      SELECT u.id, v.min_deposit_or_balance as min_required_balance, v.display_name_ar as vip_title
      FROM users u
      JOIN vip_levels v ON u.vip_level_id = v.id
      WHERE u.id = ?
    `, [userId]);

    const wallet = queryOne('SELECT available_balance, pending_balance FROM wallets WHERE user_id = ?', [userId]);
    const availableBalance = wallet ? Number(wallet.available_balance) : 0;
    const pendingBalance = wallet ? Number(wallet.pending_balance) : 0;
    const totalBalance = Math.round((availableBalance + pendingBalance) * 100) / 100;
    const minRequired = user ? Number(user.min_required_balance) : 10.0;

    const currencySetting = queryOne("SELECT value FROM system_settings WHERE key = 'platform_currency'");
    const currency = currencySetting ? currencySetting.value : 'USDT';

    if (totalBalance < minRequired) {
      return sendJson(res, 400, {
        error: `عذراً، المهام مقفلة بانتظار تفعيل العضوية. يجب إيداع رصيد بالحد الأدنى (${minRequired.toFixed(2)} ${currency}) لتفعيل عضوية (${user ? user.vip_title : 'VIP1'}) والبدء في جني العمولات.`,
        activationRequired: true,
        minRequiredBalance: minRequired,
        currentBalance: availableBalance
      });
    }

    const task = queryOne(`
      SELECT t.*, p.title_ar as product_title, p.price as product_price
      FROM tasks t
      JOIN products p ON t.product_id = p.id
      WHERE t.id = ? AND t.user_id = ?
    `, [taskId, userId]);

    if (!task) {
      return sendJson(res, 404, { error: 'المهمة غير موجودة' });
    }

    if (task.status === 'COMPLETED') {
      return sendJson(res, 400, { error: 'هذه المهمة مكتملة بالفعل' });
    }

    if (task.status === 'PROCESSING') {
      // Already started
      return sendJson(res, 200, {
        message: 'المهمة قيد المعالجة بالفعل',
        startedAt: task.started_at,
        durationSeconds: task.duration_seconds
      });
    }

    // CHECK PRODUCT PRICE ESCROW REQUIREMENT:
    // If product price > user available balance, user must deposit the deficit
    const productPrice = Number(task.product_price);
    if (availableBalance < productPrice) {
      const deficit = Math.round((productPrice - availableBalance) * 100) / 100;
      return sendJson(res, 400, {
        error: `قيمة الطلب (${productPrice.toFixed(2)} ${currency}) أعلى من رصيد حسابك المتاح (${availableBalance.toFixed(2)} ${currency}). يجب تعويض النقص الحاصل عبر إيداع مبلغ (${deficit.toFixed(2)} ${currency}) لتتمكن من بدء المهمة وحجز قيمتها.`,
        insufficientBalance: true,
        insufficientProductBalance: true,
        productPrice,
        currentBalance: availableBalance,
        deficit,
        currency
      });
    }

    // Atomically hold product price in escrow
    const holdResult = holdTaskEscrow({
      userId,
      taskId,
      productPrice,
      isDemo: task.is_demo,
      productTitle: task.product_title
    });

    const updatedTask = queryOne('SELECT started_at, duration_seconds FROM tasks WHERE id = ?', [taskId]);

    return sendJson(res, 200, {
      message: `تم حجز قيمة المنتج (${productPrice.toFixed(2)} ${currency}) مؤقتاً وبدء معالجة المهمة بنجاح! سيتم فك الحجز وإرجاع المبلغ كاملاً مع أرباح العمولة عند اكتمال العداد.`,
      taskId,
      heldAmount: productPrice,
      newAvailableBalance: holdResult.newAvailableBalance,
      newPendingBalance: holdResult.newPendingBalance,
      startedAt: updatedTask.started_at,
      durationSeconds: updatedTask.duration_seconds || 30
    });
  } catch (err) {
    console.error('startTask error:', err);
    return sendJson(res, 500, { error: 'حدث خطأ أثناء بدء تنفيذ المهمة' });
  }
}

/**
 * Complete the task and credit commission atomically
 */
async function completeTask(req, res, body) {
  try {
    const userId = req.user.id;
    const { taskId, clientToken, rating, feedback } = body;

    if (!taskId) {
      return sendJson(res, 400, { error: 'معرف المهمة مطلوب لإتمام العملية' });
    }

    // Fetch task and product info
    const task = queryOne(`
      SELECT t.*, p.title_ar as product_title 
      FROM tasks t
      JOIN products p ON t.product_id = p.id
      WHERE t.id = ? AND t.user_id = ?
    `, [taskId, userId]);

    if (!task) {
      return sendJson(res, 404, { error: 'المهمة غير موجودة' });
    }

    if (task.status === 'COMPLETED') {
      return sendJson(res, 400, { error: 'تم احتساب وإيداع عمولة هذه المهمة مسبقاً' });
    }

    if (task.status !== 'PROCESSING') {
      return sendJson(res, 400, { error: 'يجب بدء المهمة أولاً قبل محاولة تأكيدها وإنهائها' });
    }

    // Server-side validation of the processing period (configurable duration, e.g. 30s)
    // Allow slight tolerance (2 seconds) for network latency
    const requiredDuration = task.duration_seconds || 30;
    if (task.started_at) {
      const isoString = task.started_at.includes('T') ? task.started_at : task.started_at.replace(' ', 'T') + 'Z';
      const startTime = new Date(isoString).getTime();
      const now = Date.now();
      const elapsedSeconds = Math.floor((now - startTime) / 1000);

      // If user attempts to complete prematurely without waiting
      if (isNaN(elapsedSeconds) || elapsedSeconds < requiredDuration - 2) {
        return sendJson(res, 400, {
          error: `لم تكتمل مدة المعالجة المطلوبة بعد (${requiredDuration} ثانية). يرجى الانتظار حتى اكتمال شريط التقدم.`
        });
      }
    }

    // Atomically credit commission and release held escrow via financial ledger
    const creditResult = creditTaskCommission({
      userId,
      taskId: task.id,
      commissionAmount: Number(task.commission_amount),
      isDemo: task.is_demo,
      productTitle: task.product_title
    });

    const currencySetting = queryOne("SELECT value FROM system_settings WHERE key = 'platform_currency'");
    const currency = currencySetting ? currencySetting.value : 'USDT';

    const returnedPrice = creditResult.productPriceReturned || 0;
    const earnedComm = creditResult.commissionAmount || 0;
    const wallet = queryOne('SELECT * FROM wallets WHERE user_id = ?', [userId]);

    const message = returnedPrice > 0
      ? `تهانينا! تم فك حجز واسترداد قيمة المنتج (${returnedPrice.toFixed(2)} ${currency}) وإيداع أرباح العمولة (${earnedComm.toFixed(4)} ${currency}) بنجاح في محفظتك!`
      : `تهانينا! تم إنجاز المهمة وتقييم المنتج بنجاح وإيداع العمولة (${earnedComm.toFixed(4)} ${currency}) في محفظتك.`;

    return sendJson(res, 200, {
      success: true,
      message,
      taskCode: task.task_code,
      productPriceReturned: returnedPrice,
      commissionEarned: earnedComm,
      totalReturned: returnedPrice + earnedComm,
      wallet: {
        availableBalance: Number(wallet.available_balance),
        pendingBalance: Number(wallet.pending_balance),
        totalEarned: Number(wallet.total_earned)
      },
      isDemo: Boolean(task.is_demo)
    });
  } catch (err) {
    console.error('completeTask error:', err);
    return sendJson(res, 500, { error: err.message || 'حدث خطأ أثناء إتمام المهمة وتسوية العمولة' });
  }
}

/**
 * Get task history for the logged-in user
 */
async function getTaskHistory(req, res) {
  try {
    const userId = req.user.id;
    const tasks = query(`
      SELECT t.id, t.task_code, t.product_price, t.commission_rate, t.commission_amount,
             t.status, t.started_at, t.completed_at, t.is_demo, t.created_at,
             p.title_ar, p.image_url, p.category_ar
      FROM tasks t
      JOIN products p ON t.product_id = p.id
      WHERE t.user_id = ?
      ORDER BY t.id DESC
      LIMIT 50
    `, [userId]);

    return sendJson(res, 200, {
      tasks: tasks.map(t => ({
        id: t.id,
        taskCode: t.task_code,
        title: t.title_ar,
        category: t.category_ar,
        image: t.image_url,
        price: Number(t.product_price),
        commissionRate: Number(t.commission_rate),
        commissionAmount: Number(t.commission_amount),
        status: t.status,
        startedAt: t.started_at,
        completedAt: t.completed_at,
        isDemo: Boolean(t.is_demo),
        createdAt: t.created_at
      }))
    });
  } catch (err) {
    console.error('getTaskHistory error:', err);
    return sendJson(res, 500, { error: 'حدث خطأ أثناء جلب سجل المهام' });
  }
}

module.exports = {
  getAvailableTask,
  startTask,
  completeTask,
  getTaskHistory,
};
