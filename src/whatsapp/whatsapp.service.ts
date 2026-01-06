import { Injectable, ForbiddenException,OnModuleInit, BadRequestException } from '@nestjs/common';
import makeWASocket, { DisconnectReason, useMultiFileAuthState, WAMessageStatus } from '@whiskeysockets/baileys';
import * as QRCode from 'qrcode';
import * as fs from 'fs';
import * as path from 'path';
import pino from 'pino';
import { PrismaService } from '../prisma/prisma.service';
import { ChatbotService } from './chatbot.service';
import { EventsGateway } from '../events.gateway';
import { WebhookService } from './webhook.service';
import { downloadMediaMessage } from '@whiskeysockets/baileys';
import { writeFile } from 'fs/promises';

@Injectable()
export class WhatsappService implements OnModuleInit {
    private sessions = new Map<string, any>();
    private qrCodes = new Map<string, string>();
    private retryCounts = new Map<string, number>(); // ✅ برای جلوگیری از لوپ بی‌نهایت
    private readonly DEFAULT_SESSION_ID = 'session_1';

    constructor(
        private prisma: PrismaService,
        private chatbotService: ChatbotService,
        private eventsGateway: EventsGateway,
        private webhookService: WebhookService
    ) { }

    async onModuleInit() {
        const authDir = 'auth_info';
        if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });

        const sessions = fs.readdirSync(authDir);
        for (const sessionName of sessions) {
            if (sessionName.startsWith('session_')) {
                const userId = parseInt(sessionName.split('_')[1]);
                console.log(`🔄 Recovering ${sessionName}...`);
                await this.createSession(sessionName, userId, false);
            }
        }
    }

    async start() {
        return this.createSession(this.DEFAULT_SESSION_ID, 1);
    }

    async createSession(sessionId: string, userId: number, syncHistory = false) { // 👈 پیش‌فرض false برای جلوگیری از کرش
        const sid = sessionId || this.DEFAULT_SESSION_ID;
        if (this.sessions.has(sid)) return { message: 'Already active', sessionId: sid };

        const authFolder = `auth_info/${sid}`;
        const { state, saveCreds } = await useMultiFileAuthState(authFolder);

        const sock = makeWASocket({
            auth: state,
            logger: pino({ level: 'silent' }) as any,
            printQRInTerminal: false,
            browser: ['TeamInbox', 'Chrome', '1.0.0'],
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 60000,
            keepAliveIntervalMs: 10000,
            syncFullHistory: syncHistory,
            markOnlineOnConnect: true,
        });

        this.sessions.set(sid, sock);

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                console.log(`📷 QR Code generated`);
                const qrImage = await QRCode.toDataURL(qr);
                this.qrCodes.set(sid, qrImage);
                this.eventsGateway.sendMessageToClients('session:qr', { sessionId: sid, qr: qrImage });
                await this.saveSessionToDb(sid, 'SCAN_QR', userId);
            }

            if (connection === 'open') {
                console.log(`✅ Session CONNECTED!`);
                this.retryCounts.delete(sid); // ✅ ریست کردن شمارنده تلاش مجدد
                this.qrCodes.delete(sid);
                const myPhone = sock.user?.id?.split(':')[0];
                this.eventsGateway.sendMessageToClients('session:connected', { sessionId: sid, phone: myPhone });
                await this.saveSessionToDb(sid, 'CONNECTED', userId, myPhone);
            }

            if (connection === 'close') {
                const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

                this.sessions.delete(sid);
                this.qrCodes.delete(sid);

                if (shouldReconnect) {
                    const currentRetry = this.retryCounts.get(sid) || 0;
                    if (currentRetry < 5) { // ✅ حداکثر ۵ بار تلاش
                        const delay = (currentRetry + 1) * 5000; // تاخیر تصاعدی: ۵، ۱۰، ۱۵...
                        console.log(`⚠️ Reconnecting in ${delay / 1000}s... (Attempt ${currentRetry + 1}/5)`);
                        this.retryCounts.set(sid, currentRetry + 1);
                        setTimeout(() => this.createSession(sid, userId, false), delay);
                    } else {
                        console.error(`❌ Session ${sid} stopped after 5 failed attempts.`);
                        await this.saveSessionToDb(sid, 'STOPPED', userId);
                    }
                } else {
                    console.log(`❌ Logged out`);
                    if (statusCode === DisconnectReason.loggedOut) {
                        await this.disconnect(sid);
                    } else {
                        await this.saveSessionToDb(sid, 'DISCONNECTED', userId);
                    }
                }
            }
        });

        sock.ev.on('creds.update', saveCreds);

        // دریافت تاریخچه (فقط در صورتی که syncHistory=true باشد یا دستی صدا زده شود)
        sock.ev.on('messaging-history.set', async ({ messages }) => {
            if (!syncHistory) return; // اگر سینک نخواستیم، پردازش نکنیم
            console.log(`📚 History Sync: Processing ${messages.length} messages...`);
            for (const msg of messages) {
                await this.handleIncomingMessage(sid, msg, sock, userId, true);
            }
        });

        sock.ev.on('messages.upsert', async ({ messages, type }) => {
            for (const msg of messages) {
                if (!msg.message) continue;
                const isHistory = type === 'append';

                await this.handleIncomingMessage(sid, msg, sock, userId, isHistory);

                // ارسال به وب‌هوک (فقط پیام‌های جدید)
                if (!isHistory && type === 'notify' && !msg.key.fromMe) {
                    this.processWebhook(sid, msg); // ✅ انتقال به تابع جداگانه و ایمن
                }
            }
        });

        return { message: 'Session initializing...', sessionId: sid };
    }

    // پردازش پیام‌های ورودی
    private async handleIncomingMessage(sessionId: string, msg: any, sock: any, userId: number, isHistory = false) {
        const remoteJid = msg.key.remoteJid;
        if (!remoteJid || remoteJid === 'status@broadcast' || remoteJid.includes('@broadcast')) return;

        const isFromMe = msg.key.fromMe;
        
        // ✅ تشخیص دقیق فرستنده (سازگار با گروه‌ها و LID)
        let senderJid = remoteJid;
        if (remoteJid.endsWith('@g.us')) {
            // در گروه، فرستنده واقعی در participant است
            if (!isFromMe) {
                senderJid = msg.key.participant || msg.participant;
            }
        }
        
        if (!senderJid) return;

        // استخراج شناسه (این می‌تواند شماره تلفن باشد یا LID طولانی)
        const contactIdentifier = senderJid.split('@')[0];

        // ❌ حذف گاردهای امنیتی قبلی: حالا ما همه چیز را قبول می‌کنیم

        // استخراج نام
        let pushName = 'Unknown';
        if (!isFromMe) {
            pushName = msg.pushName || msg.verifiedBizName || 'Unknown';
        }

        // جلوگیری از تکرار پیام
        const existingMsg = await this.prisma.message.findFirst({
            where: { whatsappId: msg.key.id }
        });
        if (existingMsg) return;

        // استخراج محتوا (متن، عکس و ...)
        const messageContent = msg.message?.ephemeralMessage?.message ||
            msg.message?.viewOnceMessage?.message ||
            msg.message?.documentWithCaptionMessage?.message ||
            msg.message;

        if (!messageContent) return;

        let text = '';
        let msgType = 'text';
        let mediaUrl: string | null = null;

        if (messageContent.conversation) text = messageContent.conversation;
        else if (messageContent.extendedTextMessage?.text) text = messageContent.extendedTextMessage.text;
        else if (messageContent.imageMessage) { msgType = 'image'; text = messageContent.imageMessage.caption || '[Image]'; }
        else if (messageContent.documentMessage) { msgType = 'document'; text = messageContent.documentMessage.caption || messageContent.documentMessage.fileName || '[Document]'; }

        if (!text && msgType === 'text') return;

        // دانلود مدیا (همان کد قبلی شما)
        if (msgType === 'image' || msgType === 'document') {
             try {
                const buffer = await downloadMediaMessage(
                    msg,
                    'buffer',
                    {},
                    { logger: pino({ level: 'silent' }) as any, reuploadRequest: sock.updateMediaMessage }
                );
                const date = new Date();
                const folderPath = path.join(process.cwd(), 'uploads', date.getFullYear().toString(), (date.getMonth() + 1).toString());
                if (!fs.existsSync(folderPath)) fs.mkdirSync(folderPath, { recursive: true });
                let ext = 'dat';
                if (msgType === 'image') ext = 'jpg';
                else if (messageContent.documentMessage?.mimetype?.includes('pdf')) ext = 'pdf';
                else if (messageContent.documentMessage?.mimetype?.includes('word')) ext = 'docx';
                const safeFileName = `${msg.key.id.replace(/[^a-zA-Z0-9]/g, '')}.${ext}`;
                const filePath = path.join(folderPath, safeFileName);
                await writeFile(filePath, buffer);
                mediaUrl = `/uploads/${date.getFullYear()}/${date.getMonth() + 1}/${safeFileName}`;
            } catch (error) {
                console.error('❌ Download Failed:', error);
            }
        }

        // ✅ مدیریت مخاطب (با استفاده از contactIdentifier که ممکن است LID باشد)
        let contact = await this.prisma.contact.findUnique({ where: { phone: contactIdentifier } });
        
        if (!contact) {
            // ساخت مخاطب جدید با همان آیدی
            contact = await this.prisma.contact.create({
                data: { 
                    phone: contactIdentifier, 
                    pushName: isFromMe ? 'Unknown' : pushName 
                }
            });
        } else {
            // آپدیت نام
            if (!isFromMe && pushName !== 'Unknown' && contact.pushName !== pushName) {
                contact = await this.prisma.contact.update({
                    where: { id: contact.id },
                    data: { pushName: pushName }
                });
            }
        }

        // مدیریت گفتگو
        let conversation = await this.prisma.conversation.findFirst({ where: { contactId: contact.id, sessionId } });
        if (!conversation) {
            conversation = await this.prisma.conversation.create({
                data: { contactId: contact.id, sessionId, status: 'OPEN', unreadCount: 0 }
            });
        }

        const msgTimestamp = new Date((msg.messageTimestamp || Date.now() / 1000) * 1000);

        // ذخیره پیام
        const savedMsg = await this.prisma.message.create({
            data: {
                text,
                type: msgType,
                mediaUrl: mediaUrl,
                sender: isFromMe ? 'ME' : contactIdentifier,
                receiver: isFromMe ? contactIdentifier : 'ME',
                isFromMe,
                conversationId: conversation.id,
                createdAt: msgTimestamp,
                whatsappId: msg.key.id 
            }
        });

        // آپدیت وضعیت گفتگو
        await this.prisma.conversation.update({
            where: { id: conversation.id },
            data: {
                lastMessageAt: msgTimestamp,
                unreadCount: isFromMe ? 0 : { increment: 1 }
            }
        });

        if (!isHistory) {
            this.eventsGateway.sendMessageToClients('message:new', {
                conversationId: conversation.id,
                message: savedMsg,
                contact
            });

            // ✅ پاسخ ربات: استفاده از تابع sendTextMessage که حالا LID را می‌شناسد
            if (!isFromMe && msgType === 'text' && !remoteJid.endsWith('@g.us')) {
                const botResponse = await this.chatbotService.getResponse(userId, text);
                if (botResponse) {
                    await new Promise(r => setTimeout(r, 2000));
                    // اینجا contactIdentifier (که شاید LID باشد) پاس داده می‌شود و بدون خطا کار می‌کند
                    await this.sendTextMessage(sessionId, contactIdentifier, botResponse, userId);
                }
            }
        }
    }

    // ارسال به وب‌هوک (جداگانه برای جلوگیری از بلاک شدن)
    private async processWebhook(sessionId: string, msg: any) {
        try {
            const msgType = Object.keys(msg.message)[0];
            const body = msg.message.conversation ||
                msg.message.extendedTextMessage?.text ||
                msg.message.imageMessage?.caption || '';

            const webhookData = {
                id: msg.key.id,
                from: msg.key.remoteJid?.split('@')[0],
                timestamp: msg.messageTimestamp,
                type: msgType.replace('Message', ''),
                text: { body: body },
                ...(msgType === 'imageMessage' && {
                    image: {
                        mime_type: msg.message.imageMessage?.mimetype,
                        caption: msg.message.imageMessage?.caption
                    }
                })
            };
            // استفاده از ست‌تایم‌اوت برای اینکه ایونت لوپ اصلی منتظر نماند
            setTimeout(() => {
                this.webhookService.dispatch(sessionId, webhookData, 'message').catch(err => console.error('Webhook Error:', err.message));
            }, 0);
        } catch (e) {
            console.error('Webhook processing failed', e);
        }
    }

    async getSessionStatus(sessionId: string, userId: number) {
        const sid = sessionId || this.DEFAULT_SESSION_ID;
        const sock = this.sessions.get(sid);
        const qr = this.qrCodes.get(sid);
        if (sock?.user) return { status: 'CONNECTED', phone: sock.user.id.split(':')[0], sessionId: sid };
        if (qr) return { status: 'SCAN_QR', qr, sessionId: sid };
        return { status: 'DISCONNECTED', sessionId: sid };
    }

    async disconnect(sessionId: string) {
        const sid = sessionId || this.DEFAULT_SESSION_ID;
        const sock = this.sessions.get(sid);
        try {
            console.log(`⚠️ Disconnecting session: ${sid}`);
            if (sock) {
                sock.end(undefined);
                this.sessions.delete(sid);
            }
            const authFolder = path.join(process.cwd(), 'auth_info', sid);
            if (fs.existsSync(authFolder)) {
                fs.rmSync(authFolder, { recursive: true, force: true });
            }

            // ✅ Fix: حذف خطوط پاک کردن دیتابیس (Message/Conversation)
            // فقط وضعیت سشن را آپدیت می‌کنیم
            this.eventsGateway.sendMessageToClients('session:disconnected', {});
            this.qrCodes.delete(sid);
            this.retryCounts.delete(sid);
            await this.prisma.session.updateMany({ where: { id: sid }, data: { status: 'DISCONNECTED', phone: null } });
            return { status: 'success' };
        } catch (error) { throw new BadRequestException('Failed to disconnect'); }
    }

    async sendTextMessage(sessionId: string, phone: string, message: string, userId: number) {
        const sid = sessionId || this.DEFAULT_SESSION_ID;
        const sock = this.sessions.get(sid);

        if (!sock || !sock.user) {
            throw new BadRequestException('ربات هنوز متصل نشده است.');
        }

        // 🔒 بخش امنیتی جدید: بررسی سطح دسترسی ایجنت
        // چک می‌کنیم آیا این User ID متعلق به یک ایجنت است؟
        const agent = await this.prisma.agent.findFirst({
            where: { userId: userId }
        });

        // اگر ایجنت بود و تیک "ارسال پیام" برایش خاموش بود ⛔
        if (agent && agent.canSendMessage === false) {
            throw new ForbiddenException('⛔ شما مجوز ارسال پیام متنی را ندارید.');
        }

        // --- از اینجا به بعد کد قبلی شماست ---

        // تمیزکاری ورودی (فقط اعداد)
        let cleanPhone = String(phone).replace(/\D/g, '');
        let jid;

        // ✅ تشخیص هوشمند (شماره تلفن یا LID)
        if (cleanPhone.length > 14) {
            console.log(`ℹ️ Sending message to LID: ${cleanPhone}`);
            jid = `${cleanPhone}@lid`; 
        } else {
            if (cleanPhone.startsWith('09')) cleanPhone = '98' + cleanPhone.substring(1);
            else if (cleanPhone.startsWith('0098')) cleanPhone = cleanPhone.substring(2);

            if (cleanPhone.length < 10) {
                throw new BadRequestException(`شماره تلفن نامعتبر (خیلی کوتاه): ${cleanPhone}`);
            }
            jid = `${cleanPhone}@s.whatsapp.net`; 
        }

        // بررسی وجود شماره (فقط برای شماره‌های موبایل)
        if (!jid.includes('@lid')) {
            const [onWhats] = await sock.onWhatsApp(jid);
            if (!onWhats?.exists) {
                throw new BadRequestException(`شماره ${cleanPhone} در واتساپ وجود ندارد.`);
            }
        }

        try {
            await sock.sendPresenceUpdate('composing', jid);
            const sentMsg = await sock.sendMessage(jid, { text: message });
            await sock.sendPresenceUpdate('paused', jid);

            // ذخیره در دیتابیس
            let contact = await this.prisma.contact.findUnique({ where: { phone: cleanPhone } });
            if (!contact) {
                contact = await this.prisma.contact.create({ data: { phone: cleanPhone, pushName: 'Unknown' } });
            }

            let conversation = await this.prisma.conversation.findFirst({ where: { contactId: contact.id, sessionId: sid } });
            if (!conversation) {
                conversation = await this.prisma.conversation.create({ data: { contactId: contact.id, sessionId: sid, status: 'OPEN' } });
            }

            await this.prisma.message.create({
                data: {
                    text: message,
                    type: 'text',
                    isFromMe: true,
                    sender: 'ME',
                    receiver: cleanPhone,
                    conversationId: conversation.id,
                    createdAt: new Date(),
                    whatsappId: sentMsg?.key?.id 
                }
            });

            await this.prisma.conversation.update({
                where: { id: conversation.id },
                data: { lastMessageAt: new Date() }
            });

            return { status: 'sent', phone: cleanPhone, messageId: sentMsg?.key?.id };

        } catch (error: any) {
            console.error('❌ Send Failed:', error);
            throw new BadRequestException(`خطا در ارسال: ${error.message}`);
        }
    }

    async sendImageBuffer(sessionId: string, phone: string, fileBuffer: Buffer, caption: string, userId: number, retryCount = 0) {
        // 🔒 ۱. چک کردن سطح دسترسی ایجنت (فقط در تلاش اول چک کنید کافیست)
        if (retryCount === 0) {
            const agent = await this.prisma.agent.findFirst({
                where: { userId: userId }
            });

            // اگر ایجنت بود و تیک "ارسال تصویر" نداشت ⛔
            if (agent && agent.canSendImage === false) {
                throw new ForbiddenException('⛔ شما مجوز ارسال تصویر را ندارید.');
            }
        }

        const sid = sessionId || this.DEFAULT_SESSION_ID;
        const sock = this.sessions.get(sid);

        // تلاش مجدد در صورت قطعی لحظه‌ای
        if ((!sock || !sock.user) && retryCount < 3) {
            console.log(`⚠️ Robot appears offline. Waiting 5s... (Attempt ${retryCount + 1}/3)`);
            await new Promise(r => setTimeout(r, 5000));
            return this.sendImageBuffer(sessionId, phone, fileBuffer, caption, userId, retryCount + 1);
        }

        if (!sock || !sock.user) throw new BadRequestException('ربات قطع است.');

        // تمیزکاری شماره
        let cleanPhone = phone.replace(/\D/g, '');
        if (cleanPhone.startsWith('09')) cleanPhone = '98' + cleanPhone.substring(1);
        const jid = `${cleanPhone}@s.whatsapp.net`;

        try {
            // ارسال عکس
            const sentMsg = await sock.sendMessage(jid, { image: fileBuffer, caption: caption });
            
            // ذخیره در دیتابیس (اختیاری ولی توصیه می‌شود)
            // اگر می‌خواهید پیام‌های عکس هم در چت لاگ شوند، باید کد ذخیره در Message را اینجا اضافه کنید
            // (مشابه sendTextMessage)

            return { status: 'sent', messageId: sentMsg?.key?.id };
        } catch (error: any) {
            if (retryCount < 3) {
                await new Promise(r => setTimeout(r, 5000));
                return this.sendImageBuffer(sessionId, phone, fileBuffer, caption, userId, retryCount + 1);
            }
            throw new BadRequestException('خطا در ارسال عکس: ' + error.message);
        }
    }

    async sendDocumentMessage(sessionId: string, phone: string, fileUrl: string, fileName: string, caption: string, userId: number) {
        // 🔒 ۱. بررسی مجوز ارسال فایل
        const agent = await this.prisma.agent.findFirst({
            where: { userId: userId }
        });

        if (agent && agent.canSendFile === false) {
            throw new ForbiddenException('⛔ شما مجوز ارسال فایل را ندارید.');
        }

        // ۲. ارسال پیام
        // توجه: این تابع نهایتاً sendTextMessage را صدا می‌زند، پس ایجنت باید مجوز ارسال متن را هم داشته باشد.
        return this.sendTextMessage(sessionId, phone, `${caption}\n\n📥 دانلود فایل: ${fileUrl}`, userId);
    }

    async getConversations(sessionId: string, user?: any) {
        const sid = sessionId || this.DEFAULT_SESSION_ID;
        
        // شرط پیش‌فرض: فقط مکالمات این سشن واتساپ
        const whereCondition: any = { sessionId: sid };

        // 👮‍♂️ لاجیک امنیتی برای ایجنت‌ها
        if (user && user.role === 'AGENT') {
            // ۱. پیدا کردن شناسه ایجنت از روی User ID
            const agent = await this.prisma.agent.findFirst({
                where: { userId: user.userId }
                
            });
            
            if (agent) {
                if (agent.canViewInbox === false) {
                    throw new ForbiddenException('⛔ شما مجوز مشاهده صندوق پیام‌ها (Team Inbox) را ندارید.');
                }
                whereCondition.assignedTo = agent.id;
            } else {
                // اگر ایجنت پیدا نشد، هیچ چتی نشان نده (امنیت)
                return [];
            }
        }

        // ۳. اجرای کوئری
        return this.prisma.conversation.findMany({
            where: whereCondition,
            include: { 
                contact: true, 
                messages: { take: 1, orderBy: { createdAt: 'desc' } } 
            },
            orderBy: { lastMessageAt: 'desc' }
        });
    }

    async getConversationMessages(conversationId: number) {
        const messages = await this.prisma.message.findMany({
            where: { conversationId },
            orderBy: { createdAt: 'asc' }
        });

        await this.prisma.conversation.update({
            where: { id: conversationId },
            data: { unreadCount: 0 }
        });

        return messages;
    }

    async getWebhook(sessionId: string) {
        const url = await this.webhookService.getUrl(sessionId);
        return { url: url || '' };
    }

    async setWebhook(sessionId: string, url: string, userId: number) {
        const sid = sessionId || this.DEFAULT_SESSION_ID;
        await this.prisma.session.upsert({
            where: { id: sid },
            update: { webhookUrl: url },
            create: { id: sid, userId, status: 'DISCONNECTED', webhookUrl: url }
        });
        await this.webhookService.setUrl(sid, url);
        return { status: 'success', url };
    }

    async testWebhook(sessionId: string, customUrl?: string, type: 'text' | 'image' | 'status' = 'text', customText?: string) {
        let targetUrl: string | null | undefined = customUrl;
        if (!targetUrl) targetUrl = await this.webhookService.getUrl(sessionId);
        if (!targetUrl) throw new BadRequestException('آدرس وب‌هوک مشخص نیست.');

        const timestamp = Math.floor(Date.now() / 1000);
        const msgId = 'TEST_ID_' + Date.now();

        let changesValue: any = {
            messaging_product: 'whatsapp',
            metadata: { display_phone_number: '123456', phone_number_id: sessionId },
        };

        if (type === 'status') {
            changesValue.statuses = [{
                id: msgId,
                status: 'read',
                timestamp: timestamp,
                recipient_id: '989123456789',
                conversation: { id: 'CONV_ID', origin: { type: 'user_initiated' } },
                pricing: { billable: true, pricing_model: 'CBP', category: 'business_initiated' }
            }];
        } else if (type === 'image') {
            changesValue.messages = [{
                from: '989123456789',
                id: msgId,
                timestamp: timestamp,
                type: 'image',
                image: {
                    mime_type: 'image/jpeg',
                    id: 'MEDIA_ID',
                    // 👇 اگر متن داشت جایگزین کپشن کن
                    caption: customText || 'این یک عکس تستی است'
                }
            }];
        } else {
            // حالت پیش‌فرض (text)
            changesValue.messages = [{
                from: '989123456789',
                id: msgId,
                timestamp: timestamp,
                type: 'text',
                text: { 
                    // 👇 اگر متن داشت آن را بفرست، وگرنه متن پیش‌فرض
                    body: customText || '✅ تست اتصال: این یک پیام متنی آزمایشی است.' 
                }
            }];
        }

        const testPayload = {
            object: 'whatsapp_business_account',
            entry: [{ id: sessionId, changes: [{ field: 'messages', value: changesValue }] }]
        };

        try {
            const axios = require('axios');
            await axios.post(targetUrl, testPayload, { timeout: 10000 });
            return { status: 'success', testedUrl: targetUrl, scenario: type, sentText: customText || 'Default' };
        } catch (error: any) {
            throw new BadRequestException(`تست شکست خورد: ${error.message}`);
        }
    }

    async deleteWebhook(sessionId: string) {
        await this.prisma.session.update({
            where: { id: sessionId },
            data: { webhookUrl: null }
        });
        await this.webhookService.setUrl(sessionId, '');
        return { status: 'deleted' };
    }

    private async saveSessionToDb(id: string, status: string, userId: number, phone?: string) {
        try { await this.prisma.session.upsert({ where: { id }, update: { status, phone }, create: { id, status, phone, userId } }); } catch (e) { }
    }
}