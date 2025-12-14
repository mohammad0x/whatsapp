const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const PORT = 4000; // این ربات روی پورت ۴۰۰۰ اجرا می‌شود
const API_URL = 'http://localhost:3000/whatsapp/send';

// 🔑 توکن خود را اینجا قرار دهید (کپی از Swagger)
const TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOjEsImVtYWlsIjoiYWRtaW5AdGVzdC5jb20iLCJpYXQiOjE3NjU3MjM2MjUsImV4cCI6MTc2NTgxMDAyNX0.7z3WhPla8pBMaUqap4cF7ndFb6I7mLRj_eDaISyneG4'; 

app.post('/webhook', async (req, res) => {
    const data = req.body;

    // فقط به پیام‌ها واکنش نشان بده
    if (data.event === 'message') {
        const { phone, text, sessionId } = data;
        
        console.log(`📩 پیام جدید از ${phone}: ${text}`);

        let replyText = '';

        // --- 🧠 مغز ربات (منطق پاسخگویی) ---
        if (text.includes('سلام')) {
            replyText = 'سلام دوست عزیز! 👋 من ربات هوشمند هستم. چطور کمکت کنم؟';
        } 
        else if (text.includes('قیمت')) {
            replyText = '💰 قیمت اشتراک ماهیانه ما ۱۰۰ هزار تومان است.';
        }
        else if (text.includes('کونی')) {
            replyText = 'باباته';
        }
        else if (text.includes('ساعت')) {
            replyText = `⏰ ساعت فعلی سرور: ${new Date().toLocaleTimeString('fa-IR')}`;
        }
        else {
            replyText = 'من فقط کلمات "سلام"، "قیمت" و "ساعت" را می‌فهمم. 🤖';
        }
        // ------------------------------------

        // ارسال جواب به واتساپ (فراخوانی API اصلی)
        try {
            await axios.post(API_URL, {
                sessionId: sessionId,
                phone: phone,
                message: replyText
            }, {
                headers: { 'Authorization': `Bearer ${TOKEN}` }
            });
            console.log(`✅ پاسخ ارسال شد: ${replyText}`);
        } catch (error) {
            console.error('❌ خطا در ارسال پاسخ:', error.response?.data || error.message);
        }
    }

    res.status(200).send('OK');
});

app.listen(PORT, () => {
    console.log(`🤖 Bot Server is running on http://localhost:${PORT}`);
});