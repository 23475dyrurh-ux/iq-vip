// ==============================================================================
// IQ VIP Platform - Live Chat Customer Support Controller
// Features: Real-time user support, unread badges, user context (VIP, balance, status),
// admin reply inbox, and suspended account support assistance.
// ==============================================================================

const { query, queryOne, execute, transaction } = require('../../database/db');
const { sendJson } = require('../middleware');

/**
 * Get messages for a user session / conversation
 */
async function getMessages(req, res, parsedUrl) {
  try {
    const sessionId = parsedUrl.query.sessionId;
    const userId = req.user ? req.user.id : null;

    if (!sessionId && !userId) {
      return sendJson(res, 400, { error: 'معرف الجلسة مطلوب للوصول للمحادثة' });
    }

    // Find conversation by user_id or session_id
    let conv = null;
    if (userId) {
      conv = queryOne('SELECT * FROM support_conversations WHERE user_id = ? ORDER BY id DESC LIMIT 1', [userId]);
    }
    if (!conv && sessionId) {
      conv = queryOne('SELECT * FROM support_conversations WHERE session_id = ? LIMIT 1', [sessionId]);
    }

    if (!conv) {
      return sendJson(res, 200, {
        conversation: null,
        messages: []
      });
    }

    // Clear unread count for user
    execute('UPDATE support_conversations SET unread_user = 0 WHERE id = ?', [conv.id]);

    const messages = query(`
      SELECT id, conversation_id, sender_type, sender_name, message, created_at
      FROM support_messages
      WHERE conversation_id = ?
      ORDER BY id ASC
    `, [conv.id]);

    return sendJson(res, 200, {
      conversation: {
        id: conv.id,
        sessionId: conv.session_id,
        status: conv.status,
        subject: conv.subject,
        unreadUser: 0,
        lastMessageAt: conv.last_message_at
      },
      messages
    });
  } catch (err) {
    console.error('getMessages error:', err);
    return sendJson(res, 500, { error: 'حدث خطأ أثناء تحميل رسائل المحادثة' });
  }
}

/**
 * User sends a message to Customer Support
 */
async function sendMessage(req, res, body) {
  try {
    const { sessionId, message, senderName, senderContact, subject } = body;

    if (!message || !message.trim()) {
      return sendJson(res, 400, { error: 'لا يمكن إرسال رسالة فارغة' });
    }

    const userId = req.user ? req.user.id : null;
    const finalSessionId = sessionId || (userId ? `USER-${userId}` : `GUEST-${Date.now()}`);

    let name = senderName ? senderName.trim() : 'مستخدم المنصة';
    let contact = senderContact ? senderContact.trim() : '';

    if (req.user) {
      name = req.user.full_name || name;
      contact = req.user.email || req.user.phone || contact;
    }

    // Find or create conversation
    let conv = null;
    if (userId) {
      conv = queryOne('SELECT * FROM support_conversations WHERE user_id = ? ORDER BY id DESC LIMIT 1', [userId]);
    }
    if (!conv) {
      conv = queryOne('SELECT * FROM support_conversations WHERE session_id = ? LIMIT 1', [finalSessionId]);
    }

    let convId;
    if (!conv) {
      const insertRes = execute(`
        INSERT INTO support_conversations (session_id, user_id, sender_name, sender_contact, subject, status, unread_admin, unread_user, last_message_at)
        VALUES (?, ?, ?, ?, ?, 'OPEN', 1, 0, datetime('now'))
      `, [finalSessionId, userId, name, contact, subject || 'طلب مساعدة فنية']);
      convId = insertRes.lastInsertRowid;
    } else {
      convId = conv.id;
      execute(`
        UPDATE support_conversations 
        SET unread_admin = unread_admin + 1, 
            status = 'OPEN',
            last_message_at = datetime('now'),
            user_id = coalesce(?, user_id),
            sender_name = coalesce(?, sender_name),
            sender_contact = coalesce(?, sender_contact)
        WHERE id = ?
      `, [userId, name, contact, convId]);
    }

    // Insert user message
    const msgRes = execute(`
      INSERT INTO support_messages (conversation_id, sender_type, sender_id, sender_name, message, is_read, created_at)
      VALUES (?, 'USER', ?, ?, ?, 0, datetime('now'))
    `, [convId, userId, name, message.trim()]);

    const insertedMsg = queryOne('SELECT * FROM support_messages WHERE id = ?', [msgRes.lastInsertRowid]);

    return sendJson(res, 201, {
      success: true,
      conversationId: convId,
      sessionId: finalSessionId,
      message: {
        id: insertedMsg.id,
        senderType: insertedMsg.sender_type,
        senderName: insertedMsg.sender_name,
        message: insertedMsg.message,
        createdAt: insertedMsg.created_at
      }
    });
  } catch (err) {
    console.error('sendMessage error:', err);
    return sendJson(res, 500, { error: 'فشل إرسال رسالتك، يرجى المحاولة لاحقاً' });
  }
}

/**
 * Admin: List all support conversations with user context
 */
async function getAdminConversations(req, res) {
  try {
    const conversations = query(`
      SELECT sc.*, 
             u.full_name as user_full_name, u.email as user_email, u.phone as user_phone, 
             u.status as user_status, u.role as user_role,
             v.display_name_ar as vip_title,
             w.available_balance,
             (SELECT message FROM support_messages WHERE conversation_id = sc.id ORDER BY id DESC LIMIT 1) as last_message_snippet
      FROM support_conversations sc
      LEFT JOIN users u ON sc.user_id = u.id
      LEFT JOIN vip_levels v ON u.vip_level_id = v.id
      LEFT JOIN wallets w ON u.id = w.user_id
      ORDER BY sc.last_message_at DESC
    `);

    const currencySetting = queryOne("SELECT value FROM system_settings WHERE key = 'platform_currency'");
    const currency = currencySetting ? currencySetting.value : 'USDT';

    return sendJson(res, 200, {
      currency,
      conversations: conversations.map(c => ({
        id: c.id,
        sessionId: c.session_id,
        userId: c.user_id,
        senderName: c.user_full_name || c.sender_name,
        senderContact: c.user_email || c.sender_contact || c.user_phone,
        userStatus: c.user_status || 'GUEST',
        vipTitle: c.vip_title || 'زائر',
        availableBalance: c.available_balance !== null ? Number(c.available_balance) : null,
        subject: c.subject,
        status: c.status,
        unreadAdmin: c.unread_admin,
        unreadUser: c.unread_user,
        lastMessageSnippet: c.last_message_snippet,
        lastMessageAt: c.last_message_at,
        createdAt: c.created_at
      }))
    });
  } catch (err) {
    console.error('getAdminConversations error:', err);
    return sendJson(res, 500, { error: 'حدث خطأ أثناء تحميل محادثات خدمة العملاء' });
  }
}

/**
 * Admin: Get messages for a specific conversation
 */
async function getAdminConversationMessages(req, res, conversationId) {
  try {
    const conv = queryOne(`
      SELECT sc.*, 
             u.full_name as user_full_name, u.email as user_email, u.phone as user_phone, 
             u.status as user_status, u.role as user_role,
             v.display_name_ar as vip_title,
             w.available_balance
      FROM support_conversations sc
      LEFT JOIN users u ON sc.user_id = u.id
      LEFT JOIN vip_levels v ON u.vip_level_id = v.id
      LEFT JOIN wallets w ON u.id = w.user_id
      WHERE sc.id = ?
    `, [conversationId]);

    if (!conv) {
      return sendJson(res, 404, { error: 'المحادثة غير موجودة' });
    }

    // Mark unread for admin as 0
    execute('UPDATE support_conversations SET unread_admin = 0 WHERE id = ?', [conversationId]);
    execute("UPDATE support_messages SET is_read = 1 WHERE conversation_id = ? AND sender_type = 'USER'", [conversationId]);

    const messages = query(`
      SELECT id, conversation_id, sender_type, sender_name, message, created_at
      FROM support_messages
      WHERE conversation_id = ?
      ORDER BY id ASC
    `, [conversationId]);

    return sendJson(res, 200, {
      conversation: {
        id: conv.id,
        sessionId: conv.session_id,
        userId: conv.user_id,
        senderName: conv.user_full_name || conv.sender_name,
        senderContact: conv.user_email || conv.sender_contact || conv.user_phone,
        userStatus: conv.user_status || 'GUEST',
        vipTitle: conv.vip_title || 'زائر',
        availableBalance: conv.available_balance !== null ? Number(conv.available_balance) : null,
        status: conv.status,
        subject: conv.subject,
        lastMessageAt: conv.last_message_at
      },
      messages
    });
  } catch (err) {
    console.error('getAdminConversationMessages error:', err);
    return sendJson(res, 500, { error: 'حدث خطأ أثناء تحميل الرسائل' });
  }
}

/**
 * Admin replies to a conversation
 */
async function adminReply(req, res, body) {
  try {
    const { conversationId, message } = body;

    if (!conversationId || !message || !message.trim()) {
      return sendJson(res, 400, { error: 'معرف المحادثة ونص الرد مطلوبان' });
    }

    const conv = queryOne('SELECT id FROM support_conversations WHERE id = ?', [conversationId]);
    if (!conv) {
      return sendJson(res, 404, { error: 'المحادثة غير موجودة' });
    }

    const adminName = req.user ? req.user.full_name : 'خدمة العملاء VIP';

    const msgRes = execute(`
      INSERT INTO support_messages (conversation_id, sender_type, sender_id, sender_name, message, is_read, created_at)
      VALUES (?, 'ADMIN', ?, ?, ?, 0, datetime('now'))
    `, [conversationId, req.user ? req.user.id : null, adminName, message.trim()]);

    execute(`
      UPDATE support_conversations 
      SET unread_user = unread_user + 1,
          last_message_at = datetime('now')
      WHERE id = ?
    `, [conversationId]);

    const insertedMsg = queryOne('SELECT * FROM support_messages WHERE id = ?', [msgRes.lastInsertRowid]);

    return sendJson(res, 201, {
      success: true,
      message: {
        id: insertedMsg.id,
        senderType: insertedMsg.sender_type,
        senderName: insertedMsg.sender_name,
        message: insertedMsg.message,
        createdAt: insertedMsg.created_at
      }
    });
  } catch (err) {
    console.error('adminReply error:', err);
    return sendJson(res, 500, { error: 'فشل إرسال رد المشرف' });
  }
}

/**
 * Admin updates conversation status (OPEN / RESOLVED)
 */
async function adminUpdateStatus(req, res, body) {
  try {
    const { conversationId, status } = body;

    if (!conversationId || !status) {
      return sendJson(res, 400, { error: 'البيانات غير مكتملة' });
    }

    execute('UPDATE support_conversations SET status = ? WHERE id = ?', [status, conversationId]);

    return sendJson(res, 200, {
      message: `تم تحديث حالة التذكرة إلى: ${status === 'RESOLVED' ? 'تم الحل ✓' : 'مفتوحة ⏳'}`
    });
  } catch (err) {
    console.error('adminUpdateStatus error:', err);
    return sendJson(res, 500, { error: 'فشل تحديث حالة المحادثة' });
  }
}

module.exports = {
  getMessages,
  sendMessage,
  getAdminConversations,
  getAdminConversationMessages,
  adminReply,
  adminUpdateStatus
};
