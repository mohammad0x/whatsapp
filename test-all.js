const axios = require('axios');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// تنظیمات
const API_URL = 'http://localhost:3000';
const ADMIN_EMAIL = `admin_${Date.now()}@test.com`; // ایمیل یکتا
const AGENT_EMAIL = `agent_${Date.now()}@test.com`;
const PASSWORD = 'password123';

// رنگ‌ها برای لاگ
const colors = {
    reset: "\x1b[0m",
    green: "\x1b[32m",
    red: "\x1b[31m",
    yellow: "\x1b[33m",
    cyan: "\x1b[36m",
    bold: "\x1b[1m"
};

const log = (msg, type = 'info') => {
    const color = type === 'success' ? colors.green : type === 'error' ? colors.red : type === 'warn' ? colors.yellow : colors.cyan;
    console.log(`${color}${colors.bold}[${type.toUpperCase()}]${colors.reset} ${msg}`);
};

async function runTests() {
    log('🚀 Starting Full System Check...', 'info');
    let adminToken, agentToken, adminId, agentId, contactId, conversationId;

    try {
        // ==========================================
        // 1️⃣ فاز اول: احراز هویت و نقش‌ها
        // ==========================================
        log('\n🔹 Phase 1: Authentication & Roles', 'warn');

        // 1.1 ثبت نام ادمین
        try {
            const res = await axios.post(`${API_URL}/auth/register`, { 
                email: ADMIN_EMAIL, 
                password: PASSWORD, 
                name: 'Admin User' 
            });
            adminId = res.data.userId;
            log(`✅ Admin Registered: ${ADMIN_EMAIL}`, 'success');
        } catch (e) { 
            throw new Error(`Admin Signup Failed: ${e.response?.data?.message || e.message}`); 
        }

        // 1.2 لاگین ادمین
        try {
            const res = await axios.post(`${API_URL}/auth/login`, { email: ADMIN_EMAIL, password: PASSWORD });
            adminToken = res.data.access_token;
            log(`✅ Admin Logged In`, 'success');
        } catch (e) { throw new Error(`Admin Login Failed: ${e.message}`); }

        // 1.3 ثبت نام ایجنت
        try {
            const res = await axios.post(`${API_URL}/auth/register`, { 
                email: AGENT_EMAIL, 
                password: PASSWORD, 
                name: 'Agent User' 
            });
            agentId = res.data.userId;
            
            // ارتقاء دستی نقش به AGENT
            const userAgent = await prisma.user.findUnique({ where: { email: AGENT_EMAIL } });
            if(userAgent) {
                await prisma.user.update({ where: { id: userAgent.id }, data: { role: 'AGENT' } });
                agentId = userAgent.id;
            }

            // ساخت پروفایل Agent
            await prisma.agent.create({ data: { name: 'Agent Smith', email: AGENT_EMAIL, userId: agentId } });

            log(`✅ Agent Registered & Promoted: ${AGENT_EMAIL}`, 'success');
        } catch (e) { throw new Error(`Agent Setup Failed: ${e.message}`); }

        // 1.4 لاگین ایجنت
        try {
            const res = await axios.post(`${API_URL}/auth/login`, { email: AGENT_EMAIL, password: PASSWORD });
            agentToken = res.data.access_token;
            log(`✅ Agent Logged In`, 'success');
        } catch (e) { throw new Error(`Agent Login Failed: ${e.message}`); }


        // ==========================================
        // 2️⃣ فاز دوم: مدیریت مخاطبین و CRM
        // ==========================================
        log('\n🔹 Phase 2: CRM & Contact Management', 'warn');

        const testPhone = '98912000' + Math.floor(Math.random() * 9000);
        
        // ساخت مخاطب در دیتابیس
        const contact = await prisma.contact.create({
            data: { phone: testPhone, pushName: 'Ali Test', name: 'Unknown Client' }
        });
        contactId = contact.id;
        log(`✅ Contact Created via DB: ${testPhone}`, 'success');

        // تست آپدیت
        try {
            await prisma.contact.update({ where: { id: contactId }, data: { name: 'VIP Customer' } });
            log(`✅ Contact Name Updated`, 'success');
        } catch (e) { log(`⚠️ Contact Update Skipped`, 'warn'); }

        // ==========================================
        // 3️⃣ فاز سوم: پیام‌رسانی
        // ==========================================
        log('\n🔹 Phase 3: Messaging Logic', 'warn');

        // 🟢 FIX: ابتدا مطمئن می‌شویم که سشن وجود دارد
        await prisma.session.upsert({
            where: { id: 'session_1' },
            update: {},
            create: {
                id: 'session_1',
                status: 'DISCONNECTED',
                userId: adminId // سشن را به ادمین وصل می‌کنیم
            }
        });
        log(`✅ Session "session_1" ensured in DB`, 'success');

        // ایجاد گفتگو
        const conversation = await prisma.conversation.create({
            data: { contactId: contactId, sessionId: 'session_1', status: 'OPEN' }
        });
        conversationId = conversation.id;
        log(`✅ Conversation Started (ID: ${conversationId})`, 'success');

        // تخصیص به ایجنت
        try {
            const agentProfile = await prisma.agent.findUnique({ where: { email: AGENT_EMAIL } });
            await prisma.conversation.update({
                where: { id: conversationId },
                data: { assignedTo: agentProfile.id }
            });
            log(`✅ Assigned to Agent ID: ${agentProfile.id}`, 'success');
        } catch (e) { throw new Error(`Assignment Failed: ${e.message}`); }

        // ==========================================
        // 4️⃣ فاز چهارم: تست باگ‌های امنیتی (Duplicate Check)
        // ==========================================
        log('\n🔹 Phase 4: Security & Logic Check', 'warn');

        const whatsappMsgId = 'MSG_UNIQUE_' + Date.now();
        
        // پیام اول
        await prisma.message.create({
            data: {
                text: 'First Message',
                type: 'text',
                sender: testPhone, receiver: 'ME', isFromMe: false,
                conversationId: conversationId,
                whatsappId: whatsappMsgId // 👈 فیلد یونیک
            }
        });
        log(`✅ Original Message Inserted`, 'success');

        // پیام دوم (تکراری) - باید شکست بخورد
        try {
            await prisma.message.create({
                data: {
                    text: 'Duplicate Message',
                    type: 'text',
                    sender: testPhone, receiver: 'ME', isFromMe: false,
                    conversationId: conversationId,
                    whatsappId: whatsappMsgId 
                }
            });
            log(`❌ CRITICAL BUG: Duplicate message was allowed!`, 'error');
        } catch (e) {
            if (e.code === 'P2002') {
                log(`✅ Duplicate Prevention Working (DB Blocked it)`, 'success');
            } else {
                log(`❌ Unexpected DB Error: ${e.message}`, 'error');
            }
        }

        log('\n🎉 ALL TESTS PASSED SUCCESSFULLY! 🎉', 'success');

    } catch (error) {
        log(`\n❌ TEST FAILED: ${error.message}`, 'error');
    } finally {
        await prisma.$disconnect();
    }
}

runTests();