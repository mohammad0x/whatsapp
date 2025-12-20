const axios = require('axios');

const BASE_URL = 'http://localhost:3000';
const EMAIL = 'admin@test.com';
const PASSWORD = 'password123';

// 👈 ۵ شماره تستی (می‌توانی شماره خودت را چند بار تکرار کنی)
const TARGET_PHONES = [
    '989384983364', 
    '989384983364',
    '989384983364' 
];

async function run() {
    console.log('🚀 تست ارسال انبوه هوشمند...');
    
    // 1. لاگین
    const loginRes = await axios.post(`${BASE_URL}/auth/login`, { email: EMAIL, password: PASSWORD });
    const token = loginRes.data.access_token;
    
    // 2. درخواست ارسال انبوه
    console.log(`📤 در حال ارسال ${TARGET_PHONES.length} پیام به صف...`);
    
    try {
        const res = await axios.post(`${BASE_URL}/whatsapp/send-bulk`, {
            phones: TARGET_PHONES,
            message: 'تست سیستم صف - ارسال با تاخیر 🕒',
            delay: 1 // این پارامتر دیگه مهم نیست چون صف خودش مدیریت میکنه
        }, {
            headers: { Authorization: `Bearer ${token}` }
        });
        
        console.log('✅ نتیجه:', res.data);
        console.log('👀 حالا به ترمینال سرور نگاه کن، باید پیام‌ها یکی‌یکی با تاخیر ارسال شوند.');
        
    } catch (e) {
        console.error('❌ خطا:', e.response ? e.response.data : e.message);
    }
}

run();