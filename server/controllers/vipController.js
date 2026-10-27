// ==============================================================================
// IQ VIP Platform - VIP Membership Controller
// Handles transparent VIP tier requirements, task limits, commission rates,
// and upgrade eligibility checks.
// ==============================================================================

const { query, queryOne, execute, transaction } = require('../../database/db');
const { sendJson } = require('../middleware');

/**
 * Get all VIP membership levels with requirements and transparent terms
 */
async function getVipLevels(req, res) {
  try {
    const levels = query(`
      SELECT id, level_name, display_name_ar, badge_color, min_deposit_or_balance,
             daily_task_limit, commission_rate, min_product_price, max_product_price,
             withdrawal_fee_pct, benefits_ar, is_active
      FROM vip_levels
      WHERE is_active = 1
      ORDER BY id ASC
    `);

    // Fetch user current VIP & balance if logged in
    let currentVipId = 1;
    let availableBalance = 0;
    if (req.user) {
      currentVipId = req.user.vip_level_id;
      const wallet = queryOne('SELECT available_balance FROM wallets WHERE user_id = ?', [req.user.id]);
      if (wallet) availableBalance = Number(wallet.available_balance);
    }

    return sendJson(res, 200, {
      currentVipId,
      availableBalance,
      disclaimer: 'تخضع العمولات لحجم المهام المتاحة يومياً ولا تمثل أي عوائد استثمارية ثابتة أو أرباحاً مالية مضمونة. نسعى لتقديم نظام شفاف للمكافآت الترويجية فقط.',
      levels: levels.map(lvl => ({
        id: lvl.id,
        name: lvl.level_name,
        title: lvl.display_name_ar,
        badgeColor: lvl.badge_color,
        minRequiredBalance: Number(lvl.min_deposit_or_balance),
        dailyTaskLimit: lvl.daily_task_limit,
        commissionRatePct: (Number(lvl.commission_rate) * 100).toFixed(2) + '%',
        commissionRate: Number(lvl.commission_rate),
        productRange: `$${Number(lvl.min_product_price).toFixed(0)} - $${Number(lvl.max_product_price).toFixed(0)}`,
        withdrawalFeePct: Number(lvl.withdrawal_fee_pct),
        benefits: lvl.benefits_ar.split('|').map(b => b.trim()),
        isCurrent: lvl.id === currentVipId,
        isEligible: availableBalance >= Number(lvl.min_deposit_or_balance)
      }))
    });
  } catch (err) {
    console.error('getVipLevels error:', err);
    return sendJson(res, 500, { error: 'حدث خطأ أثناء تحميل مستويات العضوية' });
  }
}

/**
 * Upgrade user VIP level
 */
async function upgradeVip(req, res, body) {
  try {
    const userId = req.user.id;
    const { targetLevelId } = body;

    if (!targetLevelId) {
      return sendJson(res, 400, { error: 'يرجى تحديد مستوى العضوية المطلوب' });
    }

    const targetVip = queryOne('SELECT * FROM vip_levels WHERE id = ? AND is_active = 1', [targetLevelId]);
    if (!targetVip) {
      return sendJson(res, 404, { error: 'المستوى المطلوب غير موجود أو غير مفعل' });
    }

    if (req.user.vip_level_id >= targetLevelId) {
      return sendJson(res, 400, { error: 'أنت بالفعل في هذا المستوى أو في مستوى أعلى منه' });
    }

    const wallet = queryOne('SELECT available_balance FROM wallets WHERE user_id = ?', [userId]);
    const balance = wallet ? Number(wallet.available_balance) : 0;
    const required = Number(targetVip.min_deposit_or_balance);

    // In demo mode or if user has sufficient available balance
    if (!req.user.is_demo && balance < required) {
      return sendJson(res, 400, {
        error: `رصيدك المتاح الحالي ($${balance.toFixed(2)}) أقل من الحد الأدنى المطلوب للترقية إلى ${targetVip.display_name_ar} ($${required.toFixed(2)})`
      });
    }

    // Update VIP level
    execute("UPDATE users SET vip_level_id = ?, updated_at = datetime('now') WHERE id = ?", [targetLevelId, userId]);

    // Send notification
    execute(`
      INSERT INTO notifications (user_id, title_ar, message_ar, type)
      VALUES (?, 'تمت ترقية عضويتك بنجاح!', ?, 'VIP_UPGRADE')
    `, [userId, `تهانينا! أصبحت الآن ضمن ${targetVip.display_name_ar}. يمكنك الآن الاستفادة من ${targetVip.daily_task_limit} مهام يومية وعمولة ${(Number(targetVip.commission_rate)*100).toFixed(1)}%.`]);

    return sendJson(res, 200, {
      message: `تهانينا! تمت ترقية حسابك إلى ${targetVip.display_name_ar} بنجاح.`,
      newVipLevel: {
        id: targetVip.id,
        title: targetVip.display_name_ar,
        dailyTaskLimit: targetVip.daily_task_limit,
        commissionRate: Number(targetVip.commission_rate)
      }
    });
  } catch (err) {
    console.error('upgradeVip error:', err);
    return sendJson(res, 500, { error: 'حدث خطأ أثناء ترقية العضوية' });
  }
}

module.exports = {
  getVipLevels,
  upgradeVip,
};
