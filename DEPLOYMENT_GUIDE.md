# دليل نشر وتشغيل منصة IQ VIP على الإنترنت (Production Deployment Guide)

يوفر هذا الدليل 3 طرق رئيسية لنشر المنصة على الإنترنت من الصفر خطوة بخطوة، مع إعداد الدومين (النطاق)، شهادة الأمان (HTTPS)، وحماية النظام.

---

## 🌟 الطرق المتاحة لنشر الموقع

| الخيار | الأنسب لـ | التكلفة | متطلبات الإعداد |
| :--- | :--- | :--- | :--- |
| **1. السحابة السريعة (Render / Railway)** | النشر الفوري، التجربة، أو البدايات السريعة | مجاني أو منخفض جداً | حساب GitHub + 5 دقائق إعداد |
| **2. سيرفر سحابي خاص (VPS - Ubuntu)** | الإطلاق التجاري الحقيقي، السيطرة الكاملة | 4\$ - 10\$ شهرياً | سيرفر VPS + دومين خاص |
| **3. حاويات دوكر (Docker Compose)** | النشر الموحد على أي سحابة تدعم Docker | حسب الخادم | سطر أوامر دوكر بنقرة واحدة |

---

## الخيار 1: النشر السريع عبر السحابة (Render.com)

منصة **Render** هي أسهل وأسرع وسيلة للحصول على رابط إنترنت دائم وآمن (`https://...`) بدون إدارة سيرفرات:

### الخطوات:
1. **رفع المشروع إلى حسابك في GitHub**:
   - أنشئ مستودعاً جديداً (Private أو Public) في [GitHub.com](https://github.com).
   - ارفع ملفات المشروع إلى المستودع.
2. **إنشاء خدمة على Render**:
   - سجل دخولك إلى موقع [Render.com](https://render.com).
   - اضغط على **New +** ثم اختر **Web Service**.
   - اختر مستودع GitHub الخاص بالمنصة.
3. **ضبط إعدادات التشغيل**:
   - **Name**: `iq-vip-platform`
   - **Region**: أقرب منطقة لجمهورك (مثل Frankfurt أو Singapore).
   - **Runtime**: `Node` (أو `Docker`).
   - **Build Command**: اتركه فارغاً أو `echo "Zero dependencies"`
   - **Start Command**: `node server/index.js`
4. **إضافة متغيرات البيئة (Environment Variables)**:
   - اضغط على **Advanced** -> **Add Environment Variable**:
     * `NODE_ENV`: `production`
     * `PORT`: `3000`
     * `JWT_SECRET`: `ضع_رمز_تشفير_طويل_ومعقد_هنا`
5. اضغط **Create Web Service**:
   - ستقوم المنصة ببناء وتشغيل الموقع وتزويدك برابط فوري دائم مع شهادة `HTTPS` تلقائياً!

---

## الخيار 2: النشر الاحترافي الكامل على سيرفر VPS (Ubuntu 22.04 / 24.04)

هذا هو الخيار الموصى به للمواقع التجارية الدائمة لضمان أعلى سرعة وتحكم كامل. يمكنك شراء سيرفر رخيص (مثل Hetzner, DigitalOcean, Contabo, Linode).

### 1. الدخول إلى السيرفر وتحديث الحزم:
```bash
ssh root@your_server_ip
apt update && apt upgrade -y
```

### 2. تثبيت Node.js الإصدار 22 LTS:
```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs git ufw nginx certbot python3-certbot-nginx
node -v # يجب أن يظهر v22.x أو أحدث
```

### 3. نقل المشروع إلى السيرفر:
```bash
# استنساخ المشروع أو نقله إلى المسار:
cd /var/www
git clone https://github.com/your-username/iq-vip-task-platform.git
cd iq-vip-task-platform
```

### 4. تشغيل الموقع بالخلفية 24/7 عبر مدير العمليات (PM2):
```bash
npm install -g pm2
pm2 start server/index.js --name "iq-vip"
pm2 startup
pm2 save
```
> يضمن هذا الأمر بقاء الموقع يعمل حتى في حال إعادة تشغيل السيرفر.

### 5. إعداد خادم الويب Nginx وربط الدومين (Reverse Proxy):
أنشئ ملف إعداد Nginx لموقعك:
```bash
nano /etc/nginx/sites-available/iqvip
```
أضف الإعداد التالي (مع استبدال `yourdomain.com` برابط دومينك):
```nginx
server {
    server_name yourdomain.com www.yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```
قم بتفعيل الموقع وفحص الإعداد:
```bash
ln -s /etc/nginx/sites-available/iqvip /etc/nginx/sites-enabled/
nginx -t
systemctl restart nginx
```

### 6. تثبيت شهادة أمان مجانية (SSL HTTPS):
```bash
certbot --nginx -d yourdomain.com -d www.yourdomain.com
```

### 7. حماية السيرفر بالجدار الناري (Firewall):
```bash
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw enable
```

الموقع الآن يعمل على `https://yourdomain.com` ولوحة الإدارة على `https://yourdomain.com/admin` بكفاءة وأمان تامين.

---

## الخيار 3: النشر عبر Docker و Docker Compose

إذا كان لديك سيرفر مثبت عليه Docker:

1. انسخ المشروع إلى السيرفر.
2. شغّل الحاوية بأمر واحد:
   ```bash
   docker compose up -d --build
   ```
3. للتحقق من الحالة:
   ```bash
   docker compose ps
   docker compose logs -f
   ```

---

## 🔒 قائمة التحقق الإلزامية قبل الإطلاق للجمهور (Security Checklist)

1. **تغيير كلمة مرور المشرف الافتراضية**:
   - لا تترك كلمة المرور الافتراضية `Admin@123456` في الإنتاج، قم بتسجيل الدخول وتغييرها فوراً.
2. **توليد مفتاح تشفير عشوائي لـ `JWT_SECRET`**:
   - توليد مفتاح عشوائي طويل (مثل تشغيل `openssl rand -hex 32` في الطرفية) ووضعه في ملف `.env`.
3. **حفظ نسخة احتياطية لقاعدة البيانات (Backup)**:
   - احرص على أخذ نسخ احتياطية دورية لملف `iq_vip.db` لضمان الحفاظ على سجلات المعاملات المالية والمستخدمين.
