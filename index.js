require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const bodyParser = require('body-parser');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

// -------------------------
// Supabase
// -------------------------
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// -------------------------
// Telegram Bot - Webhook
// -------------------------
const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { webHook: true });

async function setWebhook() {
    if (!process.env.APP_URL || !process.env.BOT_USERNAME) return;
    const url = `${process.env.APP_URL.replace(/\/$/, '')}/webhook/${process.env.TELEGRAM_TOKEN}`;
    await bot.setWebHook(url);
    console.log("✅ Webhook set to:", url);
}

// -------------------------
// Express server
// -------------------------
const app = express();
app.use(bodyParser.json());
app.post(`/webhook/${process.env.TELEGRAM_TOKEN}`, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
});
app.get("/", (req, res) => res.send("OK"));

// -------------------------
// جلسات المستخدم
// -------------------------
const userStages = {};
const JOB_TITLES = ["شهادة إعدادية","شهادة ثانوية","معهد متوسط","إجازة جامعية 4 سنوات","إجازة جامعية 5 سنوات","إجازة جامعية 6 سنوات","ماجستير","دكتوراه"];
const JOB_POSITIONS = ["مدير","معاون مدير","أمين سر","معاون أمين سر","أمين مكتبة","معاون أمين مكتبة","موجه","أمين مخبر","مشرف أنشطة لاصفية","مرشد نفسي في ح٢و٣","مرشد اجتماعي في ح١","مستخدم","مدرس لغة عربية","مدرس مساعد لغة عربية","مدرس لغة أجنبية(إنكليزية - فرنسية)","مدرس مساعد انكليزية","مدرس تربية دينية(إسلامية - مسيحية)","مدرس مساعد إسلامية","مدرس جغرافية","مدرس تاريخ","مدرس رياضيات","مدرس مساعد رياضيات","مدرس علم أحياء","مدرس فيزياء","مدرس كيمياء","مدرس فلسفة","مدرس تربية رياضية","مدرس مساعد تربية رياضية","مدرس معلوماتية","مدرس مساعد معلوماتية","مدرس مساعد تربية فنية","مدرس مساعد تربية موسيقية","معلم صف","غير ذلك"];

const genReferralCode = () => crypto.randomBytes(4).toString("hex");

async function ensureUserRow(telegramId, username = null) {
    const { data: existing } = await supabase
        .from('users_telegram')
        .select('*')
        .eq('telegram_id', telegramId);

    if (!existing || existing.length === 0) {
        const code = genReferralCode();
        const { data: created } = await supabase
            .from('users_telegram')
            .insert({ telegram_id: telegramId, username, referral_code: code })
            .select()
            .single();
        return created;
    }
    return existing[0];
}

function formatUserData(u) {
    return `
📄 بياناتك:
الاسم الثلاثي: ${u.full_name || "-"}
اسم الأب: ${u.father_name || "-"}
اسم الأم: ${u.mother_name || "-"}
مكان الولادة: ${u.birth_place || "-"}
تاريخ الولادة: ${u.birth_date || "-"}
محل القيد: ${u.registration_place || "-"}
رقم الخانة: ${u.record_number || "-"}
رقم الكاش: ${u.registration_number || "-"}
الرقم الوطني: ${u.national_id || "-"}
المؤهل العلمي: ${u.job_title || "-"}
المسمى الوظيفي: ${u.job_position || "-"}
`.trim();
}

// -------------------------
// /start
// -------------------------
bot.onText(/\/start(?: (.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const referralParam = match && match[1];
    try {
        let user = await ensureUserRow(chatId, msg.from.username || msg.from.first_name || null);
        if (!user) return bot.sendMessage(chatId, "خطأ داخلي.");

        if (referralParam && referralParam.startsWith("ref_")) {
            const code = referralParam.split("_")[1];
            const { data: refUser } = await supabase
                .from("users_telegram")
                .select("*")
                .eq("referral_code", code);
            if (refUser && refUser.length > 0) {
                const referrerId = refUser[0].id;
                if (!user.referrer_id && referrerId !== user.id) {
                    await supabase
                        .from("users_telegram")
                        .update({ referrer_id: referrerId })
                        .eq("telegram_id", chatId);
                }
            }
        }

        const refLink = `https://t.me/${process.env.BOT_USERNAME}?start=ref_${user.referral_code}`;
        bot.sendMessage(chatId, `🎉 مرحبًا ${msg.from.first_name || ""}!\n\n🔗 رابط الإحالة الخاص بك:\n${refLink}\n\nاستخدم /menu للحصول على نموذج البيانات.`);
    } catch (err) {
        console.error(err);
        bot.sendMessage(chatId, "حدث خطأ.");
    }
});

// -------------------------
// /menu
// -------------------------
bot.onText(/\/menu/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, "اختر أحد الخيارات:", {
        reply_markup: {
            inline_keyboard: [
                [{ text: "➕ إدخال بيانات", callback_data: "add_data" }],
                [{ text: "✏️ تعديل البيانات", callback_data: "edit_data" }],
                [{ text: "📄 عرض البيانات", callback_data: "show_data" }],
                [{ text: "🗑 حذف البيانات", callback_data: "delete_data" }],
                [{ text: "🔗 إحالاتي", callback_data: "my_referrals" }],
            ]
        }
    });
});

// -------------------------
// callback_query
// -------------------------
bot.on("callback_query", async (cq) => {
    const data = cq.data;
    const chatId = cq.message.chat.id;
    let session = userStages[chatId];

    try {
        if (data === "add_data" || data === "edit_data") {
            let mode = data === "add_data" ? "add" : "edit";
            session = { mode, step: 1, data: {} };
            if (mode === "edit") {
                const { data: u } = await supabase.from("users_telegram").select("*").eq("telegram_id", chatId).single();
                session.original = u;
            }
            userStages[chatId] = session;
            return bot.sendMessage(chatId, "أدخل الاسم الثلاثي:");
        }

        if (data === "show_data") {
            const { data: u } = await supabase.from("users_telegram").select("*").eq("telegram_id", chatId).single();
            bot.sendMessage(chatId, u ? formatUserData(u) : "❌ لا توجد بيانات.");
            return bot.answerCallbackQuery(cq.id);
        }

        if (data === "delete_data") {
            await supabase.from("users_telegram").update({
                full_name: null, father_name: null, mother_name: null,
                birth_place: null, birth_date: null,
                registration_place: null, registration_number: null,
                record_number: null, national_id: null,
                job_title: null, job_position: null
            }).eq("telegram_id", chatId);
            bot.sendMessage(chatId, "🗑 تم حذف بياناتك بنجاح.");
            return bot.answerCallbackQuery(cq.id);
        }

        if (data === "my_referrals") {
            const { data: u } = await supabase.from("users_telegram").select("*").eq("telegram_id", chatId).single();
            if (!u) return bot.answerCallbackQuery(cq.id, { text: "❌ لا يوجد حساب", show_alert: true });
            const { data: refs } = await supabase.from("users_telegram").select("*").eq("referrer_id", u.id);
            if (!refs || refs.length === 0) { bot.sendMessage(chatId, "📭 لا يوجد إحالات."); return bot.answerCallbackQuery(cq.id); }
            const buttons = refs.map(r => ([{ text: r.username || r.telegram_id, callback_data: `referral_${r.id}` }]));
            bot.sendMessage(chatId, "📊 إحالاتك:", { reply_markup: { inline_keyboard: buttons } });
            return bot.answerCallbackQuery(cq.id);
        }

        // خطوات اختيار المؤهل العلمي والمسمى الوظيفي
        if (session) {
            if (data.startsWith("job_title_")) {
                session.data.job_title = data.replace("job_title_", "");
                session.step = 11;
                bot.sendMessage(chatId, "اختر المسمى الوظيفي:", {
                    reply_markup: { inline_keyboard: JOB_POSITIONS.map(p => [{ text: p, callback_data: `job_position_${p}` }]) }
                });
                return bot.answerCallbackQuery(cq.id);
            }
            if (data.startsWith("job_position_")) {
                session.data.job_position = data.replace("job_position_", "");
                await supabase.from("users_telegram").update(session.data).eq("telegram_id", chatId);
                delete userStages[chatId];
                bot.sendMessage(chatId, "✅ تم حفظ البيانات!");
                return bot.answerCallbackQuery(cq.id);
            }
        }

        bot.answerCallbackQuery(cq.id);

    } catch (err) {
        console.error("callback_query error:", err);
        bot.answerCallbackQuery(cq.id, { text: "خطأ", show_alert: true });
    }
});

// -------------------------
// رسائل المستخدم
// -------------------------
bot.on("message", async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    if (!text || text.startsWith("/")) return;

    const session = userStages[chatId];
    if (!session) return;

    try {
        switch (session.step) {
            case 1: session.data.full_name = text; session.step = 2; bot.sendMessage(chatId, "اسم الأب:"); break;
            case 2: session.data.father_name = text; session.step = 3; bot.sendMessage(chatId, "اسم الأم:"); break;
            case 3: session.data.mother_name = text; session.step = 4; bot.sendMessage(chatId, "مكان الولادة:"); break;
            case 4: session.data.birth_place = text; session.step = 5; bot.sendMessage(chatId, "تاريخ الولادة (YYYY-MM-DD):"); break;
            case 5:
                if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) { bot.sendMessage(chatId, "❗ أدخل تاريخ بصيغة YYYY-MM-DD"); break; }
                session.data.birth_date = text; session.step = 6; bot.sendMessage(chatId, "محل القيد:"); break;
            case 6: session.data.registration_place = text; session.step = 7; bot.sendMessage(chatId, "رقم الخانة:"); break;
            case 7: session.data.record_number = text; session.step = 8; bot.sendMessage(chatId, "رقم الكاش:"); break;
            case 8: session.data.registration_number = text; session.step = 9; bot.sendMessage(chatId, "الرقم الوطني:"); break;
            case 9:
     session.data.national_id = text;
     session.step = 10;
     bot.sendMessage(chatId, "المؤهل العلمي:", {
         reply_markup: { inline_keyboard: JOB_TITLES.map(t => [{ text: t, callback_data: `job_title_${t}` }]) }
     });
 case 10:
     session.data.national_id = text;
     session.step = 11;
     bot.sendMessage(chatId, "المسمى الوظيفي:", {
         reply_markup: { inline_keyboard: JOB_POSITIONS.map(t => [{ text: t, callback_data: `job_position_${t}` }]) }
     }); 
                break;
            default: delete userStages[chatId]; bot.sendMessage(chatId, "انتهت الجلسة. استخدم /menu مجددًا."); break;
        }
    } catch (err) {
        console.error(err);
        delete userStages[chatId];
        bot.sendMessage(chatId, "حدث خطأ.");
    }
});

// -------------------------
// Start server
// -------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
    console.log("🚀 Server running on port", PORT);
    await setWebhook();
});


