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

 let text = `📊 إحالاتك (${level1.length}):\n\n`;

  for (const l1 of level1) {
    const l1Name = l1.username || l1.telegram_id;
    text += `🟢 ${l1Name}`; // رمز للمستوى الأول

    const { data: level2 } = await supabase
      .from('users_telegram')
      .select('*')
      .eq('referrer_id', l1.id);

    if (level2 && level2.length > 0) {
      const l2Names = level2.map(l2 => l2.username || l2.telegram_id).join(" | ");
      text += ` → 🟡 ${l2Names}`; // رمز للمستوى الثاني

      // المستوى الثالث
      for (const l2 of level2) {
        const { data: level3 } = await supabase
          .from('users_telegram')
          .select('*')
          .eq('referrer_id', l2.id);
        if (level3 && level3.length > 0) {
          const l3Names = level3.map(l3 => l3.username || l3.telegram_id).join(" | ");
          text += `\n    → 🔵 ${l2.username || l2.telegram_id} → ${l3Names}`; // رمز للمستوى الثالث
        }
      }
    }
    text += `\n`; // فصل كل مستوى أول بسطر جديد
  }

  bot.sendMessage(chatId, text);
});

// تشغيل السيرفر
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

