// ==============================================================================
// IQ VIP Platform - Database Seeder
// Seeds default system settings, VIP levels, realistic Arabic products,
// administrators, demo accounts, and sample financial transactions.
// ==============================================================================

const { initializeSchema, queryOne, execute, transaction } = require('./db');
const { hashPassword, generateCode } = require('../server/utils/security');

function seedDatabase() {
  initializeSchema();

  // 1. Seed System Settings
  const existingSetting = queryOne('SELECT key FROM system_settings LIMIT 1');
  if (!existingSetting) {
    const settings = [
      ['platform_name', 'منصة المهام الذكية IQ VIP', 'اسم المنصة الرسمي'],
      ['platform_currency', 'USDT', 'رمز واسم عملة الموقع الرسمية'],
      ['task_processing_duration_seconds', '30', 'مدة معالجة المهمة بالثواني (30 ثانية افتراضياً)'],
      ['min_withdrawal_amount', '20.00', 'الحد الأدنى لطلب السحب بالعملة الرسمية للمنصة'],
      ['withdrawal_fee_pct', '2.0', 'نسبة رسوم السحب الافتراضية (%)'],
      ['demo_initial_balance', '0.00', 'الرصيد الأولي للمستخدمين الجدد (0.00 حقيقي)'],
      ['require_deposit_to_unlock', 'false', 'عدم اشتراط إيداع إضافي لفتح الرصيد المكتسب نهائياً'],
      ['require_all_tasks_completed_for_withdrawal', 'true', 'اشتراط إكمال جميع المهام اليومية للسماح بالسحب'],
      ['instant_settlement', 'true', 'تسوية العمولات بشكل فوري في المحفظة عند اكتمال المهمة']
    ];

    for (const [key, val, desc] of settings) {
      execute(
        'INSERT OR REPLACE INTO system_settings (key, value, description_ar) VALUES (?, ?, ?)',
        [key, val, desc]
      );
    }
  }

  // 1.1 Seed Payment Methods
  const existingPaymentMethod = queryOne('SELECT id FROM payment_methods LIMIT 1');
  if (!existingPaymentMethod) {
    const methods = [
      {
        code: 'USDT_TRC20',
        name: 'USDT (شبكة Tron TRC-20)',
        type: 'CRYPTO',
        instructions: 'أدخل عنوان محفظة USDT على شبكة TRC-20 حصراً. تستغرق المعالجة من 1 إلى 24 ساعة.',
        fee: 2.0,
        min: 20.0,
        max: 50000.0
      },
      {
        code: 'ZAIN_CASH',
        name: 'محفظة زين كاش (Zain Cash)',
        type: 'E_WALLET',
        instructions: 'أدخل رقم هاتف المحفظة المفعلة في زين كاش مع اسم صاحب المحفظة الثلاثي.',
        fee: 2.5,
        min: 15.0,
        max: 5000.0
      },
      {
        code: 'QI_CARD',
        name: 'مصرف الرافدين / كي كارد (Qi Card)',
        type: 'CARD',
        instructions: 'أدخل رقم بطاقة Qi Card المكون من 16 رقماً مع الاسم الثلاثي لصاحب البطاقة.',
        fee: 2.5,
        min: 20.0,
        max: 10000.0
      },
      {
        code: 'BANK_TRANSFER',
        name: 'حوالة مصرفية مباشرة (IBAN)',
        type: 'BANK',
        instructions: 'أدخل اسم البنك، رقم الحساب الدولي (IBAN)، والاسم الكامل للمستفيد.',
        fee: 1.5,
        min: 50.0,
        max: 100000.0
      }
    ];

    for (const m of methods) {
      execute(`
        INSERT OR IGNORE INTO payment_methods (code, name_ar, type, instructions_ar, fee_pct, min_amount, max_amount, is_active)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1)
      `, [m.code, m.name, m.type, m.instructions, m.fee, m.min, m.max]);
    }
  }

  // Ensure default payment methods are active
  execute("UPDATE payment_methods SET is_active = 1 WHERE code IN ('USDT_TRC20', 'ZAIN_CASH', 'QI_CARD', 'BANK_TRANSFER');");

  // 2. Seed VIP Levels
  const existingVip = queryOne('SELECT id FROM vip_levels LIMIT 1');
  if (!existingVip) {
    const vips = [
      {
        id: 1,
        name: 'VIP1',
        display: 'المستوى البرونزي VIP1',
        color: '#CD7F32',
        minBal: 10.00,
        limit: 5,
        rate: 0.0060, // 0.6%
        minP: 20.00,
        maxP: 150.00,
        fee: 2.50,
        benefits: '5 مهام يومية | عمولة 0.6% على أسعار المنتجات | الحد الأدنى للتفعيل 10 $ | دعم فني سريع'
      },
      {
        id: 2,
        name: 'VIP2',
        display: 'المستوى الفضي VIP2',
        color: '#C0C0C0',
        minBal: 100.00,
        limit: 12,
        rate: 0.0120, // 1.2%
        minP: 100.00,
        maxP: 500.00,
        fee: 2.00,
        benefits: '12 مهمة يومية | عمولة مضاعفة 1.2% | الحد الأدنى للتفعيل 100 $ | رسوم سحب مخفضة 2%'
      },
      {
        id: 3,
        name: 'VIP3',
        display: 'المستوى الذهبي VIP3',
        color: '#D4AF37',
        minBal: 250.00,
        limit: 25,
        rate: 0.0200, // 2.0%
        minP: 300.00,
        maxP: 1500.00,
        fee: 1.50,
        benefits: '25 مهمة يومية | عمولة مميزة 2.0% | الحد الأدنى للتفعيل 250 $ | مدير حسابات VIP خاص'
      },
      {
        id: 4,
        name: 'VIP4',
        display: 'المستوى البلاتيني VIP4',
        color: '#00E5FF',
        minBal: 800.00,
        limit: 40,
        rate: 0.0350, // 3.5%
        minP: 800.00,
        maxP: 5000.00,
        fee: 1.00,
        benefits: '40 مهمة يومية | أعلى معدل عمولة 3.5% | الحد الأدنى للتفعيل 800 $ | أسرع سحب فوري'
      }
    ];

    for (const v of vips) {
      execute(`
        INSERT INTO vip_levels 
        (id, level_name, display_name_ar, badge_color, min_deposit_or_balance, daily_task_limit, commission_rate, min_product_price, max_product_price, withdrawal_fee_pct, benefits_ar)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [v.id, v.name, v.display, v.color, v.minBal, v.limit, v.rate, v.minP, v.maxP, v.fee, v.benefits]);
    }
  }

  // Ensure exact VIP minimum deposit/activation balances
  execute("UPDATE vip_levels SET min_deposit_or_balance = 10.00, benefits_ar = '5 مهام يومية | عمولة 0.6% | الحد الأدنى للتفعيل 10 $ | دعم فني سريع' WHERE id = 1");
  execute("UPDATE vip_levels SET min_deposit_or_balance = 100.00, benefits_ar = '12 مهمة يومية | عمولة مضاعفة 1.2% | الحد الأدنى للتفعيل 100 $ | رسوم سحب مخفضة 2%' WHERE id = 2");
  execute("UPDATE vip_levels SET min_deposit_or_balance = 250.00, benefits_ar = '25 مهمة يومية | عمولة مميزة 2.0% | الحد الأدنى للتفعيل 250 $ | مدير حسابات VIP خاص' WHERE id = 3");
  execute("UPDATE vip_levels SET min_deposit_or_balance = 800.00, benefits_ar = '40 مهمة يومية | أعلى معدل عمولة 3.5% | الحد الأدنى للتفعيل 800 $ | أسرع سحب فوري' WHERE id = 4");

  // 3. Seed Products
  const existingProduct = queryOne('SELECT id FROM products LIMIT 1');
  if (!existingProduct) {
    const products = [
      {
        title: 'عطر العود الملكي الفاخر - 100 مل',
        desc: 'عطر شرقي فاخر بتركيبة دهن العود المعتق مع نفحات خشب الصندل والعنبر الملكي النادر.',
        price: 85.00,
        cat: 'عطور ومستحضرات فاخرة',
        img: 'https://images.unsplash.com/photo-1547887537-6158d64c35b3?w=600&auto=format&fit=crop&q=80',
        rating: 4.9,
        vip: 1
      },
      {
        title: 'ساعة يد ذكية AMOLED مقاومة للماء إصدار التيتانيوم',
        desc: 'ساعة رياضية ذكية متطورة مع شاشة فائقة الوضوح ومستشعر تتبع المؤشرات الحيوية ونظام تحديد المواقع.',
        price: 140.00,
        cat: 'أجهزة ذكية وإلكترونيات',
        img: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=600&auto=format&fit=crop&q=80',
        rating: 4.8,
        vip: 1
      },
      {
        title: 'سماعات رأس لاسلكية هايبرد بعزل الضوضاء النشط',
        desc: 'جودة صوت نقية استوديو مع ميكروفونات ذكية لعزل الضوضاء وبطارية فائقة تدوم 40 ساعة.',
        price: 125.00,
        cat: 'صوتيات وتكنولوجيا',
        img: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=600&auto=format&fit=crop&q=80',
        rating: 4.9,
        vip: 1
      },
      {
        title: 'كاميرا تصوير رقمية احترافية بدقة 4K',
        desc: 'مستشعر سينمائي بإطار كامل مع مثبت حركة خماسي المحاور لتصوير فائق الدقة والوضوح.',
        price: 380.00,
        cat: 'إلكترونيات وتصوير',
        img: 'https://images.unsplash.com/photo-1516035069371-29a1b244cc32?w=600&auto=format&fit=crop&q=80',
        rating: 5.0,
        vip: 2
      },
      {
        title: 'حقيبة سفر وأعمال جلدية إيطالية فاخرة',
        desc: 'مصنوعة يدوياً من أفخر أنواع الجلود الطبيعية مع قفل أمان ذكي ومقصورة مخصصة للأجهزة.',
        price: 260.00,
        cat: 'أزياء واكسسوارات',
        img: 'https://images.unsplash.com/photo-1548036328-c9fa89d128fa?w=600&auto=format&fit=crop&q=80',
        rating: 4.8,
        vip: 2
      },
      {
        title: 'نظارات شمسية كلاسيكية مطلية بالذهب عيار 18',
        desc: 'إطار كلاسيكي أنيق بعدسات مستقطبة للحماية الكاملة من الأشعة فوق البنفسجية UV400.',
        price: 195.00,
        cat: 'أزياء راقية',
        img: 'https://images.unsplash.com/photo-1511499767150-a48a237f0083?w=600&auto=format&fit=crop&q=80',
        rating: 4.7,
        vip: 2
      },
      {
        title: 'حاسوب لوحي للمصممين مع قلم دقيق مغناطيسي',
        desc: 'شاشة سينمائية 12.9 بوصة تدعم التدرج اللوني الواسع ومعالج ثماني النواة للأعمال الشاقة.',
        price: 720.00,
        cat: 'كمبيوتر وتقنيات',
        img: 'https://images.unsplash.com/photo-1544244015-0df4b3ffc6b0?w=600&auto=format&fit=crop&q=80',
        rating: 4.9,
        vip: 3
      },
      {
        title: 'مجموعة مستحضرات الكولاجين السويسرية الفاخرة',
        desc: 'تركيبة مجددة للبشرة مدعومة بمستخلصات طبيعية نادرة ومعادن مغذية للعناية المتكاملة.',
        price: 420.00,
        cat: 'مستحضرات عناية وتجميل',
        img: 'https://images.unsplash.com/photo-1571781926291-c477ebfd024b?w=600&auto=format&fit=crop&q=80',
        rating: 4.9,
        vip: 3
      },
      {
        title: 'ماكينة قهوة إسبريسو إيطالية احترافية مزدوجة السخان',
        desc: 'ضغط مضخة 19 بار مع مطحنة حبوب مدمجة بنظام تحكم رقمي بدرجة الحرارة PID.',
        price: 890.00,
        cat: 'أجهزة منزلية راقية',
        img: 'https://images.unsplash.com/photo-1517668808822-9ebb02f2a0e6?w=600&auto=format&fit=crop&q=80',
        rating: 4.9,
        vip: 3
      },
      {
        title: 'طقم مجوهرات وسوار مرصع بالزركون الماسي اللامع',
        desc: 'تصميم ملكي راق مطلي بالروديوم النقي والذهب الأبيض للمناسبات والسهرات الراقية.',
        price: 1850.00,
        cat: 'مجوهرات وألماس',
        img: 'https://images.unsplash.com/photo-1599643478518-a784e5dc4c8f?w=600&auto=format&fit=crop&q=80',
        rating: 5.0,
        vip: 4
      },
      {
        title: 'شاشة ألعاب ومونتاج سينمائية فائقة الانحناء OLED 49 بوصة',
        desc: 'دقة فائقة مزدوجة مع معدل تحديث 240Hz وزمن استجابة 0.03ms لرواد صناعة المحتوى.',
        price: 1650.00,
        cat: 'شاشات وتقنيات',
        img: 'https://images.unsplash.com/photo-1527443224154-c4a3942d3acf?w=600&auto=format&fit=crop&q=80',
        rating: 5.0,
        vip: 4
      },
      {
        title: 'طائرة تصوير جوي ذكية احترافية (Drone 4K Pro)',
        desc: 'نظام ملاحة ذكي مع مستشعرات تجنب العوائق في جميع الاتجاهات ومدى بث مباشر 15 كم.',
        price: 2200.00,
        cat: 'تكنولوجيا ومغامرات',
        img: 'https://images.unsplash.com/photo-1508614589041-895b88991e3e?w=600&auto=format&fit=crop&q=80',
        rating: 5.0,
        vip: 4
      }
    ];

    for (const p of products) {
      execute(`
        INSERT INTO products (title_ar, description_ar, price, category_ar, image_url, rating, min_vip_level, is_available)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1)
      `, [p.title, p.desc, p.price, p.cat, p.img, p.rating, p.vip]);
    }
  }

  // Ensure starter products with price <= $9.00 exist for users' first 2 tasks
  const starterCountRow = queryOne('SELECT count(*) as count FROM products WHERE price <= 9.00 AND is_available = 1');
  const starterCount = starterCountRow ? Number(starterCountRow.count) : 0;
  if (starterCount < 3) {
    const starterProducts = [
      {
        title: 'حامل هاتف ذكي مغناطيسي للسيارة من سبائك الألومنيوم',
        desc: 'حامل مغناطيسي فائق الثبات يدور 360 درجة متوافق مع جميع الهواتف الذكية.',
        price: 6.50,
        cat: 'إكسسوارات وهواتف',
        img: 'https://images.unsplash.com/photo-1586105251261-72a756497a11?w=600&auto=format&fit=crop&q=80',
        rating: 4.8,
        vip: 1
      },
      {
        title: 'كابل شحن ونقل بيانات فائق السرعة Type-C مجدول بطول 2 متر',
        desc: 'شحن سريع 65W بقدرة فائقة على تحمل الانحناء ومقاومة القطع مع نقل بيانات فوري.',
        price: 7.80,
        cat: 'شواحن وكابلات',
        img: 'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=600&auto=format&fit=crop&q=80',
        rating: 4.9,
        vip: 1
      },
      {
        title: 'سوار معصم سيليكون رياضي مسامي مضاد للتعرق',
        desc: 'سوار بديل عالي المرونة ومريح جداً للاستخدام الرياضي واليومي متوافق مع الساعات الذكية.',
        price: 8.50,
        cat: 'إكسسوارات وساعات',
        img: 'https://images.unsplash.com/photo-1508685096489-7aacd43bd3b1?w=600&auto=format&fit=crop&q=80',
        rating: 4.7,
        vip: 1
      },
      {
        title: 'واقي شاشة زجاجي مقوى مضاد للبصمات بدرجة صلابة 9H',
        desc: 'حماية متطورة لشاشة الهاتف ضد الكسر والخدوش مع وضوح عالي الدقة HD وتصفية الأشعة.',
        price: 8.90,
        cat: 'حماية الهواتف',
        img: 'https://images.unsplash.com/photo-1601784551446-20c9e07cdbdb?w=600&auto=format&fit=crop&q=80',
        rating: 4.8,
        vip: 1
      }
    ];

    for (const sp of starterProducts) {
      execute(`
        INSERT INTO products (title_ar, description_ar, price, category_ar, image_url, rating, min_vip_level, is_available)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1)
      `, [sp.title, sp.desc, sp.price, sp.cat, sp.img, sp.rating, sp.vip]);
    }
  }

  // 4. Seed Admin User & Demo User
  const existingAdmin = queryOne("SELECT id FROM users WHERE email = 'admin@iqvip.com'");
  if (!existingAdmin) {
    const adminPassHash = hashPassword('Admin@123456');
    const adminRes = execute(`
      INSERT INTO users (full_name, email, phone, password_hash, role, vip_level_id, is_demo, status, referral_code)
      VALUES (?, ?, ?, ?, 'SUPER_ADMIN', 4, 0, 'ACTIVE', ?)
    `, ['مدير المنصة الرئيسي', 'admin@iqvip.com', '+9647700000001', adminPassHash, 'ADMIN-VIP']);

    const adminId = adminRes.lastInsertRowid;
    execute(`
      INSERT INTO wallets (user_id, available_balance, pending_balance, total_earned, total_withdrawn, currency)
      VALUES (?, 50000.0000, 0.0000, 12500.0000, 0.0000, 'USDT')
    `, [adminId]);

    // Admin audit log entry
    execute(`
      INSERT INTO admin_audit_logs (admin_id, action, target_type, target_id, old_values, new_values, ip_address, notes)
      VALUES (?, 'SYSTEM_INITIALIZATION', 'system', 1, NULL, 'Initial Setup Complete', '127.0.0.1', 'تهيئة النظام وقاعدة البيانات للمرة الأولى بنجاح')
    `, [adminId]);
  }

  const existingDemo = queryOne("SELECT id FROM users WHERE email = 'demo@iqvip.com'");
  if (!existingDemo) {
    const demoPassHash = hashPassword('Demo@123456');
    const demoRes = execute(`
      INSERT INTO users (full_name, email, phone, password_hash, role, vip_level_id, is_demo, status, referral_code)
      VALUES (?, ?, ?, ?, 'USER', 1, 0, 'ACTIVE', ?)
    `, ['المستخدم الأول', 'demo@iqvip.com', '+9647700000002', demoPassHash, 'USER-7788']);

    const demoId = demoRes.lastInsertRowid;
    execute(`
      INSERT INTO wallets (user_id, available_balance, pending_balance, total_earned, total_withdrawn, currency)
      VALUES (?, 0.0000, 0.0000, 0.0000, 0.0000, 'USDT')
    `, [demoId]);

    // Welcome Notification
    execute(`
      INSERT INTO notifications (user_id, title_ar, message_ar, type)
      VALUES (?, 'أهلاً بك في منصة المهام الذكية IQ VIP', 'تم تفعيل حسابك بنجاح. يمكنك الآن بدء تنفيذ المهام اليومية المخصصة لمستواك لكسب العمولات المباشرة.', 'WELCOME')
    `, [demoId]);
  }

  const existingUser = queryOne("SELECT id FROM users WHERE email = 'user@iqvip.com'");
  if (!existingUser) {
    const userPassHash = hashPassword('User@123456');
    const userRes = execute(`
      INSERT INTO users (full_name, email, phone, password_hash, role, vip_level_id, is_demo, status, referral_code)
      VALUES (?, ?, ?, ?, 'USER', 2, 0, 'ACTIVE', ?)
    `, ['أحمد علي المهندس', 'user@iqvip.com', '+9647700000003', userPassHash, 'USER-3344']);

    const userId = userRes.lastInsertRowid;
    const initialBalance = 250.00;
    const walletRes = execute(`
      INSERT INTO wallets (user_id, available_balance, pending_balance, total_earned, total_withdrawn, currency)
      VALUES (?, 0.0000, 0.0000, 48.5000, 0.0000, 'USDT')
    `, [userId]);

    execute(`
      INSERT INTO transactions (wallet_id, user_id, type, amount, balance_before, balance_after, status, reference_type, description_ar, is_demo)
      VALUES (?, ?, 'SETTLEMENT_RELEASE', ?, 0.0000, ?, 'COMPLETED', 'SYSTEM_DEPOSIT', 'شحن رصيد المحفظة الأولي', 0)
    `, [walletRes.lastInsertRowid, userId, initialBalance, initialBalance]);

    execute(`
      UPDATE wallets SET available_balance = ? WHERE id = ?
    `, [initialBalance, walletRes.lastInsertRowid]);

    execute(`
      INSERT INTO notifications (user_id, title_ar, message_ar, type)
      VALUES (?, 'ترقية العضوية إلى المستوى الفضي VIP2', 'تهانينا! تمت ترقية حسابك إلى VIP2 لتستمتع بـ 12 مهمة يومياً ونسبة عمولة 1.2% وتسوية فورية.', 'VIP_UPGRADE')
    `, [userId]);
  }

  console.log('Database schema and seed initialized successfully.');
}

if (require.main === module) {
  seedDatabase();
}

module.exports = { seedDatabase };
