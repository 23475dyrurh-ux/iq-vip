// ==============================================================================
// IQ VIP Platform - Core HTTP Server & REST Router
// ==============================================================================

const http = require('node:http');
const url = require('node:url');
const fs = require('node:fs');
const path = require('node:path');

const { seedDatabase } = require('../database/seed');
const { authenticate, requireAdmin, parseJsonBody, sendJson } = require('./middleware');

// Controllers
const authController = require('./controllers/authController');
const taskController = require('./controllers/taskController');
const walletController = require('./controllers/walletController');
const vipController = require('./controllers/vipController');
const adminController = require('./controllers/adminController');
const supportController = require('./controllers/supportController');

const PORT = parseInt(process.env.PORT, 10) || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// Ensure database is initialized & seeded
try {
  seedDatabase();
} catch (e) {
  console.error('Database initialization note:', e.message);
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

const server = http.createServer(async (req, res) => {
  // CORS Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    });
    return res.end();
  }

  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  const method = req.method.toUpperCase();

  // --------------------------------------------------------------------------
  // API ROUTING
  // --------------------------------------------------------------------------
  if (pathname.startsWith('/api/')) {
    // 1. Auth Endpoints
    if (pathname === '/api/auth/register' && method === 'POST') {
      const body = await parseJsonBody(req);
      return authController.register(req, res, body);
    }
    if (pathname === '/api/auth/login' && method === 'POST') {
      const body = await parseJsonBody(req);
      return authController.login(req, res, body);
    }
    if (pathname === '/api/auth/profile' && method === 'GET') {
      return authenticate(req, res, () => authController.getProfile(req, res));
    }
    if (pathname === '/api/auth/recover-password' && method === 'POST') {
      const body = await parseJsonBody(req);
      return authController.requestPasswordRecovery(req, res, body);
    }
    if (pathname === '/api/auth/reset-password' && method === 'POST') {
      const body = await parseJsonBody(req);
      return authController.resetPassword(req, res, body);
    }

    // 2. Task System Endpoints
    if (pathname === '/api/tasks/available' && method === 'GET') {
      return authenticate(req, res, () => taskController.getAvailableTask(req, res));
    }
    if (pathname === '/api/tasks/start' && method === 'POST') {
      return authenticate(req, res, async () => {
        const body = await parseJsonBody(req);
        return taskController.startTask(req, res, body);
      });
    }
    if (pathname === '/api/tasks/complete' && method === 'POST') {
      return authenticate(req, res, async () => {
        const body = await parseJsonBody(req);
        return taskController.completeTask(req, res, body);
      });
    }
    if (pathname === '/api/tasks/history' && method === 'GET') {
      return authenticate(req, res, () => taskController.getTaskHistory(req, res));
    }

    // 3. Wallet & Financial Endpoints
    if (pathname === '/api/payment-methods' && method === 'GET') {
      return walletController.getPaymentMethods(req, res);
    }
    if (pathname === '/api/wallet/overview' && method === 'GET') {
      return authenticate(req, res, () => walletController.getWalletOverview(req, res));
    }
    if (pathname === '/api/wallet/transactions' && method === 'GET') {
      return authenticate(req, res, () => walletController.getTransactions(req, res, parsedUrl.query));
    }
    if (pathname === '/api/wallet/withdraw' && method === 'POST') {
      return authenticate(req, res, async () => {
        const body = await parseJsonBody(req);
        return walletController.requestWithdrawal(req, res, body);
      });
    }
    if (pathname === '/api/wallet/withdrawals' && method === 'GET') {
      return authenticate(req, res, () => walletController.getWithdrawalHistory(req, res));
    }
    if (pathname === '/api/wallet/deposit' && method === 'POST') {
      return authenticate(req, res, async () => {
        const body = await parseJsonBody(req);
        return walletController.requestDeposit(req, res, body);
      });
    }
    if (pathname === '/api/wallet/deposits' && method === 'GET') {
      return authenticate(req, res, () => walletController.getDepositHistory(req, res));
    }

    // 4. VIP Membership Endpoints
    if (pathname === '/api/vip/levels' && method === 'GET') {
      // Optional authentication to personalize eligibility
      const authHeader = req.headers['authorization'];
      if (authHeader && authHeader.startsWith('Bearer ')) {
        return authenticate(req, res, () => vipController.getVipLevels(req, res));
      }
      return vipController.getVipLevels(req, res);
    }
    if (pathname === '/api/vip/upgrade' && method === 'POST') {
      return authenticate(req, res, async () => {
        const body = await parseJsonBody(req);
        return vipController.upgradeVip(req, res, body);
      });
    }

    // 5. Admin Endpoints (Guarded by requireAdmin)
    if (pathname === '/api/admin/stats' && method === 'GET') {
      return requireAdmin(req, res, () => adminController.getAdminStats(req, res));
    }
    if (pathname === '/api/admin/users' && method === 'GET') {
      return requireAdmin(req, res, () => adminController.getUsersList(req, res, parsedUrl.query));
    }
    if (pathname === '/api/admin/users/update' && method === 'POST') {
      return requireAdmin(req, res, async () => {
        const body = await parseJsonBody(req);
        return adminController.updateUser(req, res, body);
      });
    }
    if (pathname === '/api/admin/products' && method === 'GET') {
      return requireAdmin(req, res, () => adminController.getProducts(req, res));
    }
    if (pathname === '/api/admin/products/add' && method === 'POST') {
      return requireAdmin(req, res, async () => {
        const body = await parseJsonBody(req);
        return adminController.addProduct(req, res, body);
      });
    }
    if (pathname === '/api/admin/products/update' && method === 'POST') {
      return requireAdmin(req, res, async () => {
        const body = await parseJsonBody(req);
        return adminController.updateProduct(req, res, body);
      });
    }
    if (pathname === '/api/admin/products/delete' && method === 'POST') {
      return requireAdmin(req, res, async () => {
        const body = await parseJsonBody(req);
        return adminController.deleteProduct(req, res, body);
      });
    }
    if (pathname === '/api/admin/withdrawals' && method === 'GET') {
      return requireAdmin(req, res, () => adminController.getWithdrawals(req, res, parsedUrl.query));
    }
    if (pathname === '/api/admin/withdrawals/approve' && method === 'POST') {
      return requireAdmin(req, res, async () => {
        const body = await parseJsonBody(req);
        return adminController.handleApproveWithdrawal(req, res, body);
      });
    }
    if (pathname === '/api/admin/withdrawals/reject' && method === 'POST') {
      return requireAdmin(req, res, async () => {
        const body = await parseJsonBody(req);
        return adminController.handleRejectWithdrawal(req, res, body);
      });
    }
    if (pathname === '/api/admin/deposits' && method === 'GET') {
      return requireAdmin(req, res, () => adminController.getDeposits(req, res, parsedUrl.query));
    }
    if (pathname === '/api/admin/deposits/approve' && method === 'POST') {
      return requireAdmin(req, res, async () => {
        const body = await parseJsonBody(req);
        return adminController.handleApproveDeposit(req, res, body);
      });
    }
    if (pathname === '/api/admin/deposits/reject' && method === 'POST') {
      return requireAdmin(req, res, async () => {
        const body = await parseJsonBody(req);
        return adminController.handleRejectDeposit(req, res, body);
      });
    }
    if (pathname === '/api/admin/vip/update' && method === 'POST') {
      return requireAdmin(req, res, async () => {
        const body = await parseJsonBody(req);
        return adminController.updateVipLevel(req, res, body);
      });
    }
    if (pathname === '/api/admin/settings' && method === 'GET') {
      return requireAdmin(req, res, () => adminController.getSettings(req, res));
    }
    if (pathname === '/api/admin/settings/update' && method === 'POST') {
      return requireAdmin(req, res, async () => {
        const body = await parseJsonBody(req);
        return adminController.updateSettings(req, res, body);
      });
    }
    if (pathname === '/api/admin/audit-logs' && method === 'GET') {
      return requireAdmin(req, res, () => adminController.getAuditLogs(req, res));
    }
    if (pathname === '/api/admin/transactions' && method === 'GET') {
      return requireAdmin(req, res, () => adminController.getAllLedgerTransactions(req, res));
    }
    if (pathname === '/api/admin/payment-methods' && method === 'GET') {
      return requireAdmin(req, res, () => adminController.getAdminPaymentMethods(req, res));
    }
    if (pathname === '/api/admin/payment-methods/add' && method === 'POST') {
      return requireAdmin(req, res, async () => {
        const body = await parseJsonBody(req);
        return adminController.addPaymentMethod(req, res, body);
      });
    }
    if (pathname === '/api/admin/payment-methods/update' && method === 'POST') {
      return requireAdmin(req, res, async () => {
        const body = await parseJsonBody(req);
        return adminController.updatePaymentMethod(req, res, body);
      });
    }
    if (pathname === '/api/admin/payment-methods/toggle' && method === 'POST') {
      return requireAdmin(req, res, async () => {
        const body = await parseJsonBody(req);
        return adminController.togglePaymentMethod(req, res, body);
      });
    }

    // 6. Live Chat Customer Support Endpoints
    if (pathname === '/api/support/messages' && method === 'GET') {
      const authHeader = req.headers['authorization'];
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const { verifyToken } = require('./utils/security');
        const { queryOne } = require('../database/db');
        const decoded = verifyToken(authHeader.substring(7));
        if (decoded) {
          req.user = queryOne('SELECT id, full_name, email, phone, role, status FROM users WHERE id = ?', [decoded.id]);
        }
      }
      return supportController.getMessages(req, res, parsedUrl);
    }
    if (pathname === '/api/support/send' && method === 'POST') {
      const authHeader = req.headers['authorization'];
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const { verifyToken } = require('./utils/security');
        const { queryOne } = require('../database/db');
        const decoded = verifyToken(authHeader.substring(7));
        if (decoded) {
          req.user = queryOne('SELECT id, full_name, email, phone, role, status FROM users WHERE id = ?', [decoded.id]);
        }
      }
      const body = await parseJsonBody(req);
      return supportController.sendMessage(req, res, body);
    }

    // Admin Support Endpoints
    if (pathname === '/api/admin/support/conversations' && method === 'GET') {
      return requireAdmin(req, res, () => supportController.getAdminConversations(req, res));
    }
    if (pathname.startsWith('/api/admin/support/conversation/') && method === 'GET') {
      const convId = parseInt(pathname.split('/')[5], 10);
      return requireAdmin(req, res, () => supportController.getAdminConversationMessages(req, res, convId));
    }
    if (pathname === '/api/admin/support/reply' && method === 'POST') {
      return requireAdmin(req, res, async () => {
        const body = await parseJsonBody(req);
        return supportController.adminReply(req, res, body);
      });
    }
    if (pathname === '/api/admin/support/status' && method === 'POST') {
      return requireAdmin(req, res, async () => {
        const body = await parseJsonBody(req);
        return supportController.adminUpdateStatus(req, res, body);
      });
    }

    // Default 404 for unhandled API routes
    return sendJson(res, 404, { error: 'نقطة النهاية المطلوبة غير موجودة في الـ API' });
  }

  // --------------------------------------------------------------------------
  // STATIC ASSETS SERVING
  // --------------------------------------------------------------------------
  let safePath = pathname;
  if (safePath === '/' || safePath === '') {
    safePath = 'index.html';
  } else if (safePath === '/admin' || safePath === '/admin/') {
    safePath = 'admin.html';
  } else {
    safePath = safePath.replace(/^\/+/, '');
  }

  const filePath = path.join(PUBLIC_DIR, safePath);

  // Check if file exists within public dir
  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      // Fallback for SPA routing: serve index.html
      const fallbackPath = path.join(PUBLIC_DIR, 'index.html');
      fs.readFile(fallbackPath, (fbErr, content) => {
        if (fbErr) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          return res.end('الملف غير موجود');
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(content);
      });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(filePath, (readErr, content) => {
      if (readErr) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('خطأ أثناء قراءة الملف');
      }
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    });
  });
});

if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`=======================================================`);
    console.log(` IQ VIP Task Platform Server is RUNNING!`);
    console.log(` App URL:        http://localhost:${PORT}`);
    console.log(` Admin Portal:   http://localhost:${PORT}/admin`);
    console.log(` Admin Account:  admin@iqvip.com / Admin@123456`);
    console.log(` Demo Account:   demo@iqvip.com / Demo@123456`);
    console.log(`=======================================================`);
  });
}

module.exports = server;
