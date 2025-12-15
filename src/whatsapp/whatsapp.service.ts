import { Injectable, OnModuleInit } from '@nestjs/common';
import makeWASocket, { DisconnectReason, useMultiFileAuthState } from '@whiskeysockets/baileys';
import * as QRCode from 'qrcode';
import pino from 'pino';
import * as fs from 'fs';
import axios from 'axios';
import { PrismaService } from '../prisma/prisma.service';
import { ChatbotService } from './chatbot.service'; // 👈 ایمپورت چت‌بات

@Injectable()
export class WhatsappService implements OnModuleInit {
  private sessions = new Map<string, any>();
  private qrCodes = new Map<string, string>();

  constructor(
    private prisma: PrismaService,
    private chatbotService: ChatbotService // 👈 تزریق سرویس چت‌بات
  ) {}

  // 🔄 بازیابی نشست‌ها هنگام ریستارت
  async onModuleInit() {
    const authDir = 'auth_info';
    if (fs.existsSync(authDir)) {
      const sessionFolders = fs.readdirSync(authDir);
      console.log(`🔄 Found ${sessionFolders.length} sessions. Recovering...`);
      for (const sessionId of sessionFolders) {
        const sessionData = await this.prisma.session.findUnique({ where: { id: sessionId } });
        if (sessionData) {
          await this.createSession(sessionId, sessionData.userId);
        }
      }
    }
  }

  // 📊 وضعیت سشن
  async getSessionStatus(sessionId: string, userId: number) {
    const session = await this.prisma.session.findUnique({ where: { id: sessionId } });
    
    if (!session || session.userId !== userId) {
        return { status: 'NOT_FOUND', qr: null };
    }
    if (session.status === 'CONNECTED') {
        return { status: 'CONNECTED', qr: null, phone: session.phone };
    }
    const qr = this.qrCodes.get(sessionId) || null;
    return { status: session.status, qr: qr };
  }

  // 🔗 تنظیم وب‌هوک
  async setWebhook(sessionId: string, url: string, userId: number) {
    const session = await this.prisma.session.findUnique({ where: { id: sessionId } });
    if (!session || session.userId !== userId) throw new Error('⛔ Access Denied');

    await this.prisma.session.update({
        where: { id: sessionId },
        data: { webhookUrl: url }
    });
    console.log(`✅ Webhook set for ${sessionId}: ${url}`);
    return { message: 'Webhook updated', sessionId, url };
  }

  // 💾 ذخیره امن در دیتابیس
  private async saveSessionToDb(sessionId: string, status: string, userId: number, phone?: string) {
    try {
        await this.prisma.session.upsert({
            where: { id: sessionId },
            update: { status, phone },
            create: { id: sessionId, status, phone, user: { connect: { id: userId } } }
        });
    } catch (error) {
        if (error.code === 'P2002') {
            await this.prisma.session.update({ where: { id: sessionId }, data: { status, phone } });
        }
    }
  }

  // 🔥 هسته اصلی: ساخت اتصال واتساپ
  async createSession(sessionId: string, userId: number) {
    const authFolder = `auth_info/${sessionId}`;
    const { state, saveCreds } = await useMultiFileAuthState(authFolder);

    const sock = makeWASocket({
      auth: state,
      logger: pino({ level: 'silent' }) as any,
      connectTimeoutMs: 60000,
      printQRInTerminal: false,
    });

    this.sessions.set(sessionId, sock);

    // مدیریت رویدادهای اتصال
    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        console.log(`Scan QR for: ${sessionId}`);
        const qrImage = await QRCode.toDataURL(qr);
        this.qrCodes.set(sessionId, qrImage);
        await this.saveSessionToDb(sessionId, 'SCAN_QR', userId);
      }

      if (connection === 'open') {
        console.log(`✅ Session ${sessionId} CONNECTED!`);
        this.qrCodes.delete(sessionId);
        const myPhone = sock.user?.id?.split(':')[0];
        await this.saveSessionToDb(sessionId, 'CONNECTED', userId, myPhone);
      }
      
      if (connection === 'close') {
          const shouldReconnect = (lastDisconnect?.error as any)?.output?.statusCode !== DisconnectReason.loggedOut;
          await this.prisma.session.update({ where: { id: sessionId }, data: { status: 'DISCONNECTED' } }).catch(() => {});
          
          if (shouldReconnect) {
              setTimeout(() => this.createSession(sessionId, userId), 3000);
          } else {
              console.log(`❌ Session ${sessionId} Logged Out.`);
              this.sessions.delete(sessionId);
              try { fs.rmSync(authFolder, { recursive: true, force: true }); } catch(e) {}
          }
      }
    });

    sock.ev.on('creds.update', saveCreds);

    // 📩 مدیریت پیام‌ها (ترکیب چت‌بات + وب‌هوک)
    sock.ev.on('messages.upsert', async (m) => {
      try {
        const msg = m.messages[0];
        if (!msg.message) return;

        const senderJid = msg.key.remoteJid;
        const isFromMe = msg.key.fromMe;
        
        // اصلاح ۱: جلوگیری از خطای Null
        if (!senderJid) return;

        // فیلتر زمانی
        const messageTimestamp = typeof msg.messageTimestamp === 'number' 
            ? msg.messageTimestamp 
            : (msg.messageTimestamp as any)?.low;
        const now = Math.floor(Date.now() / 1000);
        if (messageTimestamp && (now - messageTimestamp > 60)) return;

        // فیلتر هویت
        if (isFromMe) return;

        // اصلاح ۲: پشتیبانی از LID و کاربران عادی
        const isUser = senderJid.endsWith('@s.whatsapp.net') || senderJid.endsWith('@lid');

        if (isUser) {
            const text = msg.message.conversation || 
                         msg.message.extendedTextMessage?.text || 
                         msg.message.imageMessage?.caption || '';

            if (!text) return;

            console.log(`📨 New Message: ${text} | From: ${senderJid}`);

            // استخراج شناسه صحیح
            const phone = senderJid.endsWith('@lid') ? senderJid : senderJid.replace('@s.whatsapp.net', '');

            // 💾 ۱. اول ذخیره پیام کاربر
            try {
                await this.prisma.message.create({
                    data: {
                        text,
                        sender: phone,
                        receiver: 'ME',
                        isFromMe: false,
                        type: msg.message.imageMessage ? 'image' : 'text',
                        sessionId
                    }
                });
            } catch (e) {}

            // 🤖 ۲. بررسی چت‌بات داخلی (اولویت بالا)
            const botReply = this.chatbotService.getResponse(phone, text);

            if (botReply) {
                console.log(`🤖 Internal Bot Replying: ${botReply}`);
                
                await sock.sendPresenceUpdate('composing', senderJid);
                await new Promise(r => setTimeout(r, 1000));

                const replyJid = senderJid.endsWith('@lid') ? senderJid : `${phone}@s.whatsapp.net`;
                await sock.sendMessage(replyJid, { text: botReply });
                
                await this.prisma.message.create({
                    data: { text: botReply, sender: 'BOT', receiver: phone, isFromMe: true, type: 'text', sessionId }
                });
                
                return; // ⛔ کار تمام شد، دیگر به وب‌هوک نفرست
            }

            // 🌐 ۳. ارسال به وب‌هوک (اگر ربات جوابی نداشت)
            const session = await this.prisma.session.findUnique({ where: { id: sessionId } });
            if (session && session.webhookUrl) {
                console.log(`🚀 Sending to webhook: ${session.webhookUrl}`);
                axios.post(session.webhookUrl, {
                    event: 'message',
                    sessionId: sessionId,
                    phone: phone,
                    text: text,
                    timestamp: new Date()
                }).catch(err => console.error(`❌ Webhook Failed: ${err.message}`));
            }
        }
      } catch (error) {
          console.error('Upsert Error:', error);
      }
    });

    return { status: 'initializing', sessionId };
  }

  // --- ابزارهای ارسال پیام ---

  private async validateUserAccess(sessionId: string, userId: number) {
    const session = await this.prisma.session.findUnique({ where: { id: sessionId } });
    if (!session || session.userId !== userId) throw new Error('⛔ Access Denied');
  }

  private async waitForConnection(sessionId: string, sock: any): Promise<boolean> {
    if (sock.ws.isOpen) return true;
    for (let i = 0; i < 20; i++) {
        if (sock.ws.isOpen) return true;
        await new Promise(r => setTimeout(r, 1000));
    }
    throw new Error('Connection timed out');
  }

  // ارسال متن
  async sendTextMessage(sessionId: string, phone: string, message: string, userId: number) {
    await this.validateUserAccess(sessionId, userId);
    const sock = this.sessions.get(sessionId);
    if (!sock) throw new Error(`Session ${sessionId} not active!`);
    await this.waitForConnection(sessionId, sock);

    const jid = (phone.includes('@') || phone.includes(':')) ? phone : `${phone}@s.whatsapp.net`;
    await sock.sendMessage(jid, { text: message });

    await this.prisma.message.create({
        data: { text: message, sender: 'ME', receiver: phone, isFromMe: true, type: 'text', sessionId }
    });

    return { status: 'success', sessionId, phone };
  }

  // ارسال فایل (PDF, Doc, ...)
  async sendDocumentMessage(sessionId: string, phone: string, fileUrl: string, fileName: string, caption: string, userId: number) {
    await this.validateUserAccess(sessionId, userId);
    const sock = this.sessions.get(sessionId);
    if (!sock) throw new Error('Session not active');
    await this.waitForConnection(sessionId, sock);

    const jid = (phone.includes('@') || phone.includes(':')) ? phone : `${phone}@s.whatsapp.net`;

    try {
        let buffer: Buffer;
        let mimetype: string = 'application/octet-stream';

        // دانلود از اینترنت
        if (fileUrl.startsWith('http://') || fileUrl.startsWith('https://')) {
            console.log(`📥 Downloading: ${fileUrl}`);
            const response = await axios.get(fileUrl, { responseType: 'arraybuffer' });
            buffer = Buffer.from(response.data, 'binary');
            mimetype = response.headers['content-type'] || 'application/pdf';
        } 
        // خواندن از فایل لوکال
        else {
            console.log(`📂 Reading local: ${fileUrl}`);
            if (!fs.existsSync(fileUrl)) throw new Error(`File not found: ${fileUrl}`);
            buffer = fs.readFileSync(fileUrl);
            if (fileName.endsWith('.pdf')) mimetype = 'application/pdf';
        }

        await sock.sendMessage(jid, {
            document: buffer,
            mimetype: mimetype,
            fileName: fileName,
            caption: caption
        });

        await this.prisma.message.create({
            data: { text: caption || `[FILE: ${fileName}]`, sender: 'ME', receiver: phone, isFromMe: true, type: 'document', sessionId }
        });

        return { status: 'success', type: 'document', fileName };
    } catch (error) {
        throw new Error(`Send File Error: ${error.message}`);
    }
  }

  // ارسال عکس
  async sendImageBuffer(sessionId: string, phone: string, fileBuffer: Buffer, caption: string, userId: number) {
    await this.validateUserAccess(sessionId, userId);
    
    const sock = this.sessions.get(sessionId);
    if (!sock) throw new Error('Session not active');
    await this.waitForConnection(sessionId, sock);

    // تمیز کردن شماره
    const cleanPhone = phone.replace('+', '').replace(/^0/, '98');
    const jid = (cleanPhone.includes('@')) ? cleanPhone : `${cleanPhone}@s.whatsapp.net`;

    console.log(`📤 Uploading to ${jid} | Size: ${fileBuffer.length}`);

    if (!Buffer.isBuffer(fileBuffer) || fileBuffer.length === 0) {
        throw new Error('❌ فایل خراب یا خالی است');
    }

    try {
        // تغییر مهم: اضافه کردن mimetype به صورت دستی
        // این کار باعث می‌شود واتساپ گیج نشود
        await sock.sendMessage(jid, {
            image: fileBuffer,
            caption: caption,
            mimetype: 'image/jpeg' // فرض می‌کنیم اکثر عکس‌ها jpeg هستند
        });

        console.log('✅ Image sent to socket');

        // ذخیره در دیتابیس
        await this.prisma.message.create({
            data: {
                text: caption || '[UPLOADED IMAGE]',
                sender: 'ME',
                receiver: cleanPhone,
                isFromMe: true,
                type: 'image',
                sessionId
            }
        });

        return { status: 'success', type: 'image_upload' };

    } catch (error) {
        console.error('❌ Error sending image:', error);
        throw new Error(`Failed: ${error.message}`);
    }
  }
  // 👇 1. دریافت لیست مخاطبین (برای سایدبار پنل)
  async getContacts(sessionId: string) {
    // همه پیام‌ها را می‌گیریم تا مخاطبین یکتا را پیدا کنیم
    // نکته: در پروژه‌های بزرگ باید جدول جداگانه Contact داشته باشید، اما اینجا فعلا کافیست
    const messages = await this.prisma.message.findMany({
        where: { sessionId },
        orderBy: { createdAt: 'desc' },
        distinct: ['sender', 'receiver'] // فقط یکی از هر کدام
    });

    // فیلتر کردن و تمیز کردن لیست
    const contacts = new Map<string, any>();
    
    messages.forEach(msg => {
        // اگر پیام از طرف من است، گیرنده مخاطب است. اگر از طرف اوست، فرستنده مخاطب است.
        const contactPhone = msg.isFromMe ? msg.receiver : msg.sender;
        
        // جلوگیری از تکرار و حذف پیام‌های سیستمی
        if (contactPhone !== 'ME' && contactPhone !== 'BOT' && !contacts.has(contactPhone)) {
            contacts.set(contactPhone, {
                phone: contactPhone,
                lastMessage: msg.text,
                time: msg.createdAt
            });
        }
    });

    return Array.from(contacts.values());
  }

  // 👇 2. دریافت تاریخچه کامل چت با یک شماره خاص
  async getChatHistory(sessionId: string, phone: string) {
    return this.prisma.message.findMany({
        where: {
            sessionId: sessionId,
            OR: [
                { sender: phone },   // پیام‌هایی که او فرستاده
                { receiver: phone }  // پیام‌هایی که ما فرستادیم
            ]
        },
        orderBy: { createdAt: 'asc' } // از قدیم به جدید (مثل تلگرام/واتساپ)
    });
  }
  // 👇 این متد جدید را اضافه کنید
  // کارش این است که SessionId را بر اساس توکن کاربر پیدا می‌کند
  async getSessionIdByUser(userId: number): Promise<string> {
    const session = await this.prisma.session.findFirst({
        where: { userId: userId }
    });

    if (!session) {
        throw new Error('⛔ شما هنوز هیچ رباتی نساخته‌اید. ابتدا /start را بزنید.');
    }
    return session.id;
  }
}