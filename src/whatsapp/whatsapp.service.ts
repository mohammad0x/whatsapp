import { Injectable, OnModuleInit, NotFoundException } from '@nestjs/common';
import makeWASocket, { DisconnectReason, useMultiFileAuthState } from '@whiskeysockets/baileys';
import * as QRCode from 'qrcode'; 
import * as qrcodeTerminal from 'qrcode-terminal';
import pino from 'pino';
import * as fs from 'fs';
import axios from 'axios';
import { PrismaService } from '../prisma/prisma.service';
import { ChatbotService } from './chatbot.service';

@Injectable()
export class WhatsappService implements OnModuleInit {
  private sessions = new Map<string, any>();
  private qrCodes = new Map<string, string>();

  constructor(
    private prisma: PrismaService,
    private chatbotService: ChatbotService
  ) {}

  // 🔄 بازیابی خودکار تمام سشن‌های موجود در هنگام شروع سرور
  async onModuleInit() {
    const authDir = 'auth_info';
    if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });

    const folders = fs.readdirSync(authDir);
    for (const sessionId of folders) {
      if(fs.existsSync(`${authDir}/${sessionId}/creds.json`)) {
           console.log(`🔄 در حال بازیابی نشست: ${sessionId}`);
           
           // تشخیص UserId از نام سشن (مثلا از session_2 عدد 2 را برمی‌دارد)
           const parts = sessionId.split('_');
           const userId = parts.length > 1 ? parseInt(parts[1]) : 0;
           
           // تلاش برای اتصال مجدد (isNew = false)
           await this.createSession(sessionId, userId, false);
      }
    }
  }

  // 📊 مشاهده وضعیت زنده ربات
  async getSessionStatus(sessionId: string, userId: number) {
    const sock = this.sessions.get(sessionId);
    
    // اگر وصل بود
    if(sock?.user) {
        return { 
            status: 'CONNECTED', 
            qr: null, 
            phone: sock.user.id.split(':')[0], 
            sessionId 
        };
    }
    
    // اگر در حال انتظار برای اسکن بود
    const qr = this.qrCodes.get(sessionId);
    if (qr) return { status: 'SCAN_QR', qr, sessionId };

    // بررسی دیتابیس
    const sessionRecord = await this.prisma.session.findUnique({ where: { id: sessionId } });
    if (!sessionRecord) return { status: 'NOT_CREATED', message: 'ابتدا ربات را استارت بزنید', sessionId };

    return { status: 'DISCONNECTED', qr: null, sessionId };
  }

  // 🔥 هسته اصلی ساخت اتصال واتساپ
  async createSession(sessionId: string, userId: number, isNew = true) {
    if (this.sessions.has(sessionId)) return { message: 'ربات در حال حاضر فعال است', sessionId };

    const authFolder = `auth_info/${sessionId}`;
    const { state, saveCreds } = await useMultiFileAuthState(authFolder);

    const sock = makeWASocket({
      auth: state,
      logger: pino({ level: 'silent' }) as any, 
      connectTimeoutMs: 60000,
      printQRInTerminal: false, // چاپ دستی برای زیبایی بیشتر
      browser: ['WhatsApp 360 Clone', 'Chrome', '1.0.0'],
      retryRequestDelayMs: 5000,
    });

    this.sessions.set(sessionId, sock);

    // مدیریت رویدادهای اتصال
    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      // نمایش QR کد
      if (qr) {
        console.log(`\n📷 اسکن کنید (${sessionId}):`);
        qrcodeTerminal.generate(qr, { small: true });
        const qrImage = await QRCode.toDataURL(qr);
        this.qrCodes.set(sessionId, qrImage);
        
        // ذخیره وضعیت در دیتابیس (اطمینان از وجود رکورد)
        await this.saveSessionToDb(sessionId, 'SCAN_QR', userId);
      }

      // اتصال موفق
      if (connection === 'open') {
        console.log(`✅ ربات ${sessionId} با موفقیت متصل شد!`);
        this.qrCodes.delete(sessionId);
        const myPhone = sock.user?.id?.split(':')[0];
        
        // آپدیت دیتابیس
        await this.saveSessionToDb(sessionId, 'CONNECTED', userId, myPhone);
      }
      
      // قطع اتصال
      if (connection === 'close') {
          const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
          this.qrCodes.delete(sessionId); 

          if (shouldReconnect) {
              console.log(`⚠️ اتصال ${sessionId} قطع شد، در حال تلاش مجدد...`);
              this.sessions.delete(sessionId);
              setTimeout(() => this.createSession(sessionId, userId, false), 3000);
          } else {
              console.log(`❌ سشن ${sessionId} لاگ‌اوت شد.`);
              this.sessions.delete(sessionId);
              try { fs.rmSync(authFolder, { recursive: true, force: true }); } catch(e) {}
              await this.prisma.session.update({ where: { id: sessionId }, data: { status: 'DISCONNECTED' } }).catch(() => {});
          }
      }
    });

    sock.ev.on('creds.update', saveCreds);

    // 📩 مدیریت هوشمند پیام‌های دریافتی (ضد لوپ + کلمات کلیدی داینامیک)
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      try {
        // ۱. فقط پیام‌های جدید واقعی (Notify) را پردازش کن (جلوگیری از لوپ 'append')
        if (type !== 'notify') return;

        const msg = messages[0];
        // ۲. اگر پیام از طرف خودِ ربات بود، نادیده بگیر
        if (!msg.message || msg.key.fromMe) return; 

        const senderJid = msg.key.remoteJid;
        if (!senderJid || senderJid === 'status@broadcast') return;

        const senderClean = senderJid.split('@')[0].split(':')[0];

        // 🛡️ ۳. جلوگیری از لوپ بین دو رباتِ خودمان (Enterprise Protection)
        // چک می‌کنیم آیا فرستنده خودش یکی از شماره‌های ثبت شده در کل سیستم ماست؟
        const isInternalBot = await this.prisma.session.findFirst({
            where: { phone: senderClean }
        });
        if (isInternalBot) return; 

        // تشخیص محتوای پیام
        const messageType = Object.keys(msg.message)[0];
        let text = '';
        let messageContentType = 'text';

        if (messageType === 'conversation') {
            text = msg.message.conversation || '';
        } else if (messageType === 'extendedTextMessage') {
            text = msg.message.extendedTextMessage?.text || '';
        } else if (messageType === 'imageMessage') {
            messageContentType = 'image';
            text = msg.message.imageMessage?.caption || '[Photo]';
        } else if (messageType === 'videoMessage') {
            messageContentType = 'video';
            text = msg.message.videoMessage?.caption || '[Video]';
        } else if (messageType === 'documentMessage') {
            messageContentType = 'document';
            text = msg.message.documentMessage?.caption || msg.message.documentMessage?.fileName || '[File]';
        } else {
            return; 
        }

        // ۴. چک کردن تکراری نبودن (Double-Check)
        const recentDuplicate = await this.prisma.message.findFirst({
            where: {
                sessionId,
                text, 
                sender: senderClean,
                createdAt: { gte: new Date(Date.now() - 2000) } 
            }
        });
        if (recentDuplicate) return;

        console.log(`📩 پیام جدید از ${senderClean}: ${text}`);

        // ۵. ذخیره پیام در دیتابیس
        const savedMsg = await this.prisma.message.create({
            data: {
                text: text,
                sender: senderClean,
                receiver: 'ME',
                isFromMe: false,
                type: messageContentType,
                sessionId: sessionId
            }
        });

        // ۶. ارسال وب‌هوک به سرور مشتری
        await this.triggerWebhook(sessionId, {
            event: 'message.received',
            data: {
                id: savedMsg.id,
                wa_id: msg.key.id,
                from: senderClean,
                type: messageContentType,
                body: text,
                timestamp: Math.floor(Date.now() / 1000),
                pushName: msg.pushName || ''
            }
        });

        // 🤖 ۷. چت‌بات با کلمات کلیدی داینامیک
  // 🤖 چت‌بات هوشمند (کلمات کلیدی + پاسخ پیش‌فرض)
        const currentSession = await this.prisma.session.findUnique({
             where: { id: sessionId },
             select: { userId: true, defaultResponse: true } // گرفتن پاسخ پیش‌فرض
        });

        if (currentSession?.userId && messageContentType === 'text') {
             // ۱. اول بگرد دنبال کلمه کلیدی
             let botResponse = await this.chatbotService.getResponse(currentSession.userId, text);
             
             // ۲. اگر کلمه کلیدی پیدا نشد، از پاسخ پیش‌فرض استفاده کن
             if (!botResponse) {
                 botResponse = currentSession.defaultResponse;
             }
             
             // ۳. ارسال نهایی
             if (botResponse) {
                 console.log(`🤖 پاسخ ربات به ${senderClean}: ${botResponse}`);
                 await new Promise(r => setTimeout(r, 1000));
                 await this.sendTextMessage(sessionId, senderJid, botResponse, 0);
             }
        }
      } catch (error) {
          console.error('❌ خطای پردازش پیام:', error.message);
      }
    });

    return { message: 'ربات با موفقیت فعال شد', sessionId };
  }

  // 🔗 ارسال داده‌ها به URL وب‌هوک
  private async triggerWebhook(sessionId: string, payload: any) {
      try {
          const session = await this.prisma.session.findUnique({ 
              where: { id: sessionId },
              select: { webhookUrl: true } 
          });

          if (session?.webhookUrl) {
              console.log(`🚀 ارسال وب‌هوک به: ${session.webhookUrl}`);
              await axios.post(session.webhookUrl, payload, { timeout: 5000 });
          }
      } catch (error) {
          console.error(`⚠️ وب‌هوک ناموفق: ${error.message}`);
      }
  }

  // 🛠️ تنظیم آدرس وب‌هوک
  async setWebhook(sessionId: string, url: string, userId: number) {
    // اطمینان از وجود سشن در دیتابیس قبل از آپدیت
    await this.saveSessionToDb(sessionId, 'CONNECTED', userId);
    return this.prisma.session.update({ where: { id: sessionId }, data: { webhookUrl: url } });
  }

  // 🚀 ارسال پیام متنی (هوشمند برای LID و شماره)
  async sendTextMessage(sessionId: string, phoneOrJid: string, message: string, userId: number) {
    let sock = this.sessions.get(sessionId);
    
    // تشخیص JID
    let jid = phoneOrJid.includes('@') ? phoneOrJid : `${phoneOrJid.replace(/\D/g, '').replace(/^0/, '98')}@s.whatsapp.net`;
    let receiverNum = jid.split('@')[0].split(':')[0];

    if (!sock) {
         const exists = await this.prisma.session.findUnique({ where: { id: sessionId }});
         if(!exists) throw new NotFoundException('نشست پیدا نشد. ابتدا ربات را روشن کنید.');
         await this.createSession(sessionId, userId, false);
         await new Promise(r => setTimeout(r, 3000));
         sock = this.sessions.get(sessionId);
    }
    if (!sock) throw new Error('اتصال برقرار نشد.');

    await this.waitForConnection(sock);
    await sock.sendMessage(jid, { text: message });

    // ذخیره پیام ارسالی ما در دیتابیس
    await this.prisma.message.create({
        data: { text: message, sender: 'ME', receiver: receiverNum, isFromMe: true, type: 'text', sessionId }
    });
    return { status: 'sent', phone: receiverNum };
  }
  
  // 📷 ارسال عکس
  async sendImageBuffer(sessionId: string, phone: string, fileBuffer: Buffer, caption: string, userId: number) {
      let sock = this.sessions.get(sessionId);
      const formattedPhone = phone.replace(/\D/g, '').replace(/^0/, '98');
      const jid = `${formattedPhone}@s.whatsapp.net`;

      if (!sock) { await this.createSession(sessionId, userId, false); await new Promise(r => setTimeout(r, 3000)); sock = this.sessions.get(sessionId); }
      await this.waitForConnection(sock);
      
      await sock.sendMessage(jid, { image: fileBuffer, caption, mimetype: 'image/jpeg' });
      await this.prisma.message.create({ data: { text: caption || '[IMAGE]', sender: 'ME', receiver: formattedPhone, isFromMe: true, type: 'image', sessionId } });
      return { status: 'sent', type: 'image' };
  }

  // 📂 ارسال فایل (لینک یا آدرس محلی)
  async sendDocumentMessage(sessionId: string, phone: string, fileUrl: string, fileName: string, caption: string, userId: number) {
      let sock = this.sessions.get(sessionId);
      const formattedPhone = phone.replace(/\D/g, '').replace(/^0/, '98');
      const jid = `${formattedPhone}@s.whatsapp.net`;

      let buffer: Buffer;
      let mimetype: string = 'application/octet-stream';

      try {
          if (fileUrl.startsWith('http')) {
              const response = await axios.get(fileUrl, { responseType: 'arraybuffer' });
              buffer = Buffer.from(response.data, 'binary');
              mimetype = response.headers['content-type'] || mimetype;
          } else {
              buffer = fs.readFileSync(fileUrl);
          }
      } catch (e) { throw new Error('خطا در دریافت فایل'); }

      if (!sock) { await this.createSession(sessionId, userId, false); await new Promise(r => setTimeout(r, 3000)); sock = this.sessions.get(sessionId); }
      await this.waitForConnection(sock);

      await sock.sendMessage(jid, { document: buffer, mimetype, fileName, caption });
      await this.prisma.message.create({ data: { text: caption || `[FILE: ${fileName}]`, sender: 'ME', receiver: formattedPhone, isFromMe: true, type: 'document', sessionId } });
      return { status: 'success' };
  }

  // 👥 دریافت لیست مخاطبین (بر اساس پیام‌های قبلی)
  async getContacts(sessionId: string) {
      return this.prisma.message.findMany({ 
          where: { sessionId }, 
          orderBy: { createdAt: 'desc' }, 
          distinct: ['sender', 'receiver'] 
      });
  }

  // 💬 دریافت تاریخچه چت
  async getChatHistory(sessionId: string, phone: string) {
      const clean = phone.replace(/\D/g, ''); 
      return this.prisma.message.findMany({ 
          where: { sessionId, OR: [{ sender: clean }, { receiver: clean }] }, 
          orderBy: { createdAt: 'asc' } 
      });
  }

  // 💾 متد کمکی برای ذخیره امن سشن در دیتابیس (جلوگیری از خطای Foreign Key)
  private async saveSessionToDb(id: string, status: string, userId: number, phone?: string) {
    if(!userId || userId === 0) return;
    try { 
        await this.prisma.session.upsert({ 
            where: { id }, 
            update: { status, phone }, 
            create: { id, status, phone, userId } 
        }); 
    } catch(e) {
        console.error('❌ خطای دیتابیس (Upsert):', e.message);
    }
  }

  // ⏳ انتظار برای آماده شدن سوکت
  private async waitForConnection(sock: any): Promise<void> {
    if (sock?.user && sock?.ws?.isOpen) return;
    let attempts = 0;
    while (attempts < 10) {
        if (sock?.user && sock?.ws?.isOpen) return;
        await new Promise(r => setTimeout(r, 500));
        attempts++;
    }
    throw new Error('اتصال برقرار نشد، لطفا مجدد تلاش کنید.');
  }
}