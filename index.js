require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const express = require("express");
const bodyParser = require("body-parser");

// إنشاء البوت بدون polling
const bot = new TelegramBot(process.env.TELEGRAM_TOKEN);

// إعداد Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// Express app
const app = express();
app.use(bodyParser.json());

// Endpoint للـ Webhook
app.post(`/webhook/${process.env.TELEGRAM_TOKEN}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// أوامر البوت
bot.onText(/\/start(?: (.+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const referralParam = match[1]; // مثل ref_xxx

  let { data: existingUser, error } = await supabase
    .from('users_telegram')
    .select('*')
    .eq('telegram_id', chatId);

  if (error) return console.error(error);

  if (!existingUser || existingUser.length === 0) {
    let referrerId = null;

    if (referralParam && referralParam.startsWith('ref_')) {
      const code = referralParam.split('_')[1];
      const { data: refUser, error: refError } = await supabase
        .from('users_telegram')
        .select('*')
        .eq('referral_code', code);
      if (refError) console.error(refError);
      if (refUser && refUser.length > 0) referrerId = refUser[0].id;
    }

    const myCode = crypto.randomBytes(4).toString('hex');

    const { data: newUser, error: insertError } = await supabase
      .from('users_telegram')
      .insert({
        telegram_id: chatId,
        username: msg.from.username || msg.from.first_name || null,
        referral_code: myCode,
        referrer_id: referrerId
      })
      .select();

    if (insertError) return console.error(insertError);

    bot.sendMessage(
      chatId,
      `🎉 مرحبًا ${msg.from.first_name || ''}!\n\n` +
        `رابط الإحالة الخاص بك:\nhttps://t.me/${process.env.BOT_USERNAME}?start=ref_${myCode}\n\n` +
        `شارك الرابط مع أصدقائك، وستراهم عبر /my_referrals`
    );
  } else {
    bot.sendMessage(chatId, "👋 أهلا بك مجددًا! لديك حساب مسجل مسبقًا.");
  }
});

bot.onText(/\/my_referrals/, async (msg) => {
  const chatId = msg.chat.id;

  const { data: user, error } = await supabase
    .from('users_telegram')
    .select('*')
    .eq('telegram_id', chatId);

  if (error) return console.error(error);
  if (!user || user.length === 0) return bot.sendMessage(chatId, "❌ ليس لديك حساب. ابدأ بـ /start");

  const myId = user[0].id;

  const { data: referrals, error: refError } = await supabase
    .from('users_telegram')
    .select('*')
    .eq('referrer_id', myId);

  if (refError) return console.error(refError);

  if (!referrals || referrals.length === 0) return bot.sendMessage(chatId, "📭 لا يوجد أي إحالات حتى الآن.");

// إنشاء أزرار Inline لكل إحالة
  const buttons = referrals.map(r => {
    const name = r.username || r.telegram_id;
    return [{
      text: name,
      callback_data: `referral_${r.id}` // استخدام عمود id من الجدول
    }];
  });

  bot.sendMessage(chatId, "📊 إحالاتك (اضغط على أي اسم لرؤية رابط الإحالة):", {
    reply_markup: { inline_keyboard: buttons }
  });
});

// التعامل مع الضغط على الأزرار
bot.on('callback_query', async (callbackQuery) => {
  const msg = callbackQuery.message;
  const data = callbackQuery.data;

  console.log("Callback data:", data); // تتبع الحدث

  if (data.startsWith('referral_')) {
    const userId = parseInt(data.split('_')[1]);

    // جلب بيانات المستخدم من Supabase
    const { data: refUser, error } = await supabase
      .from('users_telegram')
      .select('*')
      .eq('id', userId);

    if (error) return console.error(error);
    if (!refUser || refUser.length === 0)
      return bot.answerCallbackQuery(callbackQuery.id, { text: "❌ المستخدم غير موجود", show_alert: true });

    const name = refUser[0].username || refUser[0].telegram_id;
    const link = `https://t.me/${process.env.BOT_USERNAME}?start=ref_${refUser[0].referral_code}`;

    // إرسال الرابط مباشرة للمستخدم عند الضغط
    bot.answerCallbackQuery(callbackQuery.id, {
      text: `${name} → رابط الإحالة:\n${link}`,
      show_alert: true
    });
  }
});
// تشغيل السيرفر
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
