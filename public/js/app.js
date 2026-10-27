// ==============================================================================
// IQ VIP Platform - Frontend Application Logic (User SPA)
// Features: Real Balances Only, Mandatory Task Completion for Withdrawal,
// Dynamic Currency, Payment Methods Integration, Full Transaction Ledger.
// ==============================================================================

const AppState = {
  token: localStorage.getItem('iq_vip_token') || null,
  user: null,
  wallet: null,
  stats: null,
  currency: 'USDT',
  paymentMethods: [],
  currentTask: null,
  taskTimerInterval: null,
  taskSecondsRemaining: 30,
  activeTab: 'home',
  allTransactions: [],
  currentTxFilter: 'ALL'
};

// -----------------------------------------------------------------------------
// Web Audio API Synthesizer (Realistic Sound FX)
// -----------------------------------------------------------------------------
const SoundFX = {
  ctx: null,
  init() {
    if (!this.ctx && (window.AudioContext || window.webkitAudioContext)) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
  },
  playTone(freq, type = 'sine', duration = 0.15, gain = 0.2) {
    try {
      this.init();
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gainNode = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
      gainNode.gain.setValueAtTime(gain, this.ctx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + duration);
      osc.connect(gainNode);
      gainNode.connect(this.ctx.destination);
      osc.start();
      osc.stop(this.ctx.currentTime + duration);
    } catch (e) {
      // Audio autoplay policy handled silently
    }
  },
  taskStart() {
    this.playTone(523.25, 'triangle', 0.1, 0.15); // C5
    setTimeout(() => this.playTone(659.25, 'triangle', 0.15, 0.15), 100); // E5
    setTimeout(() => this.playTone(783.99, 'triangle', 0.25, 0.2), 200); // G5
  },
  tick() {
    this.playTone(880, 'sine', 0.04, 0.05);
  },
  taskComplete() {
    this.playTone(523.25, 'triangle', 0.1, 0.2);
    setTimeout(() => this.playTone(659.25, 'triangle', 0.1, 0.2), 120);
    setTimeout(() => this.playTone(783.99, 'triangle', 0.1, 0.2), 240);
    setTimeout(() => this.playTone(1046.50, 'sine', 0.45, 0.25), 360);
  },
  error() {
    this.playTone(220, 'sawtooth', 0.25, 0.2);
  }
};

// -----------------------------------------------------------------------------
// Toast Notifications & UI Utilities
// -----------------------------------------------------------------------------
function showToast(message, type = 'info') {
  const toast = document.getElementById('app-toast');
  if (!toast) return;

  const icon = type === 'error' ? '⚠️' : (type === 'success' ? '✅' : '🔔');
  toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
  toast.className = `toast-box show ${type}`;

  if (type === 'error') SoundFX.error();
  if (type === 'success') SoundFX.taskComplete();

  setTimeout(() => {
    toast.className = 'toast-box';
  }, 3500);
}

// -----------------------------------------------------------------------------
// API Helper
// -----------------------------------------------------------------------------
async function apiCall(endpoint, method = 'GET', body = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (AppState.token) {
    headers['Authorization'] = `Bearer ${AppState.token}`;
  }

  const options = { method, headers };
  if (body) options.body = JSON.stringify(body);

  try {
    const res = await fetch(endpoint, options);
    let data = {};
    try {
      data = await res.json();
    } catch (parseErr) {
      data = {};
    }

    if (!res.ok) {
      const err = new Error(data.error || 'حدث خطأ في استجابة الخادم');
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  } catch (err) {
    throw err;
  }
}

// -----------------------------------------------------------------------------
// Navigation Router
// -----------------------------------------------------------------------------
function switchTab(tabId) {
  AppState.activeTab = tabId;

  // Update nav tabs styling
  document.querySelectorAll('.bottom-nav .nav-tab').forEach(tab => {
    if (tab.dataset.tab === tabId) {
      tab.classList.add('active');
    } else {
      tab.classList.remove('active');
    }
  });

  // Switch screens
  document.querySelectorAll('.view-screen').forEach(screen => {
    screen.classList.remove('active');
  });

  const target = document.getElementById(`screen-${tabId}`);
  if (target) {
    target.classList.add('active');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // Auto refresh specific tab contents
  if (tabId === 'home') loadUserProfile();
  if (tabId === 'tasks') loadTaskScreen();
  if (tabId === 'vip') loadVipScreen();
  if (tabId === 'wallet') loadWalletScreen();
  if (tabId === 'profile') loadProfileScreen();
}

// -----------------------------------------------------------------------------
// Authentication System
// -----------------------------------------------------------------------------
async function loadUserProfile() {
  if (!AppState.token) {
    showAuthModal('login');
    return;
  }

  try {
    const data = await apiCall('/api/auth/profile');
    AppState.user = data.user;
    AppState.wallet = data.wallet;
    AppState.stats = data.stats;
    if (data.currency) AppState.currency = data.currency;

    renderHomeView();
    renderHeader();
  } catch (err) {
    console.error('Profile fetch failed:', err);
    logout();
  }
}

function renderHeader() {
  const headerVip = document.getElementById('header-vip-tag');
  if (AppState.user && headerVip) {
    headerVip.textContent = AppState.user.vipTitle || 'VIP1';
    headerVip.style.display = 'flex';
  }
}

function renderHomeView() {
  if (!AppState.user || !AppState.wallet) return;

  const cur = AppState.currency;

  // Balances
  document.getElementById('home-available-balance').textContent = AppState.wallet.availableBalance.toFixed(2);
  document.getElementById('home-currency-symbol').textContent = cur;
  document.getElementById('home-pending-balance').textContent = `${AppState.wallet.pendingBalance.toFixed(2)} ${cur}`;
  document.getElementById('home-earned-balance').textContent = `${AppState.wallet.totalEarned.toFixed(2)} ${cur}`;
  document.getElementById('home-withdrawn-balance').textContent = `${AppState.wallet.totalWithdrawn.toFixed(2)} ${cur}`;

  // VIP & Limits
  document.getElementById('home-user-name').textContent = AppState.user.fullName;
  document.getElementById('home-vip-badge').textContent = AppState.user.vipTitle;

  // Handle Membership Activation Banner
  const actBanner = document.getElementById('home-activation-banner');
  if (actBanner) {
    const minReq = Number(AppState.user.minRequiredBalance) || 10.0;
    const totalBal = AppState.wallet ? (AppState.wallet.availableBalance + AppState.wallet.pendingBalance) : 0;
    const isActivated = totalBal >= minReq;
    if (!isActivated) {
      actBanner.style.display = 'block';
      const curBal = AppState.wallet ? AppState.wallet.availableBalance : 0;
      const deficit = Math.max(0, minReq - curBal);
      const titleEl = document.getElementById('activation-banner-title');
      const descEl = document.getElementById('activation-banner-desc');
      if (titleEl) titleEl.textContent = `المهام مقفلة: بانتظار تفعيل عضوية (${AppState.user.vipTitle || 'VIP1'})`;
      if (descEl) descEl.textContent = `يتطلب بدء المهام رصيد لا يقل عن ${minReq.toFixed(2)} ${cur}. رصيدك الحالي: ${curBal.toFixed(2)} ${cur} (المتبقي للتفعيل: ${deficit.toFixed(2)} ${cur}).`;
    } else {
      actBanner.style.display = 'none';
    }
  }
  
  if (AppState.stats) {
    document.getElementById('home-task-progress-text').textContent = 
      `${AppState.stats.completedToday} من أصل ${AppState.stats.dailyTaskLimit} مهام اليوم`;
    document.getElementById('home-task-progress-pct').textContent = `${AppState.stats.progressPct}%`;
    document.getElementById('home-progress-bar').style.width = `${AppState.stats.progressPct}%`;
    document.getElementById('home-today-earnings').textContent = `${AppState.stats.todayEarnings.toFixed(2)} ${cur}`;

    const eligBadge = document.getElementById('home-withdrawal-eligibility-badge');
    if (eligBadge) {
      if (AppState.stats.allTasksCompleted) {
        eligBadge.className = 'status-badge status-active';
        eligBadge.textContent = 'مؤهل للسحب اليوم ✓';
      } else {
        eligBadge.className = 'status-badge status-pending';
        eligBadge.textContent = 'السحب مقفل حتى إكمال المهام';
      }
    }
  }
}

// -----------------------------------------------------------------------------
// Task Execution Engine (30-second live countdown, progress bar, audio)
// -----------------------------------------------------------------------------
async function loadTaskScreen() {
  const taskContainer = document.getElementById('task-content-box');
  taskContainer.innerHTML = '<div style="text-align:center; padding: 40px;"><div class="spinner"></div><p style="margin-top:10px; color:var(--text-muted);">جاري تحميل المهمة المتاحة...</p></div>';

  try {
    const res = await apiCall('/api/tasks/available');

    // 1. Check if membership activation is required
    if (res.activationRequired || res.isActivated === false) {
      const cur = res.currency || AppState.currency || 'USDT';
      const minReq = Number(res.minRequiredBalance) || 10.0;
      const curBal = Number(res.currentBalance) || 0.0;
      const deficit = Number(res.deficit) || Math.max(0, minReq - curBal);

      taskContainer.innerHTML = `
        <div class="card" style="text-align:center; padding: 36px 18px; border: 1px solid rgba(212, 175, 55, 0.4); background: radial-gradient(circle at center, rgba(212, 175, 55, 0.07) 0%, rgba(11, 19, 43, 0.98) 100%);">
          <div style="width: 76px; height: 76px; margin: 0 auto 16px; border-radius: 50%; background: rgba(212, 175, 55, 0.15); border: 2px solid var(--gold-primary); display: flex; align-items: center; justify-content: center; box-shadow: 0 0 25px rgba(212, 175, 55, 0.25);">
            <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="var(--gold-primary)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
            </svg>
          </div>

          <span class="badge-status badge-status-pending" style="font-size:0.8rem; padding: 4px 12px; margin-bottom: 12px;">
            <span class="pulse-dot"></span> تفعيل العضوية مطلوب
          </span>

          <h2 style="color: #FFFFFF; font-size: 1.25rem; font-weight: 800; margin-bottom: 8px;">المهام مقفلة بانتظار تفعيل العضوية</h2>
          <p style="color: var(--text-muted); font-size: 0.85rem; line-height: 1.6; max-width: 440px; margin: 0 auto 20px;">
            لبدء استعراض وإنجاز المهام وجني العمولات، يجب تفعيل عضوية (<strong>${res.vipTitle || 'VIP1'}</strong>) بإيداع رصيد لا يقل عن <strong>${minReq.toFixed(2)} ${cur}</strong>.
          </p>

          <!-- Balance Comparison Card -->
          <div style="background: var(--bg-surface); border: 1px solid var(--navy-border); border-radius: var(--radius-md); padding: 16px; margin-bottom: 20px; text-align: right;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 0.82rem;">
              <span style="color: var(--text-muted);">رصيدك المتاح الحالي:</span>
              <span style="font-weight: 800; color: #FBBF24; direction: ltr;">${curBal.toFixed(2)} ${cur}</span>
            </div>
            <div style="display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 0.82rem;">
              <span style="color: var(--text-muted);">الحد الأدنى لتفعيل العضوية:</span>
              <span style="font-weight: 800; color: var(--gold-primary); direction: ltr;">${minReq.toFixed(2)} ${cur}</span>
            </div>
            <div style="display: flex; justify-content: space-between; padding-top: 8px; border-top: 1px solid var(--navy-border); font-size: 0.85rem;">
              <span style="color: #F87171; font-weight: 700;">المبلغ المطلوب إيداعه الآن:</span>
              <span style="font-weight: 900; color: #F87171; direction: ltr;">${deficit.toFixed(2)} ${cur}</span>
            </div>
          </div>

          <button class="btn btn-gold btn-block" onclick="openDepositModalWithDeficit(${deficit})" style="font-size: 0.95rem; padding: 13px; margin-bottom: 20px; box-shadow: var(--shadow-gold);">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"></line><polyline points="19 12 12 19 5 12"></polyline></svg>
            إيداع وشحن الرصيد لتفعيل العضوية (${deficit.toFixed(2)} ${cur})
          </button>

          <!-- VIP Activation Tiers Table -->
          <div style="background: rgba(7, 13, 30, 0.7); border: 1px solid var(--navy-border); border-radius: var(--radius-sm); padding: 12px; text-align: right;">
            <span style="font-size: 0.76rem; color: var(--gold-primary); font-weight: 700; display: block; margin-bottom: 8px;">الحد الأدنى لتفعيل مستويات VIP:</span>
            <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; font-size: 0.74rem;">
              <div style="background:var(--bg-card); padding:6px 10px; border-radius:4px; border:1px solid var(--navy-border);">• VIP1 البرونزي: <strong style="color:var(--gold-primary);">10 ${cur}</strong></div>
              <div style="background:var(--bg-card); padding:6px 10px; border-radius:4px; border:1px solid var(--navy-border);">• VIP2 الفضي: <strong style="color:var(--gold-primary);">100 ${cur}</strong></div>
              <div style="background:var(--bg-card); padding:6px 10px; border-radius:4px; border:1px solid var(--navy-border);">• VIP3 الذهبي: <strong style="color:var(--gold-primary);">250 ${cur}</strong></div>
              <div style="background:var(--bg-card); padding:6px 10px; border-radius:4px; border:1px solid var(--navy-border);">• VIP4 البلاتيني: <strong style="color:var(--gold-primary);">800 ${cur}</strong></div>
            </div>
          </div>
        </div>
      `;
      return;
    }

    if (!res.task) {
      taskContainer.innerHTML = `
        <div class="card" style="text-align:center; padding: 36px 18px;">
          <div style="font-size: 3rem; margin-bottom: 12px;">🎉</div>
          <h3 style="color:#FFFFFF; margin-bottom: 8px;">اكتملت جميع المهام المتاحة اليوم!</h3>
          <p style="color:var(--text-muted); font-size: 0.88rem; margin-bottom: 20px;">
            ${res.message || 'لقد أكملت جميع المهام اليومية المخصصة لمستوى عضويتك بنجاح! تم تفعيل إمكانية السحب الآن.'}
          </p>
          <div style="display:flex; gap:10px; justify-content:center;">
            <button class="btn btn-gold" onclick="openWithdrawModal()">طلب سحب أرباحك الآن</button>
            <button class="btn btn-secondary" onclick="switchTab('vip')">ترقية مستوى VIP</button>
          </div>
        </div>
      `;
      return;
    }

    AppState.currentTask = res.task;
    renderTaskCard(res.task);

    // If task was already in PROCESSING, resume timer
    if (res.task.status === 'PROCESSING') {
      startCountdownTimer(res.task.remainingSeconds || res.task.durationSeconds);
    }
  } catch (err) {
    taskContainer.innerHTML = `<div class="card" style="color:var(--danger); text-align:center; padding:24px;">${err.message}</div>`;
  }
}

function renderTaskCard(task) {
  const taskContainer = document.getElementById('task-content-box');
  const prod = task.product;
  const cur = AppState.currency;
  const availableBal = AppState.wallet ? Number(AppState.wallet.availableBalance) : (Number(task.userAvailableBalance) || 0);
  const price = Number(task.productPrice);
  const hasSufficient = task.hasSufficientBalance !== false && (availableBal >= price);
  const deficit = Math.max(0, Math.round((price - availableBal) * 100) / 100);

  taskContainer.innerHTML = `
    <!-- Product Showcase Card -->
    <div class="product-card">
      <div class="product-img-box">
        <img src="${prod.image}" alt="${prod.title}" class="product-img" onerror="this.src='https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=600'">
        <div class="product-badge-overlay">مهمة #${task.taskCode}</div>
      </div>
      <div class="product-info-box">
        <div class="product-cat">${prod.category}</div>
        <h2 class="product-title">${prod.title}</h2>
        <p style="font-size:0.8rem; color:var(--text-muted); margin-bottom:12px;">${prod.description}</p>
        
        <div class="product-meta-row">
          <div class="meta-item">
            <span class="meta-lbl">سعر المنتج (مبلغ الحجز)</span>
            <span class="meta-val val-gold">${task.productPrice.toFixed(2)} ${cur}</span>
          </div>
          <div class="meta-item">
            <span class="meta-lbl">نسبة العمولة</span>
            <span class="meta-val val-green">${(task.commissionRate * 100).toFixed(2)}%</span>
          </div>
          <div class="meta-item">
            <span class="meta-lbl">صافي ربح العمولة</span>
            <span class="meta-val val-green">+${task.commissionAmount.toFixed(4)} ${cur}</span>
          </div>
        </div>

        <div id="task-action-area">
          ${task.status === 'PENDING' ? `
            ${!hasSufficient ? `
              <!-- Insufficient Balance Deficit Alert Box -->
              <div style="background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.35); border-radius: var(--radius-md); padding: 14px; margin: 12px 0; text-align: right;">
                <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px;">
                  <span style="font-size:1.1rem;">⚠️</span>
                  <strong style="color:#F87171; font-size:0.88rem;">الرصيد المتاح غير كافٍ لبدء المهمة</strong>
                </div>
                <p style="font-size:0.77rem; color:var(--text-muted); line-height:1.5; margin-bottom:10px;">
                  قيمة هذا الطلب (<strong>${task.productPrice.toFixed(2)} ${cur}</strong>) أعلى من رصيدك المتاح (<strong>${availableBal.toFixed(2)} ${cur}</strong>).
                  يحجز النظام قيمة المنتج مؤقتاً أثناء المعالجة ويُعيدها فوراً مع الأرباح، لذلك يجب تعويض النقص الحالي لتتمكن من المتابعة.
                </p>
                <div style="display:flex; justify-content:space-between; align-items:center; background:var(--bg-surface); padding:8px 12px; border-radius:var(--radius-sm); margin-bottom:12px; border:1px solid var(--navy-border);">
                  <span style="font-size:0.8rem; color:var(--gold-primary); font-weight:700;">المبلغ المطلوب إيداعه لسد النقص:</span>
                  <span style="font-size:1.15rem; font-weight:900; color:#F87171; direction:ltr;">${deficit.toFixed(2)} ${cur}</span>
                </div>
                <button type="button" class="btn btn-gold btn-block" onclick="openDepositModalWithDeficit(${deficit})">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"></line><polyline points="19 12 12 19 5 12"></polyline></svg>
                  إيداع وتعويض النقص الآن (${deficit.toFixed(2)} ${cur})
                </button>
              </div>
            ` : `
              <!-- Escrow Guarantee Notice -->
              <div style="background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: var(--radius-sm); padding: 10px 12px; margin: 12px 0; font-size: 0.76rem; color: var(--text-muted); text-align: right;">
                <span style="color: #34D399; font-weight: 700; display:block; margin-bottom:2px;">🛡️ نظام حجز وضمان استرداد رأس المال:</span>
                سيتم خصم وحجز قيمة المنتج (<strong>${task.productPrice.toFixed(2)} ${cur}</strong>) مؤقتاً في الرصيد المعلق طوال فترة المعالجة (30 ثانية)، ثم يُعاد المبلغ بالكامل مع أرباح العمولة (<strong>+${task.commissionAmount.toFixed(4)} ${cur}</strong>) فور اكتمال التقييم.
              </div>
              <button id="btn-start-task" class="btn btn-gold btn-block" onclick="startCurrentTask()">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                بدء المهمة وحجز قيمة المنتج مؤقتاً (${task.productPrice.toFixed(2)} ${cur})
              </button>
            `}
          ` : `
            <div class="processing-box">
              <div class="timer-circle-wrap">
                <svg class="timer-svg" viewBox="0 0 100 100">
                  <defs>
                    <linearGradient id="goldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stop-color="#F9D976" />
                      <stop offset="100%" stop-color="#D4AF37" />
                    </linearGradient>
                  </defs>
                  <circle class="timer-bg-circle" cx="50" cy="50" r="45"></circle>
                  <circle id="timer-stroke" class="timer-bar-circle" cx="50" cy="50" r="45"></circle>
                </svg>
                <div id="countdown-number" class="timer-countdown-text">${task.remainingSeconds || 30}s</div>
              </div>

              <h4 style="color:#FFFFFF; margin-bottom: 4px;">جاري معالجة وتثبيت تقييم المنتج</h4>
              <p style="color:var(--text-muted); font-size: 0.76rem; margin-bottom: 10px;">يرجى الانتظار حتى اكتمال دورة المعالجة (30 ثانية)</p>

              <!-- Escrow Active Notification during processing -->
              <div style="background: rgba(245, 158, 11, 0.08); border: 1px solid rgba(245, 158, 11, 0.3); border-radius: var(--radius-sm); padding: 8px 10px; margin-bottom: 14px; font-size: 0.74rem; color: #FBBF24;">
                ⏳ <strong>المبلغ المحجوز حالياً:</strong> ${task.productPrice.toFixed(2)} ${cur} في الرصيد المعلق. سيتم فك الحجز وإرجاعه مع الأرباح فور انتهاء العداد.
              </div>

              <div class="task-steps-container">
                <div id="step-1" class="step-item active">
                  <span class="step-icon">1</span>
                  <span>مطابقة بيانات المنتج وحجز القيمة في الرصيد المعلق...</span>
                </div>
                <div id="step-2" class="step-item">
                  <span class="step-icon">2</span>
                  <span>إرسال تقييم المستهلك وتأكيد مراجعة الجودة...</span>
                </div>
                <div id="step-3" class="step-item">
                  <span class="step-icon">3</span>
                  <span>فك حجز المبلغ وتسوية عمولة المهمة في المحفظة...</span>
                </div>
              </div>

              <div id="task-complete-btn-wrap" style="margin-top: 18px; display: none;">
                <button id="btn-claim-commission" class="btn btn-gold btn-block" onclick="claimTaskCommission()">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
                  تأكيد واسترداد رأس المال مع العمولة (+${(task.productPrice + task.commissionAmount).toFixed(2)} ${cur})
                </button>
              </div>
            </div>
          `}
        </div>
      </div>
    </div>
  `;
}

function openDepositModalWithDeficit(deficitAmount) {
  openDepositModal();
  const input = document.getElementById('deposit-amount-input');
  if (input && deficitAmount > 0) {
    input.value = Number(deficitAmount).toFixed(2);
  }
}

async function startCurrentTask() {
  if (!AppState.currentTask) return;
  const btn = document.getElementById('btn-start-task');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'جاري حجز القيمة وبدء المهمة...';
  }

  try {
    SoundFX.taskStart();
    const res = await apiCall('/api/tasks/start', 'POST', {
      taskId: AppState.currentTask.id,
      clientToken: AppState.currentTask.clientToken
    });

    showToast(res.message, 'info');

    // Reload profile and wallet so balance move from available to pending is immediately visible!
    await loadUserProfile();
    await loadWalletScreen();

    AppState.currentTask.status = 'PROCESSING';
    renderTaskCard(AppState.currentTask);
    startCountdownTimer(res.durationSeconds || 30);
  } catch (err) {
    showToast(err.message, 'error');
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'بدء المهمة وتقييم المنتج الآن';
    }
    // If deficit error, reload task to render deficit banner
    loadTaskScreen();
  }
}

function startCountdownTimer(seconds) {
  clearInterval(AppState.taskTimerInterval);
  AppState.taskSecondsRemaining = seconds;

  const total = AppState.currentTask ? AppState.currentTask.durationSeconds || 30 : 30;
  const circleCircumference = 2 * Math.PI * 45; // ~283

  function tick() {
    const numEl = document.getElementById('countdown-number');
    const strokeEl = document.getElementById('timer-stroke');
    const step1 = document.getElementById('step-1');
    const step2 = document.getElementById('step-2');
    const step3 = document.getElementById('step-3');
    const claimWrap = document.getElementById('task-complete-btn-wrap');

    if (numEl) numEl.textContent = `${AppState.taskSecondsRemaining}s`;

    if (strokeEl) {
      const progress = (total - AppState.taskSecondsRemaining) / total;
      const offset = circleCircumference * (1 - progress);
      strokeEl.style.strokeDashoffset = offset;
    }

    const elapsed = total - AppState.taskSecondsRemaining;
    if (elapsed > 10 && step1 && step2) {
      step1.className = 'step-item done';
      step2.className = 'step-item active';
    }
    if (elapsed > 20 && step2 && step3) {
      step2.className = 'step-item done';
      step3.className = 'step-item active';
    }

    if (AppState.taskSecondsRemaining <= 0) {
      clearInterval(AppState.taskTimerInterval);
      if (step3) step3.className = 'step-item done';
      if (numEl) numEl.textContent = 'جاهز!';
      if (claimWrap) claimWrap.style.display = 'block';
      SoundFX.playTone(600, 'triangle', 0.2, 0.2);
      return;
    }

    SoundFX.tick();
    AppState.taskSecondsRemaining--;
  }

  tick();
  AppState.taskTimerInterval = setInterval(tick, 1000);
}

async function claimTaskCommission() {
  if (!AppState.currentTask) return;
  const btn = document.getElementById('btn-claim-commission');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'جاري التحقق وتسوية الرصيد...';
  }

  try {
    const res = await apiCall('/api/tasks/complete', 'POST', {
      taskId: AppState.currentTask.id,
      clientToken: AppState.currentTask.clientToken
    });

    SoundFX.taskComplete();
    showToast(res.message || `تهانينا! تم استرداد قيمة المنتج وإيداع عمولة ${res.commissionEarned.toFixed(4)} ${AppState.currency} بنجاح`, 'success');
    
    // Refresh user & wallet
    await loadUserProfile();
    await loadWalletScreen();
    // Load next task
    loadTaskScreen();
  } catch (err) {
    showToast(err.message, 'error');
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'إعادة المحاولة';
    }
  }
}

// -----------------------------------------------------------------------------
// VIP Screen
// -----------------------------------------------------------------------------
async function loadVipScreen() {
  const container = document.getElementById('vip-levels-container');
  container.innerHTML = '<div style="text-align:center; padding: 30px;"><div class="spinner"></div></div>';

  try {
    const data = await apiCall('/api/vip/levels');
    const cur = AppState.currency;

    let html = `
      <div class="card" style="border-right: 4px solid var(--gold-primary); margin-bottom: 16px;">
        <h4 style="color:var(--gold-primary); margin-bottom: 4px;">إشعار الشفافية والمسؤولية المالية</h4>
        <p style="font-size: 0.78rem; color: var(--text-muted); line-height: 1.5;">${data.disclaimer}</p>
      </div>
    `;

    data.levels.forEach(lvl => {
      const isCurrent = lvl.isCurrent;
      html += `
        <div class="vip-card ${isCurrent ? 'current' : ''}">
          <div class="vip-header">
            <div>
              <span class="vip-badge-tag" style="background:${lvl.badgeColor}22; color:${lvl.badgeColor}; border:1px solid ${lvl.badgeColor}66;">
                ${lvl.name}
              </span>
              <h3 style="color:#FFFFFF; margin-top: 6px; font-size: 1.05rem;">${lvl.title}</h3>
            </div>
            <div style="text-align: left;">
              <span style="font-size: 0.7rem; color:var(--text-muted); display:block;">نسبة العمولة</span>
              <span style="font-size: 1.2rem; font-weight: 800; color:var(--success); direction:ltr;">${lvl.commissionRatePct}</span>
            </div>
          </div>

          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:8px; padding: 10px 0; border-top: 1px solid var(--navy-border); border-bottom: 1px solid var(--navy-border);">
            <div>
              <span style="font-size:0.7rem; color:var(--text-muted);">المهام اليومية:</span>
              <span style="font-weight:700; color:#FFFFFF;"> ${lvl.dailyTaskLimit} مهام</span>
            </div>
            <div>
              <span style="font-size:0.7rem; color:var(--text-muted);">الرصيد المطلوب:</span>
              <span style="font-weight:800; color:var(--gold-primary);"> ${lvl.minRequiredBalance.toFixed(0)} ${cur}</span>
            </div>
            <div>
              <span style="font-size:0.7rem; color:var(--text-muted);">رسوم السحب:</span>
              <span style="font-weight:700; color:#FFFFFF;"> ${lvl.withdrawalFeePct}%</span>
            </div>
            <div>
              <span style="font-size:0.7rem; color:var(--text-muted);">أسعار المنتجات:</span>
              <span style="font-weight:700; color:#FFFFFF; font-size:0.78rem;"> ${lvl.productRange}</span>
            </div>
          </div>

          <ul class="vip-features-list">
            ${lvl.benefits.map(b => `
              <li class="vip-feature-item">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
                <span>${b}</span>
              </li>
            `).join('')}
          </ul>

          ${isCurrent ? `
            <button class="btn btn-secondary btn-block" disabled style="opacity: 0.85; color:#34D399; font-weight:700;">
              ✓ مستواك الحالي
            </button>
          ` : `
            <button class="btn btn-gold btn-block" onclick="upgradeToVip(${lvl.id}, '${lvl.title}')">
              ترقية الحساب إلى ${lvl.name} (${lvl.minRequiredBalance.toFixed(0)} ${cur})
            </button>
          `}
        </div>
      `;
    });

    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = `<div class="card" style="color:var(--danger);">${err.message}</div>`;
  }
}

async function upgradeToVip(levelId, title) {
  if (!confirm(`هل أنت متأكد من رغبتك بالترقية إلى ${title}؟`)) return;

  try {
    const res = await apiCall('/api/vip/upgrade', 'POST', { targetLevelId: levelId });
    showToast(res.message, 'success');
    await loadUserProfile();
    loadVipScreen();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// -----------------------------------------------------------------------------
// Wallet & Financial Ledger Screen
// -----------------------------------------------------------------------------
async function loadWalletScreen() {
  try {
    const data = await apiCall('/api/wallet/overview');
    const w = data.wallet;
    const cur = data.currency || AppState.currency;
    AppState.currency = cur;

    document.getElementById('wallet-available-val').textContent = w.availableBalance.toFixed(2);
    document.getElementById('wallet-currency-symbol').textContent = cur;
    document.getElementById('wallet-pending-val').textContent = `${w.pendingBalance.toFixed(2)} ${cur}`;
    document.getElementById('wallet-earned-val').textContent = `${w.totalEarned.toFixed(2)} ${cur}`;
    document.getElementById('wallet-withdrawn-val').textContent = `${w.totalWithdrawn.toFixed(2)} ${cur}`;

    // Populate Virtual Card
    if (AppState.user) {
      const holderEl = document.getElementById('card-holder-name');
      if (holderEl) holderEl.textContent = AppState.user.fullName;

      const vipBadgeEl = document.getElementById('card-user-vip');
      if (vipBadgeEl) vipBadgeEl.textContent = AppState.user.vipTitle || 'VIP1';

      const numEl = document.getElementById('card-number-display');
      if (numEl) numEl.textContent = `4892 •••• •••• ${String(AppState.user.id).padStart(4, '0')}`;
    }

    const eligText = document.getElementById('wallet-eligibility-text');
    if (eligText) {
      if (data.taskCompletionStatus.isEligibleToWithdraw) {
        eligText.className = 'balance-stat-val val-green';
        eligText.textContent = 'مؤهل للسحب ✓';
      } else {
        eligText.className = 'balance-stat-val val-yellow';
        eligText.textContent = `غير مؤهل (${data.taskCompletionStatus.completedToday}/${data.taskCompletionStatus.dailyLimit})`;
      }
    }

    // Check pending deposits count to update badge
    apiCall('/api/wallet/deposits').then(depData => {
      const pendingCount = (depData.deposits || []).filter(d => d.status === 'PENDING').length;
      const badge = document.getElementById('pending-deposit-badge');
      if (badge) {
        if (pendingCount > 0) {
          badge.style.display = 'inline-flex';
          badge.textContent = `${pendingCount} قيد التدقيق`;
        } else {
          badge.style.display = 'none';
        }
      }
    }).catch(e => console.warn('Badge check error:', e));

    // Render active wallet activity sub-tab (defaults to 'deposits')
    await switchWalletTab(AppState.activeWalletTab || 'deposits');

  } catch (err) {
    showToast(err.message, 'error');
  }
}

// -----------------------------------------------------------------------------
// Interactive Wallet Activity Tabs (Deposits, Transactions, Withdrawals)
// -----------------------------------------------------------------------------
async function switchWalletTab(tabName) {
  AppState.activeWalletTab = tabName;

  // Update tab buttons UI
  document.querySelectorAll('.wallet-tab-btn').forEach(btn => btn.classList.remove('active'));
  const activeBtn = document.getElementById(`wallet-subtab-${tabName}`);
  if (activeBtn) activeBtn.classList.add('active');

  const container = document.getElementById('wallet-activity-container');
  if (!container) return;

  container.innerHTML = '<div style="text-align:center; padding:20px;"><div class="spinner"></div><p style="margin-top:8px; font-size:0.75rem; color:var(--text-muted);">جاري تحميل البيانات...</p></div>';

  try {
    if (tabName === 'deposits') {
      const data = await apiCall('/api/wallet/deposits');
      AppState.userDeposits = data.deposits;
      if (data.deposits.length === 0) {
        container.innerHTML = `
          <div style="text-align:center; color:var(--text-muted); padding:24px 12px;">
            <p style="margin-bottom:8px;">لا توجد أي طلبات إيداع مسجلة حتى الآن</p>
            <button class="btn btn-gold btn-sm" onclick="openDepositModal()">+ شحن وإيداع رصيد الآن</button>
          </div>
        `;
      } else {
        container.innerHTML = data.deposits.slice(0, 5).map(d => renderDepositCard(d, true)).join('');
      }
    } else if (tabName === 'withdrawals') {
      const data = await apiCall('/api/wallet/withdrawals');
      AppState.userWithdrawals = data.withdrawals;
      if (data.withdrawals.length === 0) {
        container.innerHTML = `
          <div style="text-align:center; color:var(--text-muted); padding:24px 12px;">
            <p style="margin-bottom:8px;">لا توجد طلبات سحب مسجلة حتى الآن</p>
            <button class="btn btn-secondary btn-sm" onclick="openWithdrawModal()">طلب سحب أرباح</button>
          </div>
        `;
      } else {
        container.innerHTML = data.withdrawals.slice(0, 5).map(w => renderWithdrawalCard(w, true)).join('');
      }
    } else {
      // Transactions
      const data = await apiCall('/api/wallet/transactions');
      AppState.userTransactions = data.transactions;
      if (data.transactions.length === 0) {
        container.innerHTML = '<p style="text-align:center; color:var(--text-muted); padding:24px 12px;">لا توجد حركات مالية مسجلة</p>';
      } else {
        container.innerHTML = data.transactions.slice(0, 5).map(t => renderTransactionItem(t)).join('');
      }
    }
  } catch (err) {
    container.innerHTML = `<p style="color:var(--danger); text-align:center; padding:15px; font-size:0.8rem;">${err.message}</p>`;
  }
}

function openActiveWalletModal() {
  if (AppState.activeWalletTab === 'deposits') {
    openDepositHistoryModal();
  } else if (AppState.activeWalletTab === 'withdrawals') {
    openWithdrawHistoryModal();
  } else {
    openTransactionsModal();
  }
}

function renderTransactionItem(t) {
  const isPositive = Number(t.amount) > 0;
  const sign = isPositive ? '+' : '';
  const colorClass = isPositive ? 'val-green' : 'val-yellow';
  const dateStr = new Date(t.createdAt).toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' });

  return `
    <div class="history-item">
      <div class="history-left">
        <div class="history-icon-circle" style="color:${isPositive ? 'var(--success)' : 'var(--warning)'};">
          ${isPositive ? '↓' : '↑'}
        </div>
        <div class="history-info">
          <span class="history-desc">${t.description}</span>
          <span class="history-time">${dateStr}</span>
        </div>
      </div>
      <div class="history-amount ${colorClass}">
        ${sign}${Math.abs(t.amount).toFixed(4)} ${AppState.currency}
      </div>
    </div>
  `;
}

// -----------------------------------------------------------------------------
// Deposit / Balance Recharge Modal & Logic
// -----------------------------------------------------------------------------
async function openDepositModal() {
  const modal = document.getElementById('deposit-modal');
  await loadPaymentMethodsForDeposit();
  modal.classList.add('active');
}

function closeDepositModal() {
  document.getElementById('deposit-modal').classList.remove('active');
}

async function loadPaymentMethodsForDeposit() {
  try {
    const res = await apiCall('/api/payment-methods');
    AppState.paymentMethods = res.methods;

    const select = document.getElementById('deposit-method-select');
    select.innerHTML = res.methods.map(m => `
      <option value="${m.code}">${m.name} (أدنى إيداع ${m.minAmount} ${res.currency})</option>
    `).join('');

    onDepositMethodChange();
  } catch (e) {
    console.error('Failed to load deposit methods:', e);
  }
}

function onDepositMethodChange() {
  const select = document.getElementById('deposit-method-select');
  const code = select.value;
  const method = AppState.paymentMethods.find(m => m.code === code);
  const addrDisplay = document.getElementById('deposit-address-display');
  const instText = document.getElementById('deposit-instructions-text');
  const amountInput = document.getElementById('deposit-amount-input');

  // Realistic merchant addresses based on type
  const addresses = {
    USDT_TRC20: 'TJz8849201948201948201TRC20VIP',
    ZAIN_CASH: '+964 780 123 4567 (محفظة IQ VIP المعتمدة)',
    QI_CARD: '4820 9812 7741 0029 (مصرف الرافدين - IQ VIP)',
    BANK_TRANSFER: 'IQ88BNIQ99283019284019 (المصرف العراقي للتجارة TBI)'
  };

  if (method) {
    addrDisplay.value = addresses[code] || addresses.USDT_TRC20;
    if (method.instructions) {
      instText.textContent = method.instructions;
    } else {
      instText.textContent = 'يرجى تحويل المبلغ ثم إدخال رقم العملية أو كود الإشعار لتأكيد الشحن فوراً.';
    }
    amountInput.min = method.minAmount;
    amountInput.placeholder = `أدخل المبلغ (الحد الأدنى ${method.minAmount} ${AppState.currency})...`;
  }
}

function setQuickDepositAmount(amt) {
  const input = document.getElementById('deposit-amount-input');
  if (input) input.value = amt;
}

function copyDepositAddress() {
  const addr = document.getElementById('deposit-address-display').value;
  if (navigator.clipboard) {
    navigator.clipboard.writeText(addr).then(() => {
      showToast('تم نسخ عنوان / حساب التحويل بنجاح!', 'info');
    }).catch(() => {
      showToast('تم تحديد العنوان للنسخ', 'info');
    });
  } else {
    showToast('تم تحديد العنوان للنسخ', 'info');
  }
}

async function submitDeposit(event) {
  event.preventDefault();
  const amount = document.getElementById('deposit-amount-input').value;
  const method = document.getElementById('deposit-method-select').value;
  const transactionRef = document.getElementById('deposit-ref-input').value;
  const btn = document.getElementById('btn-submit-deposit');

  if (btn) {
    btn.disabled = true;
    btn.textContent = 'جاري إرسال وتأكيد الطلب...';
  }

  try {
    const res = await apiCall('/api/wallet/deposit', 'POST', { amount, method, transactionRef });
    closeDepositModal();
    showToast(res.message, 'success');
    document.getElementById('deposit-form').reset();
    await loadUserProfile();
    await loadWalletScreen();
    // Switch to deposits tab and open the deposit history modal so user tracks the status!
    await switchWalletTab('deposits');
    openDepositHistoryModal();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'تأكيد وإرسال طلب الشحن';
    }
  }
}

// -----------------------------------------------------------------------------
// Deposit Requests History Modal & Status Rendering
// -----------------------------------------------------------------------------
function renderDepositCard(d, isCompact = false) {
  const cur = AppState.currency || 'USDT';
  const dateStr = new Date(d.createdAt).toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' });

  let statusBadge = '';
  let borderClass = 'is-pending';
  if (d.status === 'APPROVED') {
    statusBadge = `<span class="badge-status badge-status-approved">✓ تم الاعتماد وإضافة الرصيد</span>`;
    borderClass = 'is-approved';
  } else if (d.status === 'REJECTED') {
    statusBadge = `<span class="badge-status badge-status-rejected">✕ تم الرفض</span>`;
    borderClass = 'is-rejected';
  } else {
    statusBadge = `<span class="badge-status badge-status-pending"><span class="pulse-dot"></span> قيد التدقيق والمراجعة</span>`;
    borderClass = 'is-pending';
  }

  const adminNoteHtml = d.adminNotes ? `
    <div style="margin-top: 6px; padding: 6px 10px; background: rgba(212, 175, 55, 0.08); border-radius: 4px; font-size: 0.74rem; color: var(--gold-primary); border-right: 2px solid var(--gold-primary);">
      <strong>ملاحظة الإدارة:</strong> ${d.adminNotes}
    </div>
  ` : '';

  if (isCompact) {
    return `
      <div class="deposit-item-card ${borderClass}" style="padding: 10px 12px; margin-bottom: 8px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
          <div style="display:flex; align-items:center; gap:6px;">
            <strong style="color:#FFFFFF; font-size:0.82rem;">${d.method}</strong>
            <span style="font-family:monospace; font-size:0.7rem; color:var(--text-muted); direction:ltr;">${d.code}</span>
          </div>
          ${statusBadge}
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span style="font-size:0.72rem; color:var(--text-muted); font-family:monospace; direction:ltr;">TxID: ${d.transactionRef ? (d.transactionRef.length > 18 ? d.transactionRef.substring(0, 18) + '...' : d.transactionRef) : 'مباشر'}</span>
          <span style="font-weight:800; color:var(--gold-primary); font-size:0.9rem; direction:ltr;">+${Number(d.amount).toFixed(2)} ${cur}</span>
        </div>
        ${adminNoteHtml}
      </div>
    `;
  }

  return `
    <div class="deposit-item-card ${borderClass}">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
        <div style="display:flex; align-items:center; gap:8px;">
          <span style="background:var(--navy-dark); color:var(--gold-primary); font-family:monospace; font-size:0.76rem; font-weight:700; padding:2px 8px; border-radius:4px; border:1px solid var(--navy-border); direction:ltr;">${d.code}</span>
          <strong style="color:#FFFFFF; font-size:0.86rem;">${d.method}</strong>
        </div>
        ${statusBadge}
      </div>
      <div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom:6px;">
        <span style="font-size:0.76rem; color:var(--text-muted);">المبلغ المشحون:</span>
        <span style="font-size:1.15rem; font-weight:900; color:var(--gold-primary); direction:ltr;">+${Number(d.amount).toFixed(2)} ${cur}</span>
      </div>
      <div style="display:flex; justify-content:space-between; font-size:0.74rem; color:var(--text-muted); padding-top:6px; border-top:1px dashed var(--navy-border);">
        <span style="font-family:monospace; direction:ltr;">معرف المعاملة: ${d.transactionRef || 'تحويل مباشر'}</span>
        <span>${dateStr}</span>
      </div>
      ${adminNoteHtml}
    </div>
  `;
}

async function openDepositHistoryModal() {
  const modal = document.getElementById('deposit-history-modal');
  modal.classList.add('active');
  await fetchAndRenderDepositHistory(AppState.currentDepositFilter || 'ALL');
}

function closeDepositHistoryModal() {
  document.getElementById('deposit-history-modal').classList.remove('active');
}

async function filterDeposits(status, btn) {
  AppState.currentDepositFilter = status;
  document.querySelectorAll('#deposit-history-modal .btn-sm').forEach(b => b.classList.remove('active-dep-filter', 'btn-gold'));
  if (btn) btn.classList.add('active-dep-filter', 'btn-gold');
  await fetchAndRenderDepositHistory(status);
}

async function fetchAndRenderDepositHistory(status = 'ALL') {
  const listEl = document.getElementById('deposit-history-list');
  listEl.innerHTML = '<div style="text-align:center; padding:30px;"><div class="spinner"></div><p style="margin-top:10px; color:var(--text-muted);">جاري تحميل سجل طلبات الإيداع...</p></div>';

  try {
    const data = await apiCall('/api/wallet/deposits');
    AppState.allDeposits = data.deposits;

    let filtered = data.deposits;
    if (status !== 'ALL') {
      filtered = data.deposits.filter(d => d.status === status);
    }

    if (filtered.length === 0) {
      listEl.innerHTML = '<p style="text-align:center; color:var(--text-muted); padding:40px;">لا توجد طلبات إيداع في هذا التصنيف حالياً</p>';
      return;
    }

    listEl.innerHTML = filtered.map(d => renderDepositCard(d, false)).join('');
  } catch (err) {
    listEl.innerHTML = `<p style="color:var(--danger); text-align:center; padding:20px;">${err.message}</p>`;
  }
}

// -----------------------------------------------------------------------------
// Withdrawal Requests History Modal & Status Rendering
// -----------------------------------------------------------------------------
function renderWithdrawalCard(w, isCompact = false) {
  const cur = AppState.currency || 'USDT';
  const dateStr = new Date(w.createdAt).toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' });

  let statusBadge = '';
  let borderClass = 'is-pending';
  if (w.status === 'APPROVED') {
    statusBadge = `<span class="badge-status badge-status-approved">✓ تمت المعالجة والتحويل</span>`;
    borderClass = 'is-approved';
  } else if (w.status === 'REJECTED') {
    statusBadge = `<span class="badge-status badge-status-rejected">✕ تم الرفض وإعادة الرصيد</span>`;
    borderClass = 'is-rejected';
  } else {
    statusBadge = `<span class="badge-status badge-status-pending"><span class="pulse-dot"></span> قيد المراجعة والمعالجة</span>`;
    borderClass = 'is-pending';
  }

  const adminNoteHtml = w.adminNotes ? `
    <div style="margin-top: 6px; padding: 6px 10px; background: rgba(239, 68, 68, 0.08); border-radius: 4px; font-size: 0.74rem; color: #F87171; border-right: 2px solid #F87171;">
      <strong>ملاحظة الإدارة:</strong> ${w.adminNotes}
    </div>
  ` : '';

  if (isCompact) {
    return `
      <div class="deposit-item-card ${borderClass}" style="padding: 10px 12px; margin-bottom: 8px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
          <div style="display:flex; align-items:center; gap:6px;">
            <strong style="color:#FFFFFF; font-size:0.82rem;">${w.method}</strong>
            <span style="font-family:monospace; font-size:0.7rem; color:var(--text-muted); direction:ltr;">${w.code}</span>
          </div>
          ${statusBadge}
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span style="font-size:0.72rem; color:var(--text-muted);">صافي الاستلام: ${Number(w.netAmount).toFixed(2)} ${cur}</span>
          <span style="font-weight:800; color:#F87171; font-size:0.9rem; direction:ltr;">-${Number(w.amount).toFixed(2)} ${cur}</span>
        </div>
        ${adminNoteHtml}
      </div>
    `;
  }

  return `
    <div class="deposit-item-card ${borderClass}">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
        <div style="display:flex; align-items:center; gap:8px;">
          <span style="background:var(--navy-dark); color:var(--gold-primary); font-family:monospace; font-size:0.76rem; font-weight:700; padding:2px 8px; border-radius:4px; border:1px solid var(--navy-border); direction:ltr;">${w.code}</span>
          <strong style="color:#FFFFFF; font-size:0.86rem;">${w.method}</strong>
        </div>
        ${statusBadge}
      </div>
      <div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom:6px;">
        <span style="font-size:0.76rem; color:var(--text-muted);">المبلغ المطلوب:</span>
        <span style="font-size:1.15rem; font-weight:900; color:#F87171; direction:ltr;">-${Number(w.amount).toFixed(2)} ${cur}</span>
      </div>
      <div style="display:flex; justify-content:space-between; font-size:0.74rem; color:var(--text-muted); margin-bottom:4px;">
        <span>الرسوم المقتطعة: ${Number(w.feeAmount).toFixed(2)} ${cur}</span>
        <span style="color:#34D399; font-weight:700;">صافي التحويل: ${Number(w.netAmount).toFixed(2)} ${cur}</span>
      </div>
      <div style="font-size:0.72rem; color:var(--text-muted); background:var(--bg-card); padding:4px 8px; border-radius:4px; font-family:monospace; word-break:break-all;">
        حساب الاستلام: ${w.accountDetails}
      </div>
      <div style="display:flex; justify-content:flex-end; font-size:0.72rem; color:var(--text-muted); margin-top:6px;">
        <span>${dateStr}</span>
      </div>
      ${adminNoteHtml}
    </div>
  `;
}

async function openWithdrawHistoryModal() {
  const modal = document.getElementById('withdraw-history-modal');
  modal.classList.add('active');
  await fetchAndRenderWithdrawHistory(AppState.currentWithdrawFilter || 'ALL');
}

function closeWithdrawHistoryModal() {
  document.getElementById('withdraw-history-modal').classList.remove('active');
}

async function filterWithdrawHistory(status, btn) {
  AppState.currentWithdrawFilter = status;
  document.querySelectorAll('#withdraw-history-modal .btn-sm').forEach(b => b.classList.remove('active-wdr-filter', 'btn-gold'));
  if (btn) btn.classList.add('active-wdr-filter', 'btn-gold');
  await fetchAndRenderWithdrawHistory(status);
}

async function fetchAndRenderWithdrawHistory(status = 'ALL') {
  const listEl = document.getElementById('withdraw-history-list');
  listEl.innerHTML = '<div style="text-align:center; padding:30px;"><div class="spinner"></div><p style="margin-top:10px; color:var(--text-muted);">جاري تحميل سجل طلبات السحب...</p></div>';

  try {
    const data = await apiCall('/api/wallet/withdrawals');
    AppState.allWithdrawals = data.withdrawals;

    let filtered = data.withdrawals;
    if (status !== 'ALL') {
      filtered = data.withdrawals.filter(w => w.status === status);
    }

    if (filtered.length === 0) {
      listEl.innerHTML = '<p style="text-align:center; color:var(--text-muted); padding:40px;">لا توجد طلبات سحب في هذا التصنيف حالياً</p>';
      return;
    }

    listEl.innerHTML = filtered.map(w => renderWithdrawalCard(w, false)).join('');
  } catch (err) {
    listEl.innerHTML = `<p style="color:var(--danger); text-align:center; padding:20px;">${err.message}</p>`;
  }
}

// -----------------------------------------------------------------------------
// Withdrawal Modal & Payment Methods Dynamic Handling
// -----------------------------------------------------------------------------
async function openWithdrawModal() {
  if (!AppState.wallet) return;

  const modal = document.getElementById('withdraw-modal');
  const cur = AppState.currency;
  document.getElementById('modal-available-balance').textContent = `${AppState.wallet.availableBalance.toFixed(2)} ${cur}`;

  // Check mandatory task completion condition
  const eligBox = document.getElementById('modal-eligibility-box');
  const submitBtn = document.getElementById('btn-submit-withdraw');

  const stats = AppState.stats;
  const isEligible = stats && stats.allTasksCompleted;

  if (isEligible) {
    eligBox.style.background = 'rgba(16, 185, 129, 0.12)';
    eligBox.style.border = '1px solid rgba(16, 185, 129, 0.4)';
    eligBox.style.color = '#34D399';
    eligBox.innerHTML = `
      <div style="display:flex; align-items:center; gap:8px;">
        <span style="font-size:1.2rem;">✅</span>
        <div>
          <strong>تم استيفاء شرط إكمال المهام بنجاح:</strong>
          <span>أنجزت جميع مهام اليوم (${stats.completedToday}/${stats.dailyTaskLimit}). يمكنك تقديم طلب السحب الآن.</span>
        </div>
      </div>
    `;
    submitBtn.disabled = false;
    submitBtn.textContent = 'تأكيد وتقديم طلب السحب';
    submitBtn.className = 'btn btn-gold btn-block';
  } else {
    const completed = stats ? stats.completedToday : 0;
    const limit = stats ? stats.dailyTaskLimit : 5;
    const remaining = Math.max(0, limit - completed);

    eligBox.style.background = 'rgba(239, 68, 68, 0.12)';
    eligBox.style.border = '1px solid rgba(239, 68, 68, 0.4)';
    eligBox.style.color = '#F87171';
    eligBox.innerHTML = `
      <div style="display:flex; align-items:flex-start; gap:8px;">
        <span style="font-size:1.2rem;">⚠️</span>
        <div>
          <strong>شرط السحب الإلزامي لم يكتمل:</strong>
          <p style="margin:4px 0 8px; line-height:1.4;">
            يجب عليك إكمال جميع مهام اليوم أولاً (${completed} من ${limit} مكتملة). يرجى إنجاز الـ (${remaining}) مهام المتبقية لتفعيل السحب.
          </p>
          <button type="button" class="btn btn-gold btn-sm" onclick="closeWithdrawModal(); switchTab('tasks');">
            الانتقال لإكمال المهام الآن (${remaining} متبقية)
          </button>
        </div>
      </div>
    `;
    submitBtn.disabled = true;
    submitBtn.textContent = 'السحب مقفل (أكمل جميع مهام اليوم أولاً)';
    submitBtn.className = 'btn btn-secondary btn-block';
  }

  // Load active payment methods dynamically from DB
  await loadPaymentMethodsForSelect();

  modal.classList.add('active');
}

async function loadPaymentMethodsForSelect() {
  try {
    const res = await apiCall('/api/payment-methods');
    AppState.paymentMethods = res.methods;

    const select = document.getElementById('withdraw-method-select');
    select.innerHTML = res.methods.map(m => `
      <option value="${m.code}">
        ${m.name} (رسوم ${m.feePercentage}% - أدنى سحب ${m.minAmount} ${res.currency})
      </option>
    `).join('');

    onPaymentMethodChange();
  } catch (e) {
    console.error('Failed to load payment methods:', e);
  }
}

function onPaymentMethodChange() {
  const select = document.getElementById('withdraw-method-select');
  const code = select.value;
  const method = AppState.paymentMethods.find(m => m.code === code);
  const instBox = document.getElementById('method-instructions-box');
  const amountInput = document.getElementById('withdraw-amount-input');

  if (method) {
    if (method.instructions) {
      instBox.style.display = 'block';
      instBox.innerHTML = `<strong>تعليمات السحب:</strong> ${method.instructions}`;
    } else {
      instBox.style.display = 'none';
    }
    amountInput.min = method.minAmount;
    amountInput.placeholder = `الحد الأدنى ${method.minAmount} ${AppState.currency}`;
  }
}

function closeWithdrawModal() {
  document.getElementById('withdraw-modal').classList.remove('active');
}

async function submitWithdrawal(event) {
  event.preventDefault();

  if (!AppState.stats || !AppState.stats.allTasksCompleted) {
    showToast('شرط أساسي: يجب إكمال جميع مهام اليوم أولاً لتتمكن من السحب!', 'error');
    return;
  }

  const amount = document.getElementById('withdraw-amount-input').value;
  const method = document.getElementById('withdraw-method-select').value;
  const accountDetails = document.getElementById('withdraw-account-input').value;

  try {
    const res = await apiCall('/api/wallet/withdraw', 'POST', { amount, method, accountDetails });
    closeWithdrawModal();
    showToast(res.message, 'success');
    document.getElementById('withdraw-form').reset();
    await loadUserProfile();
    await loadWalletScreen();
    // Switch to withdrawals tab and open the withdrawal history modal so user tracks the status!
    await switchWalletTab('withdrawals');
    openWithdrawHistoryModal();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// -----------------------------------------------------------------------------
// Detailed Transaction History Modal (سجل المعاملات)
// -----------------------------------------------------------------------------
async function openTransactionsModal() {
  const modal = document.getElementById('transactions-modal');
  modal.classList.add('active');
  await fetchAndRenderFullTransactions('ALL');
}

function closeTransactionsModal() {
  document.getElementById('transactions-modal').classList.remove('active');
}

async function filterTransactions(type, btn) {
  AppState.currentTxFilter = type;
  document.querySelectorAll('#transactions-modal .btn-sm').forEach(b => b.classList.remove('active-tx-filter', 'btn-gold'));
  if (btn) btn.classList.add('active-tx-filter', 'btn-gold');
  await fetchAndRenderFullTransactions(type);
}

async function fetchAndRenderFullTransactions(type = 'ALL') {
  const listEl = document.getElementById('full-transactions-list');
  listEl.innerHTML = '<div style="text-align:center; padding:30px;"><div class="spinner"></div><p style="margin-top:10px; color:var(--text-muted);">جاري تحميل سجل المعاملات...</p></div>';

  try {
    const endpoint = type === 'ALL' ? '/api/wallet/transactions' : `/api/wallet/transactions?type=${type}`;
    const data = await apiCall(endpoint);
    AppState.allTransactions = data.transactions;

    if (data.transactions.length === 0) {
      listEl.innerHTML = '<p style="text-align:center; color:var(--text-muted); padding:40px;">لا توجد معاملات مسجلة في هذا التصنيف</p>';
      return;
    }

    listEl.innerHTML = data.transactions.map(t => {
      const isPos = Number(t.amount) > 0;
      const dateStr = new Date(t.createdAt).toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' });
      return `
        <div class="card" style="margin-bottom:8px; padding:12px 14px; background:var(--bg-surface); border:1px solid var(--navy-border);">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
            <strong style="color:#FFFFFF; font-size:0.85rem;">${t.description}</strong>
            <span style="font-weight:800; direction:ltr; color:${isPos ? 'var(--success)' : 'var(--warning)'}; font-size:0.95rem;">
              ${isPos ? '+' : ''}${Number(t.amount).toFixed(4)} ${AppState.currency}
            </span>
          </div>
          <div style="display:flex; justify-content:space-between; font-size:0.72rem; color:var(--text-muted);">
            <span>الرصيد قبل: ${Number(t.balanceBefore).toFixed(2)} ${AppState.currency}</span>
            <span>الرصيد بعد: ${Number(t.balanceAfter).toFixed(2)} ${AppState.currency}</span>
            <span>${dateStr}</span>
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    listEl.innerHTML = `<p style="color:var(--danger); text-align:center; padding:20px;">${err.message}</p>`;
  }
}

// -----------------------------------------------------------------------------
// Profile Screen
// -----------------------------------------------------------------------------
function loadProfileScreen() {
  if (!AppState.user) return;
  document.getElementById('profile-name').textContent = AppState.user.fullName;
  document.getElementById('profile-email').textContent = AppState.user.email;
  document.getElementById('profile-phone').textContent = AppState.user.phone;
  document.getElementById('profile-vip').textContent = AppState.user.vipTitle;
  document.getElementById('profile-referral').textContent = AppState.user.referralCode || 'VIP-REG';

  const adminLink = document.getElementById('profile-admin-link');
  if (adminLink) {
    if (AppState.user.role === 'ADMIN' || AppState.user.role === 'SUPER_ADMIN') {
      adminLink.style.display = 'flex';
      adminLink.style.alignItems = 'center';
      adminLink.style.justifyContent = 'center';
      adminLink.style.gap = '8px';
    } else {
      adminLink.style.display = 'none';
    }
  }
}

// -----------------------------------------------------------------------------
// Authentication Modals & Logic
// -----------------------------------------------------------------------------
function showAuthModal(mode = 'login') {
  const modal = document.getElementById('auth-modal');
  modal.classList.add('active');

  const loginTab = document.getElementById('auth-tab-login');
  const regTab = document.getElementById('auth-tab-register');
  const loginForm = document.getElementById('form-login');
  const regForm = document.getElementById('form-register');

  if (mode === 'login') {
    loginTab.classList.add('active');
    regTab.classList.remove('active');
    loginForm.style.display = 'block';
    regForm.style.display = 'none';
  } else {
    regTab.classList.add('active');
    loginTab.classList.remove('active');
    regForm.style.display = 'block';
    loginForm.style.display = 'none';
  }
}

function closeAuthModal() {
  if (!AppState.token) {
    showToast('يجب تسجيل الدخول لاستخدام ميزات المنصة', 'error');
    return;
  }
  document.getElementById('auth-modal').classList.remove('active');
}

async function handleLogin(e) {
  e.preventDefault();
  const loginId = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const suspendedAlert = document.getElementById('auth-suspended-alert');
  if (suspendedAlert) suspendedAlert.style.display = 'none';

  try {
    const data = await apiCall('/api/auth/login', 'POST', { loginId, password });
    AppState.token = data.token;
    localStorage.setItem('iq_vip_token', data.token);
    document.getElementById('auth-modal').classList.remove('active');
    showToast('تم تسجيل الدخول بنجاح!', 'success');
    await loadUserProfile();
    switchTab('home');
    // Refresh support messages with user context
    loadSupportMessages(false);
  } catch (err) {
    const isSuspended = (err.data && (err.data.isSuspended || (err.data.error && err.data.error.includes('تم تجميد حسابك')))) ||
                        (err.message && err.message.includes('تم تجميد حسابك'));

    if (isSuspended) {
      if (suspendedAlert) {
        suspendedAlert.style.display = 'block';
      }
      AppState.lastSuspendedIdentifier = loginId;
      showToast('تم تجميد حسابك، يرجى التواصل معنا', 'error');
    } else {
      showToast(err.message, 'error');
    }
  }
}

async function handleRegister(e) {
  e.preventDefault();
  const fullName = document.getElementById('reg-fullname').value;
  const email = document.getElementById('reg-email').value;
  const phone = document.getElementById('reg-phone').value;
  const password = document.getElementById('reg-password').value;
  const referralCode = document.getElementById('reg-referral').value;

  try {
    const data = await apiCall('/api/auth/register', 'POST', {
      fullName, email, phone, password, referralCode
    });
    AppState.token = data.token;
    localStorage.setItem('iq_vip_token', data.token);
    document.getElementById('auth-modal').classList.remove('active');
    showToast('تم إنشاء الحساب بنجاح!', 'success');
    await loadUserProfile();
    switchTab('home');
    loadSupportMessages(false);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function logout() {
  AppState.token = null;
  AppState.user = null;
  AppState.wallet = null;
  localStorage.removeItem('iq_vip_token');
  showAuthModal('login');
}

// -----------------------------------------------------------------------------
// Live Customer Support System (خدمة العملاء والمحادثة المباشرة)
// -----------------------------------------------------------------------------
function getSupportSessionId() {
  let sess = localStorage.getItem('iq_support_session');
  if (!sess) {
    sess = 'sess_' + Math.random().toString(36).substring(2, 11) + Date.now().toString(36);
    localStorage.setItem('iq_support_session', sess);
  }
  return sess;
}

let supportPollTimer = null;

function toggleSupportChatModal(forceOpen = null) {
  const modal = document.getElementById('support-chat-modal');
  if (!modal) return;

  const shouldOpen = forceOpen !== null ? forceOpen : !modal.classList.contains('active');

  if (shouldOpen) {
    modal.classList.add('active');
    // If user is not logged in, show guest identifier inputs
    const guestRow = document.getElementById('support-guest-info-row');
    if (guestRow) {
      if (!AppState.token) {
        guestRow.style.display = 'block';
        if (AppState.lastSuspendedIdentifier) {
          const contactIn = document.getElementById('support-guest-contact');
          if (contactIn && !contactIn.value) contactIn.value = AppState.lastSuspendedIdentifier;
        }
      } else {
        guestRow.style.display = 'none';
      }
    }
    loadSupportMessages(true);
    // Start poll timer every 4 seconds while modal is open
    clearInterval(supportPollTimer);
    supportPollTimer = setInterval(() => {
      if (modal.classList.contains('active')) {
        loadSupportMessages(false);
      }
    }, 4000);
  } else {
    modal.classList.remove('active');
    clearInterval(supportPollTimer);
  }
}

async function loadSupportMessages(isManual = false) {
  const messagesWrap = document.getElementById('support-messages-wrap');
  if (!messagesWrap) return;

  const sessionId = getSupportSessionId();

  try {
    const res = await apiCall(`/api/support/messages?sessionId=${encodeURIComponent(sessionId)}`);
    const messages = res.messages || [];

    // Check unread badge
    const badge = document.getElementById('support-unread-badge');
    if (badge) {
      const modal = document.getElementById('support-chat-modal');
      const isModalOpen = modal && modal.classList.contains('active');
      if (res.conversation && res.conversation.unread_user > 0 && !isModalOpen) {
        badge.textContent = res.conversation.unread_user;
        badge.style.display = 'inline-block';
      } else if (isModalOpen) {
        badge.style.display = 'none';
      }
    }

    if (messages.length === 0) {
      // Default welcome bubble
      messagesWrap.innerHTML = `
        <div class="chat-bubble support">
          <span class="chat-bubble-sender">مساعد خدمة العملاء</span>
          مرحباً بك! 👋 كيف يمكننا مساعدتك اليوم؟ إذا واجهت أي مشكلة في الحساب، المهام، شحن الرصيد أو السحب، يسعدنا حلها لك فوراً.
          <span class="chat-bubble-time">الآن</span>
        </div>
      `;
      return;
    }

    const html = messages.map(m => {
      const isUser = m.sender_type === 'USER';
      const senderTitle = isUser ? (m.sender_name || 'أنت') : 'فريق خدمة العملاء';
      const timeStr = m.created_at ? new Date(m.created_at).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }) : '';

      return `
        <div class="chat-bubble ${isUser ? 'user' : 'support'}">
          <span class="chat-bubble-sender">${senderTitle}</span>
          ${m.message}
          <span class="chat-bubble-time">${timeStr}</span>
        </div>
      `;
    }).join('');

    messagesWrap.innerHTML = html;
    messagesWrap.scrollTop = messagesWrap.scrollHeight;
  } catch (err) {
    if (isManual) {
      console.warn('Failed to fetch support messages:', err);
    }
  }
}

async function handleSendSupportMessage(e) {
  e.preventDefault();
  const input = document.getElementById('support-msg-input');
  const btn = document.getElementById('support-send-btn');
  if (!input) return;

  const message = input.value.trim();
  if (!message) return;

  const sessionId = getSupportSessionId();
  let senderName = AppState.user ? AppState.user.fullName : '';
  let senderContact = AppState.user ? (AppState.user.email || AppState.user.phone) : '';

  if (!AppState.token) {
    const nameEl = document.getElementById('support-guest-name');
    const contactEl = document.getElementById('support-guest-contact');
    if (nameEl && nameEl.value.trim()) senderName = nameEl.value.trim();
    if (contactEl && contactEl.value.trim()) senderContact = contactEl.value.trim();
    if (!senderContact && AppState.lastSuspendedIdentifier) {
      senderContact = AppState.lastSuspendedIdentifier;
    }
  }

  // Pre-append bubble immediately to feel ultra responsive
  const messagesWrap = document.getElementById('support-messages-wrap');
  if (messagesWrap) {
    const tempBubble = document.createElement('div');
    tempBubble.className = 'chat-bubble user';
    tempBubble.innerHTML = `
      <span class="chat-bubble-sender">${senderName || 'أنت'}</span>
      ${message}
      <span class="chat-bubble-time">جاري الإرسال...</span>
    `;
    messagesWrap.appendChild(tempBubble);
    messagesWrap.scrollTop = messagesWrap.scrollHeight;
  }

  input.value = '';
  if (btn) btn.disabled = true;

  try {
    await apiCall('/api/support/send', 'POST', {
      sessionId,
      message,
      senderName,
      senderContact
    });
    SoundFX.playTone(800, 'sine', 0.08, 0.1);
    await loadSupportMessages(false);
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

function quickFillSupport(text) {
  const input = document.getElementById('support-msg-input');
  if (input) {
    input.value = text;
    input.focus();
  }
}

function openSupportForSuspendedAccount() {
  const loginInput = document.getElementById('login-email');
  const ident = loginInput ? loginInput.value.trim() : (AppState.lastSuspendedIdentifier || '');
  
  toggleSupportChatModal(true);

  const contactEl = document.getElementById('support-guest-contact');
  if (contactEl && ident) {
    contactEl.value = ident;
  }
  const input = document.getElementById('support-msg-input');
  if (input) {
    input.value = `طلب فك تجميد الحساب: حسابي (${ident}) مقيد، أرجو من خدمة العملاء الكرام مراجعة الحساب وإلغاء التجميد.`;
    input.focus();
  }
}

// -----------------------------------------------------------------------------
// App Initialization
// -----------------------------------------------------------------------------
window.addEventListener('DOMContentLoaded', () => {
  // Navigation tabs click listeners
  document.querySelectorAll('.bottom-nav .nav-tab').forEach(tab => {
    tab.addEventListener('click', (e) => {
      e.preventDefault();
      switchTab(tab.dataset.tab);
    });
  });

  // Check auth session
  if (AppState.token) {
    loadUserProfile();
  } else {
    showAuthModal('login');
  }

  // Initial check for support notifications and keep checking every 30s
  loadSupportMessages(false);
  setInterval(() => {
    const modal = document.getElementById('support-chat-modal');
    if (!modal || !modal.classList.contains('active')) {
      loadSupportMessages(false);
    }
  }, 30000);
});
