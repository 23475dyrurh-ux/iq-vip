// ==============================================================================
// IQ VIP Platform - Server Middleware
// ==============================================================================

const { verifyToken } = require('./utils/security');
const { queryOne } = require('../database/db');

/**
 * Authenticate incoming request using Authorization: Bearer <token>
 */
function authenticate(req, res, next) {
  const authHeader = req.headers['authorization'];
  let token = null;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  } else if (req.headers.cookie) {
    const match = req.headers.cookie.match(/token=([^;]+)/);
    if (match) token = match[1];
  }

  if (!token) {
    res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ error: 'يرجى تسجيل الدخول أولاً للوصول إلى هذه الخدمة' }));
  }

  const decoded = verifyToken(token);
  if (!decoded) {
    res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ error: 'انتهت صلاحية الجلسة، يرجى تسجيل الدخول مجدداً' }));
  }

  // Verify user still exists and is ACTIVE
  const user = queryOne('SELECT id, full_name, email, phone, role, vip_level_id, is_demo, status FROM users WHERE id = ?', [decoded.id]);
  if (!user) {
    res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ error: 'المستخدم غير موجود' }));
  }

  if (user.status === 'SUSPENDED') {
    res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ 
      error: 'تم تجميد حسابك، يرجى التواصل معنا',
      isSuspended: true 
    }));
  }

  req.user = user;
  next();
}

/**
 * Require ADMIN or SUPER_ADMIN role
 */
function requireAdmin(req, res, next) {
  authenticate(req, res, () => {
    if (req.user.role !== 'ADMIN' && req.user.role !== 'SUPER_ADMIN') {
      res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ error: 'غير مصرح لك بالدخول، تتطلب هذه الصفحة صلاحيات إدارية' }));
    }
    next();
  });
}

/**
 * Parse JSON body helper
 */
function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
      if (body.length > 1e6) { // 1MB limit
        reject(new Error('حجم البيانات كبير جداً'));
      }
    });
    req.on('end', () => {
      if (!body.trim()) return resolve({});
      try {
        const parsed = JSON.parse(body);
        resolve(parsed);
      } catch (err) {
        reject(new Error('صيغة البيانات غير صالحة (JSON غير سليم)'));
      }
    });
    req.on('error', err => reject(err));
  });
}

/**
 * Standard JSON response helper
 */
function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  });
  res.end(JSON.stringify(data));
}

module.exports = {
  authenticate,
  requireAdmin,
  parseJsonBody,
  sendJson,
};
