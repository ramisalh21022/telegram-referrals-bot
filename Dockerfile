# استخدم Node.js رسمي
FROM node:18

# تحديد مجلد العمل
WORKDIR /app

# نسخ الملفات الأساسية
COPY package*.json ./

# تثبيت المكتبات
RUN npm install

# نسخ بقية المشروع
COPY . .

# تحديد متغير البيئة للإنتاج
ENV NODE_ENV=production

# تشغيل البوت
CMD ["node", "index.js"]
