// ==============================================================================
// IQ VIP Platform - Admin Dashboard Logic
// Features: Overview, Withdrawals, Payment Methods Management, Users,
// Products Catalog, VIP Tiers, Financial Ledger, Audit Trail, Settings (Currency).
// ==============================================================================

const AdminApp = {
  token: localStorage.getItem('iq_admin_token') || null,
  activeSection: 'overview',
  products: [],
  vipLevels: [],
  paymentMethods: [],
  currency: 'USDT',
  conversations: [],
  activeConversationId: null,
  currentConversation: null,
  supportFilter: 'ALL',
  supportSearchQuery: '',
  supportPollTimer: null
};

function showAdminToast(msg, type = 'info') {
  const toast = document.getElementById('app-toast');
  if (!toast) return;
  toast.innerHTML = `<span>${type === 'error' ? '⚠️' : '✅'}</span> <span>${msg}</span>`;
  toast.className = `toast-box show ${type}`;
  setTimeout(() => { toast.className = 'toast-box'; }, 3500);
}

function showAdminAuthScreen(errMsg = '') {
  const authScreen = document.getElementById('admin-auth-screen');
  const adminWrapper = document.querySelector('.admin-wrapper');
  const errBox = document.getElementById('admin-login-error');

  if (adminWrapper) adminWrapper.style.display = 'none';
  if (authScreen) authScreen.style.display = 'flex';
  
  if (errBox) {
    if (errMsg) {
      errBox.textContent = errMsg;
      errBox.style.display = 'block';
    } else {
      errBox.style.display = 'none';
    }
  }
}

function fillAdminCredentials() {
  const emailInput = document.getElementById('admin-login-email');
  const passInput = document.getElementById('admin-login-password');
  if (emailInput) emailInput.value = 'admin@iqvip.com';
  if (passInput) passInput.value = 'Admin@123456';
  showAdminToast('تم ملء بيانات المشرف تلقائياً (admin@iqvip.com / Admin@123456)', 'info');
}

async function handleAdminLogin(e) {
  e.preventDefault();
  const emailInput = document.getElementById('admin-login-email');
  const passInput = document.getElementById('admin-login-password');
  const errBox = document.getElementById('admin-login-error');
  const btn = document.getElementById('btn-admin-login');

  const email = emailInput ? emailInput.value.trim() : '';
  const password = passInput ? passInput.value.trim() : '';

  if (errBox) errBox.style.display = 'none';
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'جاري التحقق من صلاحيات المشرف...';
  }

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ loginId: email, email, password })
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'فشل تسجيل الدخول الإداري');
    }

    if (!data.user || (data.user.role !== 'ADMIN' && data.user.role !== 'SUPER_ADMIN')) {
      throw new Error('هذا الحساب ليس لديه صلاحيات إدارية للوصول إلى لوحة التحكم.');
    }

    // Save admin-exclusive token
    AdminApp.token = data.token;
    localStorage.setItem('iq_admin_token', data.token);

    // Show dashboard
    const authScreen = document.getElementById('admin-auth-screen');
    const adminWrapper = document.querySelector('.admin-wrapper');
    if (authScreen) authScreen.style.display = 'none';
    if (adminWrapper) adminWrapper.style.display = 'flex';

    showAdminToast('تم تسجيل دخول المشرف بنجاح!', 'success');
    loadSettings().then(() => loadOverviewStats());
  } catch (err) {
    if (errBox) {
      errBox.textContent = err.message;
      errBox.style.display = 'block';
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'دخول لوحة التحكم الإدارية';
    }
  }
}

async function adminApi(endpoint, method = 'GET', body = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (AdminApp.token) headers['Authorization'] = `Bearer ${AdminApp.token}`;

  const options = { method, headers };
  if (body) options.body = JSON.stringify(body);

  const res = await fetch(endpoint, options);
  const data = await res.json();
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      localStorage.removeItem('iq_admin_token');
      AdminApp.token = null;
      showAdminAuthScreen(data.error || 'انتهت صلاحية جلسة الإدارة. يرجى تسجيل الدخول مجدداً.');
      throw new Error(data.error || 'جلسة غير مصرح بها');
    }
    throw new Error(data.error || 'حدث خطأ في الخادم');
  }
  return data;
}

// Section Switching
function switchAdminSection(secId) {
  AdminApp.activeSection = secId;

  document.querySelectorAll('.admin-nav-item').forEach(item => {
    if (item.dataset.section === secId) item.classList.add('active');
    else item.classList.remove('active');
  });

  document.querySelectorAll('.admin-sec-view').forEach(sec => {
    sec.style.display = 'none';
  });

  const target = document.getElementById(`sec-${secId}`);
  if (target) target.style.display = 'block';

  // Section titles
  const titles = {
    overview: 'المؤشرات المالية والإحصائية',
    support: 'خدمة العملاء والدعم الفني والمحادثات المباشرة',
    withdrawals: 'إدارة طلبات السحب المالي والتسويات',
    deposits: 'إدارة طلبات شحن الرصيد والإيداع',
    payments: 'إدارة طرق الدفع والسحب المتاحة للمستخدمين',
    users: 'إدارة المستخدمين والحسابات المالية',
    products: 'كتالوج منتجات المهام الترويجية',
    vips: 'تكوين مستويات VIP وقواعد العمولات',
    ledger: 'السجل المحاسبي المالي الشامل (Ledger)',
    audit: 'سجل التدقيق والرقابة الإدارية (Audit Trail)',
    settings: 'إعدادات المنصة وقواعد التشغيل وتغيير العملة'
  };
  const titleEl = document.getElementById('admin-section-title');
  if (titleEl) titleEl.textContent = titles[secId] || 'لوحة المشرف';

  // Load section data
  if (secId === 'overview') loadOverviewStats();
  if (secId === 'support') loadAdminSupportConversations(true);
  if (secId === 'withdrawals') loadWithdrawals();
  if (secId === 'deposits') loadDeposits();
  if (secId === 'payments') loadPaymentMethodsAdmin();
  if (secId === 'users') loadUsers();
  if (secId === 'products') loadProducts();
  if (secId === 'vips') loadAdminVips();
  if (secId === 'ledger') loadLedger();
  if (secId === 'audit') loadAuditLogs();
  if (secId === 'settings') loadSettings();
}

// 1. Overview
async function loadOverviewStats() {
  try {
    const data = await adminApi('/api/admin/stats');
    const s = data.stats;

    document.getElementById('kpi-total-users').textContent = s.totalUsers;
    document.getElementById('kpi-commissions-paid').textContent = `${s.financials.realCommissionsPaid.toFixed(2)} ${AdminApp.currency}`;
    document.getElementById('kpi-pending-withdrawals').textContent = `${s.pendingWithdrawalsAmount.toFixed(2)} ${AdminApp.currency}`;
    document.getElementById('kpi-today-tasks').textContent = s.todayTasks;

    document.getElementById('stat-real-available').textContent = `${s.financials.realAvailableBalance.toFixed(2)} ${AdminApp.currency}`;
    document.getElementById('stat-real-withdrawn').textContent = `${s.financials.realTotalWithdrawn.toFixed(2)} ${AdminApp.currency}`;
    document.getElementById('stat-demo-balance').textContent = `${s.financials.demoVirtualBalance.toFixed(2)} ${AdminApp.currency}`;

    const distList = document.getElementById('vip-dist-list');
    if (distList) {
      distList.innerHTML = s.vipDistribution.map(v => `
        <div style="display:flex; justify-content:space-between; border-bottom:1px solid var(--navy-border); padding-bottom:6px;">
          <span style="color:var(--text-muted); font-size:0.85rem;">${v.display_name_ar}:</span>
          <span style="font-weight:700; color:var(--gold-primary);">${v.user_count} مستخدم</span>
        </div>
      `).join('');
    }
  } catch (err) {
    showAdminToast(err.message, 'error');
  }
}

// 2. Withdrawals
async function loadWithdrawals(status = null) {
  const tbody = document.getElementById('withdrawals-table-body');
  tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;">جاري جلب طلبات السحب...</td></tr>';

  try {
    const endpoint = status ? `/api/admin/withdrawals?status=${status}` : '/api/admin/withdrawals';
    const data = await adminApi(endpoint);

    if (data.withdrawals.length === 0) {
      tbody.innerHTML = '<tr><td colspan="10" style="text-align:center; color:var(--text-muted);">لا توجد طلبات سحب مطابقة</td></tr>';
      return;
    }

    tbody.innerHTML = data.withdrawals.map(w => {
      let statusBadge = `<span class="status-badge status-pending">قيد المعالجة</span>`;
      if (w.status === 'APPROVED') statusBadge = `<span class="status-badge status-approved">معتمد ومحول</span>`;
      if (w.status === 'REJECTED') statusBadge = `<span class="status-badge status-rejected">مرفوض ومسترجع</span>`;

      const isPending = w.status === 'PENDING';
      const dateStr = new Date(w.createdAt).toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' });

      return `
        <tr>
          <td><strong style="color:var(--gold-primary); font-family:monospace;">${w.code}</strong></td>
          <td>
            <div>${w.userName}</div>
            <div style="font-size:0.75rem; color:var(--text-muted);">${w.userPhone}</div>
          </td>
          <td style="font-weight:700;">${w.amount.toFixed(2)} ${AdminApp.currency}</td>
          <td style="color:var(--warning);">${w.feeAmount.toFixed(2)}</td>
          <td style="font-weight:800; color:var(--success);">${w.netAmount.toFixed(2)}</td>
          <td><span style="background:var(--bg-input); padding:4px 8px; border-radius:6px; font-size:0.78rem;">${w.method}</span></td>
          <td style="font-family:monospace; font-size:0.75rem; max-width:200px; word-break:break-all;">${w.accountDetails}</td>
          <td>${statusBadge}</td>
          <td style="font-size:0.75rem; color:var(--text-muted);">${dateStr}</td>
          <td>
            ${isPending ? `
              <div style="display:flex; gap:6px;">
                <button class="btn btn-success btn-sm" onclick="approveWth(${w.id})">موافقة</button>
                <button class="btn btn-danger btn-sm" onclick="rejectWth(${w.id})">رفض</button>
              </div>
            ` : `<span style="font-size:0.75rem; color:var(--text-muted);">${w.adminNotes || 'مكتمل'}</span>`}
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    showAdminToast(err.message, 'error');
  }
}

async function approveWth(id) {
  if (!confirm('هل أنت متأكد من اعتماد طلب السحب وتأكيد الحوالة المالية؟')) return;
  try {
    const res = await adminApi('/api/admin/withdrawals/approve', 'POST', { withdrawalId: id });
    showAdminToast(res.message, 'success');
    loadWithdrawals();
    loadOverviewStats();
  } catch (err) {
    showAdminToast(err.message, 'error');
  }
}

async function rejectWth(id) {
  const reason = prompt('يرجى كتابة سبب رفض طلب السحب (سيسجل في السجل المالي ويعاد الرصيد إلى المستخدم):', 'بيانات المحفظة غير صحيحة');
  if (!reason) return;

  try {
    const res = await adminApi('/api/admin/withdrawals/reject', 'POST', { withdrawalId: id, reason });
    showAdminToast(res.message, 'success');
    loadWithdrawals();
    loadOverviewStats();
  } catch (err) {
    showAdminToast(err.message, 'error');
  }
}

// 2.0 Deposits Management
async function loadDeposits(status = null) {
  const tbody = document.getElementById('deposits-table-body');
  tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;">جاري جلب طلبات الإيداع...</td></tr>';

  try {
    const endpoint = status ? `/api/admin/deposits?status=${status}` : '/api/admin/deposits';
    const data = await adminApi(endpoint);

    if (data.deposits.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; color:var(--text-muted);">لا توجد طلبات إيداع مطابقة</td></tr>';
      return;
    }

    tbody.innerHTML = data.deposits.map(d => {
      let statusBadge = `<span class="status-badge status-pending">قيد المراجعة</span>`;
      if (d.status === 'APPROVED') statusBadge = `<span class="status-badge status-approved">معتمد ومضاف</span>`;
      if (d.status === 'REJECTED') statusBadge = `<span class="status-badge status-rejected">مرفوض</span>`;

      const isPending = d.status === 'PENDING';
      const dateStr = new Date(d.createdAt).toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' });

      return `
        <tr>
          <td><strong style="color:var(--gold-primary); font-family:monospace;">${d.code}</strong></td>
          <td>
            <div>${d.userName}</div>
            <div style="font-size:0.75rem; color:var(--text-muted);">${d.userPhone}</div>
          </td>
          <td style="font-weight:800; color:var(--success);">$${d.amount.toFixed(2)}</td>
          <td><span style="background:var(--bg-input); padding:4px 8px; border-radius:6px; font-size:0.78rem;">${d.method}</span></td>
          <td style="font-family:monospace; font-size:0.75rem; max-width:180px; word-break:break-all;">${d.transactionRef}</td>
          <td>${statusBadge}</td>
          <td style="font-size:0.75rem; color:var(--text-muted);">${dateStr}</td>
          <td>
            ${isPending ? `
              <div style="display:flex; gap:6px;">
                <button class="btn btn-success btn-sm" onclick="approveDepositReq(${d.id})">اعتماد وإيداع</button>
                <button class="btn btn-danger btn-sm" onclick="rejectDepositReq(${d.id})">رفض</button>
              </div>
            ` : `<span style="font-size:0.75rem; color:var(--text-muted);">${d.adminNotes || 'تمت المعالجة'}</span>`}
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    showAdminToast(err.message, 'error');
  }
}

async function approveDepositReq(id) {
  if (!confirm('هل أنت متأكد من اعتماد طلب الإيداع وإضافة الرصيد إلى محفظة المستخدم فوراً؟')) return;
  try {
    const res = await adminApi('/api/admin/deposits/approve', 'POST', { depositId: id });
    showAdminToast(res.message, 'success');
    loadDeposits();
    loadOverviewStats();
  } catch (err) {
    showAdminToast(err.message, 'error');
  }
}

async function rejectDepositReq(id) {
  const reason = prompt('يرجى كتابة سبب رفض طلب الإيداع:', 'رقم الحوالة غير مطابق أو لم يتم استلام التحويل');
  if (!reason) return;

  try {
    const res = await adminApi('/api/admin/deposits/reject', 'POST', { depositId: id, reason });
    showAdminToast(res.message, 'success');
    loadDeposits();
    loadOverviewStats();
  } catch (err) {
    showAdminToast(err.message, 'error');
  }
}

// 2.1 Payment Methods Management
async function loadPaymentMethodsAdmin() {
  const tbody = document.getElementById('payments-table-body');
  tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;">جاري جلب طرق الدفع...</td></tr>';

  try {
    const data = await adminApi('/api/admin/payment-methods');
    AdminApp.paymentMethods = data.methods;

    if (data.methods.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; color:var(--text-muted);">لا توجد طرق دفع مسجلة</td></tr>';
      return;
    }

    tbody.innerHTML = data.methods.map(m => {
      const isActive = Boolean(m.is_active);
      const statusBadge = isActive 
        ? `<span class="status-badge status-active">مفعلة</span>` 
        : `<span class="status-badge status-suspended">معطلة</span>`;

      return `
        <tr>
          <td>#${m.id}</td>
          <td style="font-weight:700; color:#FFFFFF;">${m.name_ar}</td>
          <td><code style="color:var(--gold-primary); font-size:0.8rem;">${m.code}</code></td>
          <td><span style="font-size:0.75rem; background:var(--bg-input); padding:3px 6px; border-radius:4px;">${m.type}</span></td>
          <td style="color:var(--warning); font-weight:700;">${m.fee_pct}%</td>
          <td>${m.min_amount} ${AdminApp.currency}</td>
          <td>${m.max_amount} ${AdminApp.currency}</td>
          <td>${statusBadge}</td>
          <td>
            <div style="display:flex; gap:6px;">
              <button class="btn btn-secondary btn-sm" onclick="editPaymentMethod(${m.id})">تعديل</button>
              <button class="btn btn-${isActive ? 'danger' : 'success'} btn-sm" onclick="togglePaymentMethod(${m.id})">
                ${isActive ? 'تعطيل' : 'تفعيل'}
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    showAdminToast(err.message, 'error');
  }
}

function openAddPaymentModal() {
  document.getElementById('pay-id').value = '';
  document.getElementById('pay-name').value = '';
  document.getElementById('pay-code').value = '';
  document.getElementById('pay-type').value = 'E_WALLET';
  document.getElementById('pay-instructions').value = '';
  document.getElementById('pay-fee').value = '2.0';
  document.getElementById('pay-min').value = '20.0';
  document.getElementById('pay-max').value = '50000';
  document.getElementById('payment-modal-title').textContent = 'إضافة وسيلة دفع وسحب جديدة';
  document.getElementById('payment-modal').classList.add('active');
}

function editPaymentMethod(id) {
  const m = AdminApp.paymentMethods.find(x => x.id === id);
  if (!m) return;
  document.getElementById('pay-id').value = m.id;
  document.getElementById('pay-name').value = m.name_ar;
  document.getElementById('pay-code').value = m.code;
  document.getElementById('pay-type').value = m.type;
  document.getElementById('pay-instructions').value = m.instructions_ar || '';
  document.getElementById('pay-fee').value = m.fee_pct;
  document.getElementById('pay-min').value = m.min_amount;
  document.getElementById('pay-max').value = m.max_amount;
  document.getElementById('payment-modal-title').textContent = 'تعديل وسيلة الدفع والسحب';
  document.getElementById('payment-modal').classList.add('active');
}

async function savePaymentMethod(e) {
  e.preventDefault();
  const id = document.getElementById('pay-id').value;
  const name = document.getElementById('pay-name').value;
  const code = document.getElementById('pay-code').value;
  const type = document.getElementById('pay-type').value;
  const instructions = document.getElementById('pay-instructions').value;
  const feePct = document.getElementById('pay-fee').value;
  const minAmount = document.getElementById('pay-min').value;
  const maxAmount = document.getElementById('pay-max').value;

  const endpoint = id ? '/api/admin/payment-methods/update' : '/api/admin/payment-methods/add';
  const payload = { id, name, code, type, instructions, feePct, minAmount, maxAmount };

  try {
    const res = await adminApi(endpoint, 'POST', payload);
    document.getElementById('payment-modal').classList.remove('active');
    showAdminToast(res.message, 'success');
    loadPaymentMethodsAdmin();
  } catch (err) {
    showAdminToast(err.message, 'error');
  }
}

async function togglePaymentMethod(id) {
  try {
    const res = await adminApi('/api/admin/payment-methods/toggle', 'POST', { id });
    showAdminToast(res.message, 'success');
    loadPaymentMethodsAdmin();
  } catch (err) {
    showAdminToast(err.message, 'error');
  }
}

// 3. Users
async function loadUsers(search = '') {
  const tbody = document.getElementById('users-table-body');
  tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;">جاري جلب المستخدمين...</td></tr>';

  try {
    const endpoint = search ? `/api/admin/users?search=${encodeURIComponent(search)}` : '/api/admin/users';
    const data = await adminApi(endpoint);

    tbody.innerHTML = data.users.map(u => {
      const isSuspended = u.status === 'SUSPENDED';
      const statusBadge = isSuspended 
        ? `<span class="status-badge status-suspended">مجمد</span>`
        : `<span class="status-badge status-active">نشط</span>`;

      return `
        <tr>
          <td>#${u.id}</td>
          <td style="font-weight:700;">${u.fullName}</td>
          <td>
            <div>${u.email}</div>
            <div style="font-size:0.75rem; color:var(--text-muted); direction:ltr; text-align:right;">${u.phone}</div>
          </td>
          <td><span class="vip-pill">${u.vipTitle}</span></td>
          <td style="font-weight:800; color:var(--gold-primary);">${u.availableBalance.toFixed(2)} ${AdminApp.currency}</td>
          <td style="color:var(--success);">${u.totalEarned.toFixed(2)}</td>
          <td>${u.isDemo ? '<span style="color:var(--warning); font-size:0.75rem;">تجريبي (Demo)</span>' : '<span style="color:var(--success); font-size:0.75rem;">حقيقي</span>'}</td>
          <td>${statusBadge}</td>
          <td>
            <button class="btn btn-secondary btn-sm" onclick="openUserAdjustModal(${u.id}, ${u.vipLevelId}, '${u.status}')">
              تعديل / قيد رصيد
            </button>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    showAdminToast(err.message, 'error');
  }
}

function searchUsers() {
  const q = document.getElementById('user-search-input').value;
  loadUsers(q);
}

function openUserAdjustModal(userId, vipId, status) {
  document.getElementById('adj-user-id').value = userId;
  document.getElementById('adj-vip-select').value = vipId;
  document.getElementById('adj-status-select').value = status;
  document.getElementById('adj-balance-input').value = '';
  document.getElementById('adj-reason-input').value = '';
  document.getElementById('user-adjust-modal').classList.add('active');
}

async function submitUserAdjustment(e) {
  e.preventDefault();
  const userId = document.getElementById('adj-user-id').value;
  const vipLevelId = document.getElementById('adj-vip-select').value;
  const status = document.getElementById('adj-status-select').value;
  const adjustBalance = document.getElementById('adj-balance-input').value;
  const reason = document.getElementById('adj-reason-input').value;

  try {
    const res = await adminApi('/api/admin/users/update', 'POST', {
      userId, vipLevelId, status, adjustBalance, reason
    });
    document.getElementById('user-adjust-modal').classList.remove('active');
    showAdminToast(res.message, 'success');
    loadUsers();
    loadOverviewStats();
  } catch (err) {
    showAdminToast(err.message, 'error');
  }
}

// 4. Products
async function loadProducts() {
  const tbody = document.getElementById('products-table-body');
  try {
    const data = await adminApi('/api/admin/products');
    AdminApp.products = data.products;

    tbody.innerHTML = data.products.map(p => `
      <tr>
        <td>#${p.id}</td>
        <td><img src="${p.image}" style="width:48px; height:48px; object-fit:cover; border-radius:8px;"></td>
        <td style="font-weight:700;">${p.title}</td>
        <td>${p.category}</td>
        <td style="font-weight:800; color:var(--gold-primary);">${p.price.toFixed(2)} ${AdminApp.currency}</td>
        <td><span class="vip-pill">${p.vipTitle}</span></td>
        <td>⭐ ${p.rating}</td>
        <td>${p.isAvailable ? '<span class="status-badge status-active">متاح</span>' : '<span class="status-badge status-suspended">معطل</span>'}</td>
        <td>
          <button class="btn btn-secondary btn-sm" onclick="editProduct(${p.id})">تعديل</button>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    showAdminToast(err.message, 'error');
  }
}

function openAddProductModal() {
  document.getElementById('prod-id').value = '';
  document.getElementById('prod-title').value = '';
  document.getElementById('prod-desc').value = '';
  document.getElementById('prod-price').value = '';
  document.getElementById('prod-cat').value = 'إلكترونيات وتقنيات';
  document.getElementById('prod-img').value = '';
  document.getElementById('prod-vip').value = '1';
  document.getElementById('product-modal-title').textContent = 'إضافة منتج جديد';
  document.getElementById('product-modal').classList.add('active');
}

function editProduct(id) {
  const p = AdminApp.products.find(x => x.id === id);
  if (!p) return;
  document.getElementById('prod-id').value = p.id;
  document.getElementById('prod-title').value = p.title;
  document.getElementById('prod-desc').value = p.description;
  document.getElementById('prod-price').value = p.price;
  document.getElementById('prod-cat').value = p.category;
  document.getElementById('prod-img').value = p.image;
  document.getElementById('prod-vip').value = p.minVipLevel;
  document.getElementById('product-modal-title').textContent = 'تعديل بيانات المنتج';
  document.getElementById('product-modal').classList.add('active');
}

async function saveProduct(e) {
  e.preventDefault();
  const id = document.getElementById('prod-id').value;
  const title = document.getElementById('prod-title').value;
  const description = document.getElementById('prod-desc').value;
  const price = document.getElementById('prod-price').value;
  const category = document.getElementById('prod-cat').value;
  const image = document.getElementById('prod-img').value;
  const minVipLevel = document.getElementById('prod-vip').value;

  const endpoint = id ? '/api/admin/products/update' : '/api/admin/products/add';
  const payload = { id, title, description, price, category, image, minVipLevel };

  try {
    const res = await adminApi(endpoint, 'POST', payload);
    document.getElementById('product-modal').classList.remove('active');
    showAdminToast(res.message, 'success');
    loadProducts();
  } catch (err) {
    showAdminToast(err.message, 'error');
  }
}

// 5. VIP Settings
async function loadAdminVips() {
  const container = document.getElementById('admin-vip-cards-container');
  try {
    const data = await adminApi('/api/vip/levels');
    container.innerHTML = data.levels.map(lvl => `
      <div class="card" style="border-top: 4px solid ${lvl.badgeColor};">
        <h3 style="color:#FFFFFF; margin-bottom:12px; font-size:1.1rem;">${lvl.title}</h3>
        <div class="form-group">
          <label class="form-label">المهام اليومية:</label>
          <input id="vip-limit-${lvl.id}" type="number" class="form-control" value="${lvl.dailyTaskLimit}">
        </div>
        <div class="form-group">
          <label class="form-label">نسبة العمولة (مثال: 0.012 = 1.2%):</label>
          <input id="vip-rate-${lvl.id}" type="number" step="0.001" class="form-control" value="${lvl.commissionRate}">
        </div>
        <div class="form-group">
          <label class="form-label">الحد الأدنى للرصيد للترقية (${AdminApp.currency}):</label>
          <input id="vip-bal-${lvl.id}" type="number" class="form-control" value="${lvl.minRequiredBalance}">
        </div>
        <div class="form-group">
          <label class="form-label">رسوم السحب (%):</label>
          <input id="vip-fee-${lvl.id}" type="number" step="0.1" class="form-control" value="${lvl.withdrawalFeePct}">
        </div>
        <button class="btn btn-gold btn-block btn-sm" onclick="saveVipLevelConfig(${lvl.id})">
          حفظ إعدادات ${lvl.name}
        </button>
      </div>
    `).join('');
  } catch (err) {
    showAdminToast(err.message, 'error');
  }
}

async function saveVipLevelConfig(id) {
  const dailyTaskLimit = document.getElementById(`vip-limit-${id}`).value;
  const commissionRate = document.getElementById(`vip-rate-${id}`).value;
  const minBalance = document.getElementById(`vip-bal-${id}`).value;
  const feePct = document.getElementById(`vip-fee-${id}`).value;

  try {
    const res = await adminApi('/api/admin/vip/update', 'POST', {
      id, dailyTaskLimit, commissionRate, minBalance, feePct
    });
    showAdminToast(res.message, 'success');
  } catch (err) {
    showAdminToast(err.message, 'error');
  }
}

// 6. Financial Ledger
async function loadLedger() {
  const tbody = document.getElementById('ledger-table-body');
  try {
    const data = await adminApi('/api/admin/transactions');
    tbody.innerHTML = data.transactions.map(t => {
      const isPos = Number(t.amount) > 0;
      const dateStr = new Date(t.created_at).toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' });
      return `
        <tr>
          <td>#${t.id}</td>
          <td>
            <div>${t.full_name}</div>
            <div style="font-size:0.75rem; color:var(--text-muted);">${t.phone}</div>
          </td>
          <td><span style="font-family:monospace; font-size:0.8rem; background:var(--bg-input); padding:3px 6px; border-radius:4px;">${t.type}</span></td>
          <td style="font-weight:800; color:${isPos ? 'var(--success)' : 'var(--warning)'}; direction:ltr; text-align:right;">
            ${isPos ? '+' : ''}${Number(t.amount).toFixed(4)} ${AdminApp.currency}
          </td>
          <td style="color:var(--text-muted); direction:ltr; text-align:right;">${Number(t.balance_before).toFixed(2)}</td>
          <td style="font-weight:700; color:#FFFFFF; direction:ltr; text-align:right;">${Number(t.balance_after).toFixed(2)}</td>
          <td style="font-size:0.82rem;">${t.description_ar}</td>
          <td>${t.is_demo ? '<span style="color:var(--warning); font-size:0.72rem;">تجريبي</span>' : '<span style="color:var(--success); font-size:0.72rem;">حقيقي</span>'}</td>
          <td style="font-size:0.75rem; color:var(--text-muted);">${dateStr}</td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    showAdminToast(err.message, 'error');
  }
}

// 7. Audit Logs
async function loadAuditLogs() {
  const tbody = document.getElementById('audit-table-body');
  try {
    const data = await adminApi('/api/admin/audit-logs');
    tbody.innerHTML = data.logs.map(l => {
      const dateStr = new Date(l.created_at).toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' });
      return `
        <tr>
          <td>#${l.id}</td>
          <td><strong style="color:var(--gold-primary);">${l.admin_name}</strong></td>
          <td><span style="background:var(--bg-surface); padding:4px 8px; border-radius:6px; font-family:monospace; font-size:0.78rem;">${l.action}</span></td>
          <td>${l.target_type || '-'} (${l.target_id || '-'})</td>
          <td style="font-size:0.82rem;">${l.notes || '-'}</td>
          <td style="font-family:monospace; font-size:0.75rem;">${l.ip_address || '127.0.0.1'}</td>
          <td style="font-size:0.75rem; color:var(--text-muted);">${dateStr}</td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    showAdminToast(err.message, 'error');
  }
}

// 8. System Settings
async function loadSettings() {
  try {
    const data = await adminApi('/api/admin/settings');
    const s = data.settings;
    AdminApp.currency = s.platform_currency || 'USDT';

    document.getElementById('set-platform-currency').value = s.platform_currency || 'USDT';
    document.getElementById('set-require-tasks').value = s.require_all_tasks_completed_for_withdrawal || 'true';
    document.getElementById('set-task-duration').value = s.task_processing_duration_seconds || 30;
    document.getElementById('set-min-withdraw').value = s.min_withdrawal_amount || 20;
    document.getElementById('set-fee-pct').value = s.withdrawal_fee_pct || 2;
    document.getElementById('set-platform-name').value = s.platform_name || 'منصة المهام الذكية IQ VIP';
  } catch (err) {
    showAdminToast(err.message, 'error');
  }
}

async function saveSystemSettings(e) {
  e.preventDefault();
  const settings = {
    platform_currency: document.getElementById('set-platform-currency').value.trim(),
    require_all_tasks_completed_for_withdrawal: document.getElementById('set-require-tasks').value,
    task_processing_duration_seconds: document.getElementById('set-task-duration').value,
    min_withdrawal_amount: document.getElementById('set-min-withdraw').value,
    withdrawal_fee_pct: document.getElementById('set-fee-pct').value,
    platform_name: document.getElementById('set-platform-name').value
  };

  try {
    const res = await adminApi('/api/admin/settings/update', 'POST', { settings });
    AdminApp.currency = settings.platform_currency;
    showAdminToast('تم حفظ وتطبيق إعدادات المنصة واسم العملة بنجاح!', 'success');
    loadOverviewStats();
  } catch (err) {
    showAdminToast(err.message, 'error');
  }
}

// ==============================================================================
// 10. Customer Support Live Chat Management (إدارة المحادثات المباشرة)
// ==============================================================================
async function loadAdminSupportConversations(isManual = false) {
  try {
    const data = await adminApi('/api/admin/support/conversations');
    AdminApp.conversations = data.conversations || [];
    if (data.currency) AdminApp.currency = data.currency;

    // Update unread count badge in sidebar
    const unreadCount = AdminApp.conversations.reduce((sum, c) => sum + (c.unreadAdmin || 0), 0);
    const badgeEl = document.getElementById('admin-support-unread-badge');
    if (badgeEl) {
      if (unreadCount > 0) {
        badgeEl.textContent = unreadCount;
        badgeEl.style.display = 'inline-block';
      } else {
        badgeEl.style.display = 'none';
      }
    }

    renderConversationsList();

    // If an active conversation is open, refresh its messages silently
    if (AdminApp.activeConversationId) {
      openAdminConversation(AdminApp.activeConversationId, true);
    }

    if (isManual) {
      showAdminToast('تم تحديث قائمة محادثات الدعم الفني', 'info');
    }
  } catch (err) {
    if (isManual) showAdminToast(err.message, 'error');
  }
}

function renderConversationsList() {
  const container = document.getElementById('admin-conversations-list');
  if (!container) return;

  let list = AdminApp.conversations;

  // Apply status filter
  if (AdminApp.supportFilter === 'UNREAD') {
    list = list.filter(c => c.unreadAdmin > 0);
  } else if (AdminApp.supportFilter === 'OPEN') {
    list = list.filter(c => c.status === 'OPEN');
  } else if (AdminApp.supportFilter === 'RESOLVED') {
    list = list.filter(c => c.status === 'RESOLVED');
  }

  // Apply search query
  if (AdminApp.supportSearchQuery) {
    const q = AdminApp.supportSearchQuery;
    list = list.filter(c => 
      (c.senderName && c.senderName.toLowerCase().includes(q)) ||
      (c.senderContact && c.senderContact.toLowerCase().includes(q)) ||
      (c.lastMessageSnippet && c.lastMessageSnippet.toLowerCase().includes(q))
    );
  }

  if (list.length === 0) {
    container.innerHTML = '<p style="text-align:center; color:var(--text-muted); padding:30px; font-size:0.82rem;">لا توجد محادثات تطابق هذا الفلتر</p>';
    return;
  }

  container.innerHTML = list.map(c => {
    const isActive = c.id === AdminApp.activeConversationId;
    const isSuspended = c.userStatus === 'SUSPENDED';
    const isResolved = c.status === 'RESOLVED';
    const dateStr = c.lastMessageAt ? new Date(c.lastMessageAt).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }) : '';

    let statusPill = '';
    if (isSuspended) {
      statusPill = `<span class="status-badge status-suspended" style="font-size:0.65rem; padding:2px 6px;">مجمد ⚠️</span>`;
    } else if (c.userStatus === 'ACTIVE') {
      statusPill = `<span class="status-badge status-active" style="font-size:0.65rem; padding:2px 6px;">نشط</span>`;
    } else {
      statusPill = `<span class="status-badge" style="font-size:0.65rem; padding:2px 6px; background:rgba(148,163,184,0.15); color:#94A3B8;">زائر</span>`;
    }

    return `
      <div onclick="openAdminConversation(${c.id})" 
           class="support-conv-card" 
           style="background:${isActive ? 'rgba(212,175,55,0.12)' : 'var(--bg-surface)'}; border:1px solid ${isActive ? 'var(--gold-primary)' : 'var(--navy-border)'}; border-radius:8px; padding:10px 12px; cursor:pointer; transition:all 0.15s ease; position:relative;">
        
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
          <strong style="color:#FFFFFF; font-size:0.86rem; display:flex; align-items:center; gap:6px;">
            ${c.senderName || 'مستخدم المنصة'}
            ${c.unreadAdmin > 0 ? `<span style="background:#EF4444; color:#FFF; font-size:0.65rem; font-weight:800; padding:1px 6px; border-radius:10px;">${c.unreadAdmin}</span>` : ''}
          </strong>
          <span style="font-size:0.7rem; color:var(--text-muted);">${dateStr}</span>
        </div>

        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
          <span style="font-size:0.72rem; color:var(--text-muted); direction:ltr; text-align:right;">${c.senderContact || ''}</span>
          <div style="display:flex; gap:4px; align-items:center;">
            ${statusPill}
            <span style="font-size:0.65rem; color:var(--gold-primary); font-weight:700;">${c.vipTitle || 'VIP1'}</span>
          </div>
        </div>

        <div style="font-size:0.76rem; color:#CBD5E1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:100%; opacity:0.85;">
          ${c.lastMessageSnippet || 'محادثة دعم فني'}
        </div>

        ${isResolved ? '<div style="margin-top:4px; font-size:0.66rem; color:#34D399;">✓ تم الحل</div>' : ''}
      </div>
    `;
  }).join('');
}

function filterSupportConversations(status, btn) {
  AdminApp.supportFilter = status;
  document.querySelectorAll('#sec-support .btn-sm').forEach(b => {
    b.classList.remove('active-supp-filter', 'btn-gold');
    b.classList.add('btn-secondary');
  });
  if (btn) {
    btn.classList.add('active-supp-filter', 'btn-gold');
    btn.classList.remove('btn-secondary');
  }
  renderConversationsList();
}

function searchSupportConversations(query) {
  AdminApp.supportSearchQuery = query.toLowerCase().trim();
  renderConversationsList();
}

async function openAdminConversation(id, isSilent = false) {
  AdminApp.activeConversationId = id;

  if (!isSilent) {
    renderConversationsList();
  }

  const emptyState = document.getElementById('support-empty-state');
  const activeThread = document.getElementById('support-active-thread');

  try {
    const data = await adminApi(`/api/admin/support/conversation/${id}`);
    const conv = data.conversation;
    const messages = data.messages || [];

    AdminApp.currentConversation = conv;

    if (emptyState) emptyState.style.display = 'none';
    if (activeThread) activeThread.style.display = 'flex';

    // Populate Thread Header
    document.getElementById('thread-user-name').textContent = conv.senderName;
    document.getElementById('thread-user-contact').textContent = conv.senderContact || 'غير متوفر';
    document.getElementById('thread-vip-tag').textContent = conv.vipTitle || 'زائر';
    
    const balEl = document.getElementById('thread-user-balance');
    if (balEl) {
      if (conv.availableBalance !== null) {
        balEl.textContent = `الرصيد المتاح: ${conv.availableBalance.toFixed(2)} ${AdminApp.currency}`;
        balEl.style.display = 'inline';
      } else {
        balEl.style.display = 'none';
      }
    }

    const statusEl = document.getElementById('thread-user-status');
    const suspendBtn = document.getElementById('btn-toggle-suspend-user');

    if (conv.userStatus === 'SUSPENDED') {
      statusEl.className = 'status-badge status-suspended';
      statusEl.textContent = 'الحساب مجمد ⚠️';
      if (suspendBtn) {
        suspendBtn.style.display = 'inline-block';
        suspendBtn.className = 'btn btn-success btn-sm';
        suspendBtn.textContent = '🔓 إلغاء تجميد الحساب الآن';
      }
    } else if (conv.userStatus === 'ACTIVE') {
      statusEl.className = 'status-badge status-active';
      statusEl.textContent = 'الحساب نشط ✓';
      if (suspendBtn) {
        suspendBtn.style.display = 'inline-block';
        suspendBtn.className = 'btn btn-danger btn-sm';
        suspendBtn.textContent = '🔒 تجميد الحساب';
      }
    } else {
      statusEl.className = 'status-badge';
      statusEl.textContent = 'زائر (غير مسجل)';
      if (suspendBtn) suspendBtn.style.display = 'none';
    }

    const ticketBtn = document.getElementById('btn-toggle-ticket-status');
    if (ticketBtn) {
      if (conv.status === 'RESOLVED') {
        ticketBtn.textContent = '⏳ إعادة فتح التذكرة';
        ticketBtn.className = 'btn btn-secondary btn-sm';
      } else {
        ticketBtn.textContent = '✓ إغلاق كـ "تم الحل"';
        ticketBtn.className = 'btn btn-secondary btn-sm';
      }
    }

    // Render Messages
    const messagesList = document.getElementById('thread-messages-list');
    if (messagesList) {
      if (messages.length === 0) {
        messagesList.innerHTML = '<p style="text-align:center; color:var(--text-muted); padding:30px;">لا توجد رسائل سابقة في هذه المحادثة.</p>';
      } else {
        messagesList.innerHTML = messages.map(m => {
          const isAdmin = m.sender_type === 'ADMIN';
          const timeStr = m.created_at ? new Date(m.created_at).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }) : '';

          return `
            <div style="display:flex; flex-direction:column; align-self:${isAdmin ? 'flex-end' : 'flex-start'}; max-width:80%;">
              <div style="font-size:0.68rem; color:${isAdmin ? 'var(--gold-primary)' : '#94A3B8'}; font-weight:700; margin-bottom:3px; text-align:${isAdmin ? 'left' : 'right'};">
                ${m.sender_name || (isAdmin ? 'المشرف' : 'المستخدم')}
              </div>
              <div style="padding:10px 14px; border-radius:12px; font-size:0.84rem; line-height:1.5; word-break:break-word; background:${isAdmin ? '#1E293B' : 'linear-gradient(135deg, #132247 0%, #1A2E5A 100%)'}; border:1px solid ${isAdmin ? 'rgba(212,175,55,0.3)' : 'var(--navy-border)'}; color:#FFFFFF; box-shadow:0 3px 10px rgba(0,0,0,0.3);">
                ${m.message}
              </div>
              <div style="font-size:0.64rem; color:var(--text-muted); margin-top:3px; text-align:${isAdmin ? 'left' : 'right'};">
                ${timeStr}
              </div>
            </div>
          `;
        }).join('');

        if (!isSilent) {
          messagesList.scrollTop = messagesList.scrollHeight;
        }
      }
    }
  } catch (err) {
    if (!isSilent) showAdminToast(err.message, 'error');
  }
}

async function handleSendAdminReply(e) {
  e.preventDefault();
  if (!AdminApp.activeConversationId) return;

  const input = document.getElementById('admin-reply-input');
  const btn = document.getElementById('btn-admin-reply-send');
  if (!input) return;

  const message = input.value.trim();
  if (!message) return;

  if (btn) btn.disabled = true;

  try {
    await adminApi('/api/admin/support/reply', 'POST', {
      conversationId: AdminApp.activeConversationId,
      message
    });

    input.value = '';
    showAdminToast('تم إرسال رد الدعم الفني بنجاح', 'success');
    await openAdminConversation(AdminApp.activeConversationId, false);
    loadAdminSupportConversations(false);
  } catch (err) {
    showAdminToast(err.message, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

function fillAdminQuickReply(text) {
  const input = document.getElementById('admin-reply-input');
  if (input) {
    input.value = text;
    input.focus();
  }
}

async function toggleTicketStatus() {
  if (!AdminApp.currentConversation) return;

  const newStatus = AdminApp.currentConversation.status === 'RESOLVED' ? 'OPEN' : 'RESOLVED';

  try {
    const res = await adminApi('/api/admin/support/status', 'POST', {
      conversationId: AdminApp.currentConversation.id,
      status: newStatus
    });

    showAdminToast(res.message, 'success');
    await openAdminConversation(AdminApp.currentConversation.id, false);
    loadAdminSupportConversations(false);
  } catch (err) {
    showAdminToast(err.message, 'error');
  }
}

async function toggleUserSuspensionFromSupport() {
  if (!AdminApp.currentConversation || !AdminApp.currentConversation.userId) {
    showAdminToast('لا يمكن تعديل حالة حساب غير مسجل (زائر)', 'error');
    return;
  }

  const conv = AdminApp.currentConversation;
  const isCurrentlySuspended = conv.userStatus === 'SUSPENDED';
  const newStatus = isCurrentlySuspended ? 'ACTIVE' : 'SUSPENDED';
  const actionText = isCurrentlySuspended ? 'إلغاء التجميد' : 'تجميد الحساب';

  try {
    await adminApi('/api/admin/users/update', 'POST', {
      userId: conv.userId,
      status: newStatus,
      reason: `تعديل الحالة إلى ${newStatus} من خلال تذكرة الدعم الفني #${conv.id}`
    });

    showAdminToast(`تم ${actionText} بنجاح!`, 'success');

    // Automatically send a reply in the chat to notify user
    if (isCurrentlySuspended) {
      await adminApi('/api/admin/support/reply', 'POST', {
        conversationId: conv.id,
        message: 'تمت مراجعة حسابك وإلغاء التجميد بنجاح! يمكنك الآن تسجيل الدخول إلى المنصة ومتابعة نشاطك بشكل طبيعي.'
      });
    }

    await openAdminConversation(conv.id, false);
    loadAdminSupportConversations(false);
    // Also refresh users if table is loaded
    if (AdminApp.activeSection === 'users') loadUsers();
  } catch (err) {
    showAdminToast(err.message, 'error');
  }
}

function adminLogout() {
  localStorage.removeItem('iq_admin_token');
  AdminApp.token = null;
  showAdminAuthScreen();
  showAdminToast('تم تسجيل الخروج من لوحة التحكم بنجاح', 'info');
}

function initAdmin() {
  document.querySelectorAll('.admin-nav-item').forEach(item => {
    item.addEventListener('click', () => switchAdminSection(item.dataset.section));
  });

  if (!AdminApp.token) {
    showAdminAuthScreen();
    return;
  }

  // Admin token exists, display admin wrapper and load data
  const authScreen = document.getElementById('admin-auth-screen');
  const adminWrapper = document.querySelector('.admin-wrapper');
  if (authScreen) authScreen.style.display = 'none';
  if (adminWrapper) adminWrapper.style.display = 'flex';

  loadSettings()
    .then(() => loadOverviewStats())
    .catch((err) => {
      console.error('Failed to load admin stats:', err);
      showAdminAuthScreen('انتهت صلاحية الجلسة، يرجى تسجيل الدخول مجدداً.');
    });

  // Initial check for support notifications and keep poll every 15s
  loadAdminSupportConversations(false);
  setInterval(() => {
    if (AdminApp.token) {
      loadAdminSupportConversations(false);
    }
  }, 15000);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAdmin);
} else {
  initAdmin();
}
