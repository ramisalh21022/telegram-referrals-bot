require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

// إعداد البوت
const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

// إعداد Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// /start command
bot.onText(/\/start(?: (.+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const referralParam = match[1]; // مثل ref_xxx

  // تحقق إن كان المستخدم موجود
  let { data: existingUser, error } = await supabase
    .from('users_telegram')
    .select('*')
    .eq('telegram_id', chatId);

  if (error) return console.error(error);

  if (!existingUser || existingUser.length === 0) {
    let referrerId = null;

    // إذا دخل عبر رابط إحالة
    if (referralParam && referralParam.startsWith('ref_')) {
      const code = referralParam.split('_')[1];
      const { data: refUser, error: refError } = await supabase
        .from('users_telegram')
        .select('*')
        .eq('referral_code', code);
      if (refError) console.error(refError);
      if (refUser && refUser.length > 0) referrerId = refUser[0].id;
    }

    // إنشاء كود إحالة جديد
    const myCode = crypto.randomBytes(4).toString('hex');

    // إدخال المستخدم الجديد
    const { data: newUser, error: insertError } = await supabase
      .from('users_telegram')
      .insert({
        telegram_id: chatId,
        username: msg.from.username || null,
        referral_code: myCode,
        referrer_id: referrerId
      })
      .select();

    if (insertError) return console.error(insertError);

    // إرسال رابط الإحالة
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

// /my_referrals command
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

  let text = `📊 إحالاتك (${referrals.length}):\n\n`;
  referrals.forEach((r, i) => {
    text += `${i + 1}. ${r.username ? '@' + r.username : r.telegram_id}\n`;
  });

  bot.sendMessage(chatId, text);
});
