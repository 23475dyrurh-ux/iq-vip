// ==============================================================================
// IQ VIP Platform - Automated Integration & Security Test Suite
// Verifies:
// 1. Zero initial virtual balances for new users (Strictly Real).
// 2. Mandatory Daily Task Completion condition for withdrawal.
// 3. Dynamic Payment Methods Management (Admin CRUD).
// 4. Platform Currency Customization via Settings.
// 5. Full Transaction Ledger & Filtering.
// ==============================================================================

const http = require('node:http');
const server = require('../server/index');
const { execute, queryOne } = require('../database/db');

const PORT = 3000;
const BASE_URL = `http://127.0.0.1:${PORT}`;

function request(path, method = 'GET', body = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const req = http.request(url, { method, headers }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({ status: res.statusCode, data: json });
        } catch (e) {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });

    req.on('error', err => reject(err));
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runTestSuite() {
  let serverStarted = false;
  try {
    if (!server.listening) {
      await new Promise((resolve, reject) => {
        server.once('error', (err) => {
          if (err.code === 'EADDRINUSE') {
            console.log(`Server already running on port ${PORT}, testing against running instance.`);
            resolve();
          } else {
            reject(err);
          }
        });
        server.listen(PORT, '0.0.0.0', () => {
          serverStarted = true;
          resolve();
        });
      });
    }
  } catch (e) {
    console.log(`Using active server instance on port ${PORT}`);
  }

  console.log('\n=============================================================');
  console.log('   🚀 RUNNING IQ VIP INTEGRATION & SECURITY TEST SUITE       ');
  console.log('=============================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, testName) {
    if (condition) {
      console.log(`  ✅ PASS: ${testName}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${testName}`);
      failed++;
    }
  }

  try {
    // 1. Admin Login
    console.log('--- 1. Authentication & Role Authorization ---');
    const adminLoginRes = await request('/api/auth/login', 'POST', {
      loginId: 'admin@iqvip.com',
      password: 'Admin@123456'
    });
    assert(adminLoginRes.status === 200, 'Admin credentials login succeeds');
    assert(adminLoginRes.data.user.role === 'SUPER_ADMIN', 'Admin user has SUPER_ADMIN role');
    const adminToken = adminLoginRes.data.token;

    // 2. Real User Registration (0.00 Initial Balance - No fake money)
    const randomSuffix = Date.now().toString().slice(-4);
    const userEmail = `realuser_${randomSuffix}@iqvip.com`;
    const userPhone = `+964780${randomSuffix}11`;

    const regRes = await request('/api/auth/register', 'POST', {
      fullName: 'مستخدم حقيقي جديد',
      email: userEmail,
      phone: userPhone,
      password: 'Password@123'
    });
    assert(regRes.status === 201, 'User registration succeeds without demo mode');
    assert(regRes.data.user.isDemo === false, 'Registered user is strictly real (isDemo = false)');
    const userToken = regRes.data.token;
    const userId = regRes.data.user.userId;

    // 3. User Profile: Real Initial Balance of Exactly 0.00
    const profileRes = await request('/api/auth/profile', 'GET', null, userToken);
    assert(profileRes.status === 200, 'User profile retrieved successfully');
    assert(profileRes.data.wallet.availableBalance === 0.00, 'New user starts with exactly 0.00 balance (No fake credits)');

    // 4. Tasks Locked Until Membership Activation (Deposit Condition)
    console.log('\n--- 2. Tasks Locked Until Membership Activation ---');
    const taskActivationCheck = await request('/api/tasks/available', 'GET', null, userToken);
    assert(taskActivationCheck.status === 200, 'Tasks endpoint checked for new unactivated user');
    assert(taskActivationCheck.data.activationRequired === true, 'Tasks do NOT appear until user activates membership');
    assert(taskActivationCheck.data.task === null, 'Task is null before membership activation');
    assert(taskActivationCheck.data.minRequiredBalance === 10.00, 'VIP1 minimum activation deposit is 10.00');

    // Verify startTask is also rejected before activation
    const startBlockedCheck = await request('/api/tasks/start', 'POST', { taskId: 999999 }, userToken);
    assert(startBlockedCheck.status === 400, 'startTask is blocked before membership activation');
    assert(startBlockedCheck.data.activationRequired === true, 'Response informs user that membership activation is required');

    // 4.5 Membership Activated & First Two Tasks Price <= $9.00
    console.log('\n--- 2.5 First Two Tasks Product Price <= $9.00 & Escrow Engine ---');
    // User deposits 10.00 to activate VIP1 membership
    execute('UPDATE wallets SET available_balance = 10.00, pending_balance = 0.00 WHERE user_id = ?', [userId]);

    // 1st Task Order
    const task1Check = await request('/api/tasks/available', 'GET', null, userToken);
    assert(task1Check.status === 200, 'Tasks unlocked after membership activation');
    assert(task1Check.data.task !== null, 'First task is now visible and assigned');
    assert(task1Check.data.task.productPrice <= 9.00, `First task order price (${task1Check.data.task.productPrice}) does not exceed 9.00`);
    const task1Id = task1Check.data.task.id;
    const task1Price = task1Check.data.task.productPrice;

    // Start 1st task (user has 10.00 balance, which covers the <= $9 product)
    const start1Res = await request('/api/tasks/start', 'POST', { taskId: task1Id }, userToken);
    assert(start1Res.status === 200, 'User can start first task with initial 10.00 deposit');
    assert(start1Res.data.heldAmount === task1Price, 'Exact product price held in escrow for task 1');

    // Fast-forward 35 seconds and complete task 1
    execute(`UPDATE tasks SET started_at = datetime('now', '-35 seconds') WHERE id = ?`, [task1Id]);
    const complete1Res = await request('/api/tasks/complete', 'POST', { taskId: task1Id }, userToken);
    assert(complete1Res.status === 200, 'First task completed successfully');
    assert(complete1Res.data.productPriceReturned === task1Price, 'Product price returned upon task 1 completion');

    // 2nd Task Order
    const task2Check = await request('/api/tasks/available', 'GET', null, userToken);
    assert(task2Check.status === 200, 'Second task retrieved');
    assert(task2Check.data.task !== null, 'Second task is visible');
    assert(task2Check.data.task.productPrice <= 9.00, `Second task order price (${task2Check.data.task.productPrice}) does not exceed 9.00`);
    const task2Id = task2Check.data.task.id;
    const task2Price = task2Check.data.task.productPrice;

    // Start and complete 2nd task
    const start2Res = await request('/api/tasks/start', 'POST', { taskId: task2Id }, userToken);
    assert(start2Res.status === 200, 'User can start second task with balance');
    execute(`UPDATE tasks SET started_at = datetime('now', '-35 seconds') WHERE id = ?`, [task2Id]);
    const complete2Res = await request('/api/tasks/complete', 'POST', { taskId: task2Id }, userToken);
    assert(complete2Res.status === 200, 'Second task completed successfully');

    // 3rd Task Order (Standard VIP Tier Products)
    const task3Check = await request('/api/tasks/available', 'GET', null, userToken);
    assert(task3Check.status === 200, 'Third task retrieved');
    assert(task3Check.data.task !== null, 'Third task is assigned');
    const task3Id = task3Check.data.task.id;
    const task3Price = task3Check.data.task.productPrice;

    // Test Escrow Deficit requirement on task 3 if balance is insufficient to cover product price
    // Balance is 10.00 (meets membership activation requirement), but less than product price (e.g. 85.00)
    if (task3Price > 10.00) {
      execute('UPDATE wallets SET available_balance = 10.00, pending_balance = 0.00 WHERE user_id = ?', [userId]);
      const start3Blocked = await request('/api/tasks/start', 'POST', { taskId: task3Id }, userToken);
      assert(start3Blocked.status === 400, 'startTask rejected when product price > available balance');
      assert(start3Blocked.data.insufficientBalance === true, 'Deficit flagged for product');
      assert(start3Blocked.data.deficit === (task3Price - 10.00), 'Deficit equals product price minus available balance');
    }

    // Top up to complete task 3
    execute('UPDATE wallets SET available_balance = 200.00, pending_balance = 0.00 WHERE user_id = ?', [userId]);
    const start3Res = await request('/api/tasks/start', 'POST', { taskId: task3Id }, userToken);
    assert(start3Res.status === 200, 'startTask succeeds when balance is topped up');
    execute(`UPDATE tasks SET started_at = datetime('now', '-35 seconds') WHERE id = ?`, [task3Id]);
    const complete3Res = await request('/api/tasks/complete', 'POST', { taskId: task3Id }, userToken);
    assert(complete3Res.status === 200, 'Task 3 completed successfully');

    // 5. Withdrawal Condition: Premature Withdrawal Blocked (Must Complete All Daily Tasks First)
    console.log('\n--- 3. Mandatory Daily Task Completion Precondition for Withdrawal ---');
    
    // Give user temporary balance (100.00) to test withdrawal and unlocked task logic
    execute('UPDATE wallets SET available_balance = 100.00 WHERE user_id = ?', [userId]);

    // Verify withdrawal attempt before completing all tasks is rejected

    const earlyWithdrawRes = await request('/api/wallet/withdraw', 'POST', {
      amount: 50.00,
      method: 'USDT_TRC20',
      accountDetails: 'TJz123456789TronAddressTRC20'
    }, userToken);

    assert(earlyWithdrawRes.status === 400, 'Server strictly BLOCKS withdrawal if daily tasks are not completed');
    assert(earlyWithdrawRes.data.error.includes('شرط السحب الأساسي لم يكتمل'), 'Clear Arabic error informing user to finish daily tasks first');

    // 6. Complete All Daily Tasks for Today
    console.log('\n--- 4. Task Execution Engine & Completing Daily Limit ---');
    // For VIP 1, limit is 5 tasks. Let's record 5 completed tasks for this user today
    execute(`UPDATE tasks SET status = 'COMPLETED', completed_at = datetime('now') WHERE user_id = ?`, [userId]);
    const existingCountRow = queryOne(`SELECT count(*) as count FROM tasks WHERE user_id = ? AND status = 'COMPLETED'`, [userId]);
    const needed = 5 - (existingCountRow ? existingCountRow.count : 0);

    for (let i = 0; i < needed; i++) {
      execute(`
        INSERT INTO tasks (user_id, product_id, task_code, vip_level_id, product_price, commission_rate, commission_amount, status, completed_at, client_token, is_demo)
        VALUES (?, 1, ?, 1, 100.0, 0.006, 0.60, 'COMPLETED', datetime('now'), ?, 0)
      `, [userId, `TSK-AUTO-${Date.now()}-${i}`, `TOK-${i}`]);
    }

    // Now user has 5 completed tasks!
    const updatedProfile = await request('/api/auth/profile', 'GET', null, userToken);
    assert(updatedProfile.data.stats.allTasksCompleted === true, 'All daily tasks marked completed for today');

    // 6. Withdrawal Request Allowed After Completing All Daily Tasks
    const validWithdrawRes = await request('/api/wallet/withdraw', 'POST', {
      amount: 50.00,
      method: 'USDT_TRC20',
      accountDetails: 'TJz123456789TronAddressTRC20'
    }, userToken);

    assert(validWithdrawRes.status === 201, 'Withdrawal request APPROVED after completing all daily tasks');
    assert(validWithdrawRes.data.withdrawal.grossAmount === 50.00, 'Withdrawal amount processed');

    // 7. Payment Methods Management (Admin CRUD)
    console.log('\n--- 4. Payment Methods Management (Admin Portal) ---');
    const paymentMethodsRes = await request('/api/payment-methods', 'GET');
    assert(paymentMethodsRes.status === 200, 'Public payment methods fetched');
    assert(paymentMethodsRes.data.methods.length >= 4, 'Includes default payment methods (USDT, Zain Cash, Qi Card, Bank Wire)');

    // Add new payment method via Admin
    const methodCode = `FASTPAY_${randomSuffix}`;
    const addMethodRes = await request('/api/admin/payment-methods/add', 'POST', {
      code: methodCode,
      name: 'محفظة فاست باي (FastPay)',
      type: 'E_WALLET',
      instructions: 'أدخل رقم هاتف محفظة FastPay',
      feePct: 2.0,
      minAmount: 10.0,
      maxAmount: 20000.0
    }, adminToken);
    assert(addMethodRes.status === 201, 'Admin can successfully add custom payment methods');

    // Toggle payment method
    const toggleRes = await request('/api/admin/payment-methods/toggle', 'POST', {
      id: addMethodRes.data.id
    }, adminToken);
    assert(toggleRes.status === 200, 'Admin can toggle payment method active status');

    // 8. Platform Currency Customization via Settings
    console.log('\n--- 5. Platform Currency Customization via Settings ---');
    // Change currency to IQD (د.ع)
    const updateCurrRes = await request('/api/admin/settings/update', 'POST', {
      settings: {
        platform_currency: 'IQD'
      }
    }, adminToken);
    assert(updateCurrRes.status === 200, 'Admin updates platform currency symbol');

    // Check that profile and wallet reflect new currency
    const checkCurrProfile = await request('/api/auth/profile', 'GET', null, userToken);
    assert(checkCurrProfile.data.currency === 'IQD', 'Profile reflects customized currency (IQD)');

    // Restore to USDT
    await request('/api/admin/settings/update', 'POST', {
      settings: { platform_currency: 'USDT' }
    }, adminToken);

    // 9. Deposit System (User recharge & Admin Approval)
    console.log('\n--- 6. Deposit / Balance Recharge Flow ---');
    const depositReq = await request('/api/wallet/deposit', 'POST', {
      amount: 150.00,
      method: 'USDT_TRC20',
      transactionRef: '0x9928fba128472910482019482019'
    }, userToken);
    assert(depositReq.status === 201, 'User can submit a balance deposit request');
    assert(depositReq.data.deposit.amount === 150.00, 'Deposit amount accurately recorded');

    const depositId = depositReq.data.deposit.depositId;

    // Admin approves deposit
    const approveDepRes = await request('/api/admin/deposits/approve', 'POST', { depositId }, adminToken);
    assert(approveDepRes.status === 200, 'Admin approves deposit and atomically credits wallet available balance');
    assert(approveDepRes.data.result.newAvailableBalance >= 150.00, 'User available balance increased by deposit amount');

    // Verify Deposit History & Status endpoint for User
    const userDepositsRes = await request('/api/wallet/deposits', 'GET', null, userToken);
    assert(userDepositsRes.status === 200, 'User deposit history fetched successfully');
    assert(Array.isArray(userDepositsRes.data.deposits), 'Deposits returned as list');
    const myDeposit = userDepositsRes.data.deposits.find(d => d.id === depositId);
    assert(myDeposit && myDeposit.status === 'APPROVED', 'Deposit status correctly reflects APPROVED status in user history');

    // Verify Withdrawal History & Status endpoint for User
    const userWithdrawalsRes = await request('/api/wallet/withdrawals', 'GET', null, userToken);
    assert(userWithdrawalsRes.status === 200, 'User withdrawal history fetched successfully');
    assert(Array.isArray(userWithdrawalsRes.data.withdrawals), 'Withdrawals returned as list');
    assert(userWithdrawalsRes.data.withdrawals.length > 0, 'User withdrawal request is recorded with status in history');

    // 10. Full Transactions Ledger
    console.log('\n--- 7. Comprehensive Transaction Ledger & Filtering ---');
    const txRes = await request('/api/wallet/transactions', 'GET', null, userToken);
    assert(txRes.status === 200, 'Transactions ledger fetched');
    assert(Array.isArray(txRes.data.transactions), 'Transactions list returned as array');

    // 11. Suspended Account Login Security Verification
    console.log('\n--- 8. Suspended Account Login & Security Response ---');
    // Create a user and suspend them
    const suspUserEmail = `suspended_${Date.now()}@iqvip.com`;
    const suspUserPhone = `+964790${Date.now().toString().slice(-6)}`;
    const suspRegRes = await request('/api/auth/register', 'POST', {
      fullName: 'مستخدم مجمد للتجربة',
      email: suspUserEmail,
      phone: suspUserPhone,
      password: 'User@123456'
    });
    assert(suspRegRes.status === 201, 'Test user registered successfully');
    const suspUserId = suspRegRes.data.user.id;

    // Suspend user in DB / via Admin API
    const suspendRes = await request('/api/admin/users/update', 'POST', {
      userId: suspUserId,
      status: 'SUSPENDED',
      reason: 'فحص رسالة التجميد الأمنية'
    }, adminToken);
    assert(suspendRes.status === 200, 'User status successfully set to SUSPENDED by Admin');

    // Attempt login as suspended user
    const suspLoginRes = await request('/api/auth/login', 'POST', {
      loginId: suspUserEmail,
      password: 'User@123456'
    });
    assert(suspLoginRes.status === 403, 'Suspended user login is strictly rejected with HTTP 403');
    assert(suspLoginRes.data.error === 'تم تجميد حسابك، يرجى التواصل معنا', 'Exact error message returned: "تم تجميد حسابك، يرجى التواصل معنا"');
    assert(suspLoginRes.data.isSuspended === true, 'Response contains isSuspended: true flag');

    // 12. Live Customer Support System Integration
    console.log('\n--- 9. Live Customer Support System (Client & Admin Chat) ---');
    const testSupportSessionId = `test_sess_${Date.now()}`;

    // User sends support inquiry
    const sendMsgRes = await request('/api/support/send', 'POST', {
      sessionId: testSupportSessionId,
      message: 'مرحباً، تم تجميد حسابي وأريد المساعدة في فك التجميد',
      senderName: 'مستخدم مجمد للتجربة',
      senderContact: suspUserEmail,
      subject: 'طلب فك تجميد الحساب'
    });
    assert(sendMsgRes.status === 201, 'User can send support chat message');
    assert(sendMsgRes.data.success === true, 'Message send reports success');
    const conversationId = sendMsgRes.data.conversationId;
    assert(Boolean(conversationId), 'Conversation ID created and returned');

    // User gets messages
    const userMsgsRes = await request(`/api/support/messages?sessionId=${testSupportSessionId}`);
    assert(userMsgsRes.status === 200, 'User can retrieve chat messages');
    assert(Array.isArray(userMsgsRes.data.messages), 'Messages returned as list');
    assert(userMsgsRes.data.messages.some(m => m.message.includes('فك التجميد')), 'User message exists in thread');

    // Admin lists conversations
    const adminConvRes = await request('/api/admin/support/conversations', 'GET', null, adminToken);
    assert(adminConvRes.status === 200, 'Admin can list all customer support conversations');
    assert(Array.isArray(adminConvRes.data.conversations), 'Admin conversations returned as list');
    const targetConv = adminConvRes.data.conversations.find(c => c.id === conversationId);
    assert(Boolean(targetConv), 'Target conversation found in admin conversation list');
    assert(targetConv.unreadAdmin >= 1, 'Admin unread count incremented for new incoming message');

    // Admin views conversation thread
    const adminThreadRes = await request(`/api/admin/support/conversation/${conversationId}`, 'GET', null, adminToken);
    assert(adminThreadRes.status === 200, 'Admin can view specific conversation thread');
    assert(adminThreadRes.data.messages.length >= 1, 'Thread contains user message');

    // Admin sends reply
    const adminReplyRes = await request('/api/admin/support/reply', 'POST', {
      conversationId,
      message: 'أهلاً بك، تمت مراجعة حسابك وسيتم رفع التجميد فوراً'
    }, adminToken);
    assert(adminReplyRes.status === 201, 'Admin can reply directly to user ticket');

    // User receives admin reply
    const userUpdatedMsgsRes = await request(`/api/support/messages?sessionId=${testSupportSessionId}`);
    assert(userUpdatedMsgsRes.status === 200, 'User retrieves updated messages');
    assert(userUpdatedMsgsRes.data.messages.some(m => m.sender_type === 'ADMIN' && m.message.includes('رفع التجميد')), 'User receives Admin response in real-time');

    // Admin marks ticket as RESOLVED
    const statusUpdateRes = await request('/api/admin/support/status', 'POST', {
      conversationId,
      status: 'RESOLVED'
    }, adminToken);
    assert(statusUpdateRes.status === 200, 'Admin can update ticket status to RESOLVED');

    console.log('\n=============================================================');
    console.log(`   TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log('=============================================================\n');

    if (failed === 0) {
      console.log('🎉 ALL INTEGRATION TESTS PASSED WITH 100% SUCCESS!');
    }

  } catch (err) {
    console.error('Fatal test error:', err);
    failed++;
  } finally {
    if (serverStarted && server.listening) {
      await new Promise((resolve) => server.close(resolve));
    }
    process.exit(failed > 0 ? 1 : 0);
  }
}

// Run tests
runTestSuite();
