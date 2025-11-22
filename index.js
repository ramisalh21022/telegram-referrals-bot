/**
 * index.js — نسخة مبسطة: Telegram + Supabase + Webhook + نموذج بيانات شخصية + نظام إحالة
 */

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
// Telegram Bot - Webhook mode
// -------------------------
const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { webHook: true });

// ضبط Webhook تلقائيًا
async function setWebhook() {
    try {
        if (!process.env.APP_URL || !process.env.BOT_USERNAME) {
            console.error("❌ APP_URL أو BOT_USERNAME غير معرف في Environment Variables");
            return;
        }

        const url = `${process.env.APP_URL.replace(/\/$/, '')}/webhook/${process.env.TELEGRAM_TOKEN}`;
        await bot.setWebHook(url);
        console.log("✅ Webhook set to:", url);
    } catch (err) {
        console.error("❌ Failed to set webhook:", err);
    }
}

// -------------------------
// Express server
// -------------------------
const app = express();
app.use(bodyParser.json());

// Telegram webhook
app.post(`/webhook/${process.env.TELEGRAM_TOKEN}`, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
});

// health check
app.get("/", (req, res) => res.send("OK"));


// -------------------------
// جلسات الإدخال المؤقتة
// -------------------------
const userStages = {}; // { chatId: { mode: "add"|"edit", step: number, data:{}, original:{} } }

const JOB_TITLES = ["ثانوية", "دبلوم", "بكالوريوس", "ماجستير", "دكتوراه"];
const JOB_POSITIONS = ["مهندس", "طبيب", "معلم", "مدير", "محاسب", "موظف"];

// -------------------------
// Helpers
// -------------------------
const genReferralCode = () => crypto.randomBytes(4).toString("hex");

async function ensureUserRow(telegramId, username = null) {
    const { data: existing, error } = await supabase
        .from('users_telegram')
        .select('*')
        .eq('telegram_id', telegramId);

    if (error) {
        console.error("Supabase select error:", error);
        return null;
    }

    if (!existing || existing.length === 0) {
        const code = genReferralCode();
        const { data: created, error: insertError } = await supabase
            .from('users_telegram')
            .insert({
                telegram_id: telegramId,
                username: username,
                referral_code: code
            })
            .select()
            .single();

        if (insertError) {
            console.error("Supabase insert error:", insertError);
            return null;
        }

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
// /start (مع الإحالة)
// -------------------------
bot.onText(/\/start(?: (.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const referralParam = match && match[1];

    try {
        let user = await ensureUserRow(
            chatId,
            msg.from.username || msg.from.first_name || null
        );
        if (!user) return bot.sendMessage(chatId, "خطأ داخلي.");

        // في حال وجود كود إحالة
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

        await bot.sendMessage(
            chatId,
            `🎉 مرحبًا ${msg.from.first_name || ""}!\n\n` +
            `🔗 رابط الإحالة الخاص بك:\n${refLink}\n\n` +
            `استخدم /menu للحصول على نموذج البيانات.`
        );

    } catch (err) {
        console.error(err);
        bot.sendMessage(chatId, "حدث خطأ.");
    }
});

// -------------------------
// /menu
// -------------------------
bot.onText(/\/menu/, async (msg) => {
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

    try {
        // إدخال
        if (data === "add_data") {
            userStages[chatId] = { mode: "add", step: 1, data: {} };
            bot.sendMessage(chatId, "أدخل الاسم الثلاثي:");
            return bot.answerCallbackQuery(cq.id);
        }

        // تعديل
        if (data === "edit_data") {
            const { data: u, error } = await supabase
                .from("users_telegram")
                .select("*")
                .eq("telegram_id", chatId)
                .single();

            if (error || !u) {
                bot.sendMessage(chatId, "❌ لا توجد بيانات لتعديلها.");
                return bot.answerCallbackQuery(cq.id);
            }

            userStages[chatId] = {
                mode: "edit",
                step: 1,
                data: {},
                original: u
            };

            bot.sendMessage(
                chatId,
                `تعديل البيانات — أدخل الاسم الثلاثي (الحالي: ${u.full_name || "-"})`
            );

            return bot.answerCallbackQuery(cq.id);
        }

        // عرض
        if (data === "show_data") {
            const { data: u } = await supabase
                .from("users_telegram")
                .select("*")
                .eq("telegram_id", chatId)
                .single();

            if (!u) {
                bot.sendMessage(chatId, "❌ لا توجد بيانات.");
            } else {
                bot.sendMessage(chatId, formatUserData(u));
            }

            return bot.answerCallbackQuery(cq.id);
        }

        // حذف
        if (data === "delete_data") {
            await supabase
                .from("users_telegram")
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
                .eq("telegram_id", chatId);

            bot.sendMessage(chatId, "🗑 تم حذف بياناتك بنجاح.");
            return bot.answerCallbackQuery(cq.id);
        }

        // إحالاتي
        if (data === "my_referrals") {
            const { data: u } = await supabase
                .from("users_telegram")
                .select("*")
                .eq("telegram_id", chatId)
                .single();

            if (!u) {
                bot.sendMessage(chatId, "❌ لا يوجد حساب.");
                return bot.answerCallbackQuery(cq.id);
            }

            const { data: refs } = await supabase
                .from("users_telegram")
                .select("*")
                .eq("referrer_id", u.id);

            if (!refs || refs.length === 0) {
                bot.sendMessage(chatId, "📭 لا يوجد إحالات.");
                return bot.answerCallbackQuery(cq.id);
            }

            const buttons = refs.map(r => ([
                {
                    text: r.username || r.telegram_id,
                    callback_data: `referral_${r.id}`
                }
            ]));

            bot.sendMessage(chatId, "📊 إحالاتك:", {
                reply_markup: { inline_keyboard: buttons }
            });

            return bot.answerCallbackQuery(cq.id);
        }
        // إدخال المؤهل العلمي  
        if (data.startsWith("job_title_")) {
            if (session) {
                session.data.job_title = data.replace("job_title_", "");
                session.step = 11;
                return bot.sendMessage(chatId, "اختر المسمى الوظيفي:", {
                    reply_markup: {
                        inline_keyboard: JOB_POSITIONS.map(p => [{ text: p, callback_data: `job_position_${p}` }])
                    }
                });
            }
        }

        // إدخال المسمى الوظيفي  
        if (data.startsWith("job_position_")) {
            if (session) {
                session.data.job_position = data.replace("job_position_", "");

                // حفظ البيانات  
                const payload = { ...session.data };
                await supabase.from("users_telegram").update(payload).eq("telegram_id", chatId);
                bot.sendMessage(chatId, "✅ تم حفظ البيانات!");
                delete userStages[chatId];
                return bot.answerCallbackQuery(cq.id);
            }
        }  

        // رابط الإحالة لكل مستخدم
        if (data.startsWith("referral_")) {
            const userId = parseInt(data.split("_")[1]);

            const { data: u } = await supabase
                .from("users_telegram")
                .select("*")
                .eq("id", userId);

            if (!u || u.length === 0) {
                return bot.answerCallbackQuery(cq.id, {
                    text: "❌ المستخدم غير موجود",
                    show_alert: true
                });
            }

            const link = `https://t.me/${process.env.BOT_USERNAME}?start=ref_${u[0].referral_code}`;

            bot.sendMessage(chatId, `${u[0].username || u[0].telegram_id}:\n${link}`);

            return bot.answerCallbackQuery(cq.id);
        }

        bot.answerCallbackQuery(cq.id);

    } catch (err) {
        console.error("callback_query error:", err);
        bot.answerCallbackQuery(cq.id, { text: "خطأ", show_alert: true });
    }
});

// -------------------------
// رسائل الإدخال
// -------------------------
bot.on("message", async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (!text || text.startsWith("/")) return;

    const session = userStages[chatId];
    if (!session) return;

    try {
        switch (session.step) {
            case 1:
                session.data.full_name = text;
                session.step = 2;
                return bot.sendMessage(chatId, "اسم الأب:");
            case 2:
                session.data.father_name = text;
                session.step = 3;
                return bot.sendMessage(chatId, "اسم الأم:");
            case 3:
                session.data.mother_name = text;
                session.step = 4;
                return bot.sendMessage(chatId, "مكان الولادة:");
            case 4:
                session.data.birth_place = text;
                session.step = 5;
                return bot.sendMessage(chatId, "تاريخ الولادة (YYYY-MM-DD):");
            case 5:
                if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
                    return bot.sendMessage(chatId, "❗ أدخل تاريخ بصيغة YYYY-MM-DD");
                }
                session.data.birth_date = text;
                session.step = 6;
                return bot.sendMessage(chatId, "محل القيد:");
            case 6:
                session.data.registration_place = text;
                session.step = 7;
                return bot.sendMessage(chatId, "رقم الخانة:");
            case 7:
                session.data.record_number = text;
                session.step = 8;
                return bot.sendMessage(chatId, "رقم الكاش:");
            case 8:
                session.data.registration_number = text;
                session.step = 9;
                return bot.sendMessage(chatId, "الرقم الوطني:");
            case 9:
                session.data.national_id = text;
                session.step = 10;
                return bot.sendMessage(chatId, "المؤهل العلمي:", {
                    reply_markup: { inline_keyboard: JOB_TITLES.map(t => [{ text: t, callback_data: `job_title_${t}` }]) }
                });  
            case 10:
                session.data.job_title = text;
                session.step = 11;
                return bot.sendMessage(chatId, "المسمى الوظيفي:", {
                    reply_markup: { inline_keyboard: JOB_POSITIONS.map(t => [{ text: t, callback_data: `job_position_${t}` }]) }
                });  
            case 11:
                session.data.job_position = text;

                const payload = { ...session.data };

                await supabase
                    .from("users_telegram")
                    .update(payload)
                    .eq("telegram_id", chatId);

                bot.sendMessage(chatId, "✅ تم حفظ البيانات!");

                delete userStages[chatId];
                return;

            default:
                delete userStages[chatId];
                bot.sendMessage(chatId, "انتهت الجلسة. استخدم /menu مجددًا.");
        }
    } catch (err) {
        console.error("Error:", err);
        delete userStages[chatId];
        bot.sendMessage(chatId, "حدث خطأ.");
    }
});

// -------------------------
// Server start + webhook
// -------------------------
const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
    console.log("🚀 Server running on port", PORT);
    await setWebhook();
});


