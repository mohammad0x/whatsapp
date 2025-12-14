import { Injectable, OnModuleInit } from '@nestjs/common';
import makeWASocket, { DisconnectReason, useMultiFileAuthState } from '@whiskeysockets/baileys';
import * as QRCode from 'qrcode';
import pino from 'pino';
import * as fs from 'fs';
import axios from 'axios';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class WhatsappService implements OnModuleInit {
  private sessions = new Map<string, any>();
  private qrCodes = new Map<string, string>();

  constructor(private prisma: PrismaService) {}

  // 🔄 بازیابی نشست‌ها
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

  // 🔥 هسته اصلی
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

    // 📩 مدیریت پیام‌ها (بخش اصلاح شده و نهایی)
    sock.ev.on('messages.upsert', async (m) => {
      try {
        const msg = m.messages[0];
        if (!msg.message) return;

        const senderJid = msg.key.remoteJid;
        const isFromMe = msg.key.fromMe;
        
        // 🛠️ اصلاح ۱: اگر فرستنده نامشخص است، کلاً ادامه نده (حل مشکل Null)
        if (!senderJid) return;

        // 🕵️‍♂️ لاگ برای دیباگ
        console.log(`📨 Msg: ${senderJid} | FromMe: ${isFromMe}`);

        // فیلتر زمانی
        const messageTimestamp = typeof msg.messageTimestamp === 'number' 
            ? msg.messageTimestamp 
            : (msg.messageTimestamp as any)?.low;
        const now = Math.floor(Date.now() / 1000);
        if (messageTimestamp && (now - messageTimestamp > 60)) return;

        // فیلتر هویت (جلوگیری از پاسخ به خود)
        if (isFromMe) return;

        // 🛠️ اصلاح ۲: پشتیبانی از LID و کاربران عادی
        const isUser = senderJid.endsWith('@s.whatsapp.net') || senderJid.endsWith('@lid');

        if (isUser) {
            const text = msg.message.conversation || 
                         msg.message.extendedTextMessage?.text || 
                         msg.message.imageMessage?.caption || '';

            if (!text) return;

            console.log(`✅ Processing Message: ${text}`);

            // استخراج شناسه صحیح
            const phone = senderJid.endsWith('@lid') ? senderJid : senderJid.replace('@s.whatsapp.net', '');

            // ارسال به وب‌هوک
            const session = await this.prisma.session.findUnique({ where: { id: sessionId } });
            if (session && session.webhookUrl) {
                axios.post(session.webhookUrl, {
                    event: 'message',
                    sessionId: sessionId,
                    phone: phone,
                    text: text,
                    timestamp: new Date()
                }).catch(err => console.error(`❌ Webhook Failed: ${err.message}`));
            }
            
            // ذخیره در دیتابیس
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
        }
      } catch (error) {
          console.error('Upsert Error:', error);
      }
    });

    return { status: 'initializing', sessionId };
  }

  // --- ارسال پیام ---

  private async validateUserAccess(sessionId: string, userId: number) {
    const session = await this.prisma.session.findUnique({ where: { id: sessionId } });
    if (!session || session.userId !== userId) throw new Error('⛔ Access Denied');
  }

  private async waitForConnection(sessionId: string, sock: any): Promise<boolean> {
    if (sock.ws.isOpen) return true;
    for (let i = 0; i < 10; i++) {
        if (sock.ws.isOpen) return true;
        await new Promise(r => setTimeout(r, 500));
    }
    throw new Error('Connection timed out');
  }

  async sendTextMessage(sessionId: string, phone: string, message: string, userId: number) {
    await this.validateUserAccess(sessionId, userId);
    const sock = this.sessions.get(sessionId);
    if (!sock) throw new Error(`Session ${sessionId} not active!`);
    await this.waitForConnection(sessionId, sock);

    // مدیریت آدرس‌های LID و عادی
    const jid = (phone.includes('@') || phone.includes(':')) ? phone : `${phone}@s.whatsapp.net`;

    await sock.sendMessage(jid, { text: message });

    await this.prisma.message.create({
        data: {
            text: message,
            sender: 'ME',
            receiver: phone,
            isFromMe: true,
            type: 'text',
            sessionId
        }
    });

    return { status: 'success', sessionId, phone };
  }

  async sendImageMessage(sessionId: string, phone: string, imageSource: string, caption: string, isLocalFile: boolean, userId: number) {
    await this.validateUserAccess(sessionId, userId);
    const sock = this.sessions.get(sessionId);
    if (!sock) throw new Error('Session not active');
    await this.waitForConnection(sessionId, sock);

    const jid = (phone.includes('@') || phone.includes(':')) ? phone : `${phone}@s.whatsapp.net`;
    let imagePayload: any;

    if (isLocalFile) {
        try {
            imagePayload = { image: fs.readFileSync(imageSource), caption };
        } catch (error) { throw new Error(`File not found: ${imageSource}`); }
    } else {
        imagePayload = { image: { url: imageSource }, caption };
    }

    await sock.sendMessage(jid, imagePayload);
    
    await this.prisma.message.create({
        data: {
            text: caption || '[IMAGE]',
            sender: 'ME',
            receiver: phone,
            isFromMe: true,
            type: 'image',
            sessionId
        }
    });

    return { status: 'success', type: 'image' };
  }
}