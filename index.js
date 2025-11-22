require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const bodyParser = require('body-parser'); 

const { createClient } = require('@supabase/supabase-js');

const crypto = require('crypto');

// -------------------------
// إعداد Supabase
// -------------------------
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// -------------------------
// إعداد Telegram Bot (Webhook mode)
// -------------------------
// ملاحظة: نستخدم webHook لأنك تعمل على Render
const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { webHook: true });

// عند بدء التشغيل نضبط webhook تلقائيًا إلى المسار الصحيح
async function setWebhook() {
    try {
        const url = `${process.env.APP_URL.replace(/\/$/, '')}/webhook/${process.env.TELEGRAM_TOKEN}`;
        await bot.setWebHook(url);
        console.log('✅ Webhook set to:', url);
    } catch (err) {
        console.error('❌ Failed to set webhook:', err);
    }
}

// -------------------------
// Express لاستقبال Webhook
// -------------------------
const app = express();
app.use(bodyParser.json());

// Route for Telegram webhook
app.post(`/webhook/${process.env.TELEGRAM_TOKEN}`, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
});

// Health check
app.get('/', (req, res) => res.send('OK'));



// -------------------------
// حالات المستخدم المؤقتة (in-memory)
// (مناسب للنسخة المبسطة؛ في الإنتاج خزّن الجلسات في DB أو Redis)
// -------------------------
const userStages = {}; // key = chatId, value = { mode: 'add'|'edit', step: number, data: {} }

// -------------------------
// Helpers
// -------------------------
function genReferralCode() {
    return crypto.randomBytes(4).toString('hex');
}

async function ensureUserRow(telegramId, username = null) {
    // تأكد من وجود صف للمستخدم وإرجاعه
    const { data: existing, error } = await supabase
        .from('users_telegram')
        .select('*')
        .eq('telegram_id', telegramId);

    if (error) {
        console.error('Supabase select error:', error);
        return null;
    }

    if (!existing || existing.length === 0) {
        const myCode = genReferralCode();
        const { data: newUser, error: insertError } = await supabase
            .from('users_telegram')
            .insert({
                telegram_id: telegramId,
                username: username,
                referral_code: myCode
            })
            .select()
            .single();

      
if (insertError) {
  console.error('Supabase insert error:', insertError);
  return null;
}
return newUser;


    } else {
        return existing[0];
    }
}

// تنسيق رسالة عرض البيانات
function formatUserData(u) {
    return `📄 بياناتك:
الاسم الثلاثي: ${u.full_name || '-'}
اسم الأب: ${u.father_name || '-'}
اسم الأم: ${u.mother_name || '-'}
مكان الولادة: ${u.birth_place || '-'}
تاريخ الولادة: ${u.birth_date || '-'}
محل القيد: ${u.registration_place || '-'}
رقم الخانة: ${u.record_number || '-'}
رقم الكاش: ${u.registration_number || '-'}
الرقم الوطني: ${u.national_id || '-'}
اسم العمل: ${u.job_title || '-'}
تسمية الوظيفة: ${u.job_position || '-'}
 `.trim();
}

// -------------------------
// /start مع دعم الإحالة
// -------------------------
bot.onText(//start(?: (.+))?/, async (msg, match) => {
const chatId = msg.chat.id;
const referralParam = match && match[1];

try {
    let user = await ensureUserRow(chatId, msg.from.username || msg.from.first_name || null);
    if (!user) return bot.sendMessage(chatId, 'حدث خطأ داخلي. حاول لاحقًا.');

   
  }
}

// إرسال رسالة ترحيب مع رابط الإحالة الخاص بالمستخدم
const link = `https://t.me/${process.env.BOT_USERNAME}?start=ref_${user.referral_code}`;
    await bot.sendMessage(chatId,
        `🎉 مرحبًا ${msg.from.first_name || ''}!\n\n` +
        `رابط الإحالة الخاص بك:\n${link}\n\n` +
        `استعمل /menu للوصول لنموذج البيانات.`
    );
   
} catch (err) {
console.error('Start handler error:', err);
bot.sendMessage(chatId, 'حدث خطأ. حاول لاحقًا.');
}
});

// -------------------------
// /menu - القائمة الرئيسية
// -------------------------
bot.onText(//menu/, (msg) => {
const chatId = msg.chat.id;
bot.sendMessage(chatId, "اختر أحد الخيارات:", {
reply_markup: {
inline_keyboard: [
[{ text: "➕ إدخال بيانات", callback_data: "add_data" }],
[{ text: "✏️ تعديل البيانات", callback_data: "edit_data" }],
[{ text: "📄 عرض البيانات", callback_data: "show_data" }],
[{ text: "🗑 حذف البيانات", callback_data: "delete_data" }],
[{ text: "🔗 احالاتي", callback_data: "my_referrals" }]
]
}
});
});

// -------------------------
// تعامل مع الأزرار (callback_query)
// -------------------------
bot.on('callback_query', async (callbackQuery) => {
const data = callbackQuery.data;
const chatId = callbackQuery.message.chat.id;

try {
if (data === 'add_data') {
// بدء سير الإدخال
userStages[chatId] = { mode: 'add', step: 1, data: {} };
await bot.sendMessage(chatId, 'أدخل الاسم الثلاثي:');
return bot.answerCallbackQuery(callbackQuery.id);
}


    if (data === 'edit_data') {
        // جلب البيانات الحالية أولًا
        const { data: u, error } = await supabase
            .from('users_telegram')
            .select('*')
            .eq('telegram_id', chatId)
            .single();

        if (error || !u) {
            await bot.sendMessage(chatId, '❌ لا توجد بيانات لتعديلها. استخدم "إدخال بيانات" أولاً.');
            return bot.answerCallbackQuery(callbackQuery.id);
        }

        userStages[chatId] = { mode: 'edit', step: 1, data: {}, original: u };
        await bot.sendMessage(chatId, `تعديل البيانات — ستدخل الحقول واحدة تلو الأخرى. ابدأ بالاسم الثلاثي (الاسم الحالي: ${u.full_name || '-'})`);
        return bot.answerCallbackQuery(callbackQuery.id);
    }

    if (data === 'show_data') {
        const { data: u, error } = await supabase
            .from('users_telegram')
            .select('*')
            .eq('telegram_id', chatId)
            .single();

        if (error || !u) {
            await bot.sendMessage(chatId, '❌ لا توجد بيانات مسجلة.');
            return bot.answerCallbackQuery(callbackQuery.id);
        }

        await bot.sendMessage(chatId, formatUserData(u));
        return bot.answerCallbackQuery(callbackQuery.id);
    }

    if (data === 'delete_data') {
        // حذف الحقول (نترك الحساب لكنه سينظف الحقول الشخصية)
        const { error } = await supabase
            .from('users_telegram')
            .update({
                full_name: null,
                father_name: null,
                mother_name: null,
                birth_place: null,
                birth_date: null,
                registration_place: null,
                registration_number: null,
                record_number: null,
                national_id: null,
                job_title: null,
                job_position: null
            })
            .eq('telegram_id', chatId);

        if (error) {
            console.error('Delete data error:', error);
            await bot.sendMessage(chatId, 'حدث خطأ أثناء حذف البيانات.');
        } else {
            await bot.sendMessage(chatId, '🗑 تم حذف بياناتك الشخصية بنجاح.');
        }
        return bot.answerCallbackQuery(callbackQuery.id);
    }

    if (data === 'my_referrals') {
        // عرض الإحالات
        const { data: user, error } = await supabase
            .from('users_telegram')
            .select('*')
            .eq('telegram_id', chatId)
            .single();

        if (error || !user) {
            await bot.sendMessage(chatId, '❌ لا يوجد حساب مسجل. ابدأ بـ /start');
            return bot.answerCallbackQuery(callbackQuery.id);
        }

        const myId = user.id;
        const { data: referrals, error: refError } = await supabase
            .from('users_telegram')
            .select('*')
            .eq('referrer_id', myId);

        if (refError) {
            console.error(refError);
            await bot.sendMessage(chatId, 'حدث خطأ أثناء جلب الإحالات.');
            return bot.answerCallbackQuery(callbackQuery.id);
        }

        if (!referrals || referrals.length === 0) {
            await bot.sendMessage(chatId, '📭 لا يوجد أي إحالات حتى الآن.');
            return bot.answerCallbackQuery(callbackQuery.id);
        }

        const buttons = referrals.map(r => [{ text: r.username || String(r.telegram_id), callback_data: `referral_${r.id}` }]);
        await bot.sendMessage(chatId, '📊 إحالاتك (اضغط لرؤية رابط الإحالة):', { reply_markup: { inline_keyboard: buttons } });
        return bot.answerCallbackQuery(callbackQuery.id);
    }

    if (data && data.startsWith('referral_')) {
        const userId = parseInt(data.split('_')[1], 10);
        const { data: refUser, error } = await supabase
            .from('users_telegram')
            .select('*')
            .eq('id', userId);

        if (error || !refUser || refUser.length === 0) {
            return bot.answerCallbackQuery(callbackQuery.id, { text: "❌ المستخدم غير موجود", show_alert: true });
        }

        const name = refUser[0].username || refUser[0].telegram_id;
        const link = `https://t.me/${process.env.BOT_USERNAME}?start=ref_${refUser[0].referral_code}`;

        // نرسل الرابط كرسالة عادية بدلاً من alert طويل
        await bot.sendMessage(chatId, `${name} → رابط الإحالة:\n${link}`);
        return bot.answerCallbackQuery(callbackQuery.id);
    }

    // أي حالة أخرى
    return bot.answerCallbackQuery(callbackQuery.id);
   

} catch (err) {
console.error('callback_query error:', err);
return bot.answerCallbackQuery(callbackQuery.id, { text: 'حدث خطأ', show_alert: true });
}
});

// -------------------------
// استقبال الرسائل النصية لمراحل الإدخال/التعديل
// -------------------------
bot.on('message', async (msg) => {
const chatId = msg.chat.id;
const text = msg.text;

// تجاهل الأوامر وأنواع الرسائل غير النصية
if (!text || text.startsWith('/')) return;

const session = userStages[chatId];
if (!session) return; // لا توجد جلسة إدخال حالياً

try {
// خطوات الإدخال/التعديل:
// 1: full_name
// 2: father_name
// 3: mother_name
// 4: birth_place
// 5: birth_date (YYYY-MM-DD)
// 6: registration_place
// 7: record_number
// 8: registration_number
// 9: national_id
// 10: job_title
// 11: job_position
const step = session.step;


    switch (step) {
        case 1:
            session.data.full_name = text;
            session.step = 2;
            return bot.sendMessage(chatId, 'اسم الأب:');
        case 2:
            session.data.father_name = text;
            session.step = 3;
            return bot.sendMessage(chatId, 'اسم الأم:');
        case 3:
            session.data.mother_name = text;
            session.step = 4;
            return bot.sendMessage(chatId, 'مكان الولادة:');
        case 4:
            session.data.birth_place = text;
            session.step = 5;
            return bot.sendMessage(chatId, 'تاريخ الولادة (YYYY-MM-DD):');
        case 5:
            // تحقق بسيط من صيغة التاريخ
            if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
                return bot.sendMessage(chatId, 'الرجاء إدخال التاريخ بصيغة YYYY-MM-DD (مثال: 1990-05-21)');
            }
            session.data.birth_date = text;
            session.step = 6;
            return bot.sendMessage(chatId, 'محل القيد:');
        case 6:
            session.data.registration_place = text;
            session.step = 7;
            return bot.sendMessage(chatId, 'رقم الخانة:');
        case 7:
            session.data.record_number = text;
            session.step = 8;
            return bot.sendMessage(chatId, 'رقم الكاش:');
        case 8:
            session.data.registration_number = text;
            session.step = 9;
            return bot.sendMessage(chatId, 'الرقم الوطني:');
        case 9:
            session.data.national_id = text;
            session.step = 10;
            return bot.sendMessage(chatId, 'اسم العمل:');
        case 10:
            session.data.job_title = text;
            session.step = 11;
            return bot.sendMessage(chatId, 'تسمية الوظيفة:');
        case 11:
            session.data.job_position = text;
            // نهاية المسار: حفظ أو تعديل حسب الوضع
            if (session.mode === 'add') {
                // نضيف حقول إلى الصف الحالي
                const { error } = await supabase
                    .from('users_telegram')
                    .update(session.data)
                    .eq('telegram_id', chatId);

                if (error) {
                    console.error('Supabase save error:', error);
                    await bot.sendMessage(chatId, '❌ حدث خطأ أثناء حفظ البيانات.');
                } else {
                    await bot.sendMessage(chatId, '✅ تم حفظ البيانات بنجاح!');
                }
            } else if (session.mode === 'edit') {
                // نجمع القيم: إذا أدخل المستخدم حقلًا فارغًا نترك القيمة الأصلية
                const newData = { ...session.original, ...session.data };
                // نحتفظ فقط بالحقول الشخصية (للاعتماد)
                const payload = {
                    full_name: newData.full_name,
                    father_name: newData.father_name,
                    mother_name: newData.mother_name,
                    birth_place: newData.birth_place,
                    birth_date: newData.birth_date,
                    registration_place: newData.registration_place,
                    registration_number: newData.registration_number,
                    record_number: newData.record_number,
                    national_id: newData.national_id,
                    job_title: newData.job_title,
                    job_position: newData.job_position
                };
                const { error } = await supabase
                    .from('users_telegram')
                    .update(payload)
                    .eq('telegram_id', chatId);

                if (error) {
                    console.error('Supabase edit error:', error);
                    await bot.sendMessage(chatId, '❌ حدث خطأ أثناء تعديل البيانات.');
                } else {
                    await bot.sendMessage(chatId, '✅ تم تعديل البيانات بنجاح!');
                }
            }

            // انهي الجلسة
            delete userStages[chatId];
            return;
        default:
            delete userStages[chatId];
            return bot.sendMessage(chatId, 'انتهت الجلسة أو حدث خطأ. استخدم /menu للبدء مجدداً.');
    }
    

} catch (err) {
console.error('message handling error:', err);
delete userStages[chatId];
return bot.sendMessage(chatId, 'حدث خطأ أثناء المعالجة. حاول مجدداً باستخدام /menu');
}
});

// -------------------------
// بدء السيرفر وتعيين webhook تلقائيًا
// -------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
console.log(`🚀 Server running on port ${ PORT } `);
await setWebhook();
});


