import { Injectable, OnModuleInit } from '@nestjs/common';
import makeWASocket, { DisconnectReason, useMultiFileAuthState } from '@whiskeysockets/baileys';
import * as qrcode from 'qrcode-terminal';
import pino from 'pino';
import * as fs from 'fs';
import { PrismaService } from '../prisma/prisma.service'; // ایمپورت دیتابیس

@Injectable()
export class WhatsappService implements OnModuleInit {
  private sessions = new Map<string, any>();

  // تزریق سرویس دیتابیس
  constructor(private prisma: PrismaService) {}

  async onModuleInit() {
    // بازیابی سشن‌ها از روی فایل هنگام ریستارت
    const authDir = 'auth_info';
    if (fs.existsSync(authDir)) {
      const sessionFolders = fs.readdirSync(authDir);
      console.log(`🔄 Found ${sessionFolders.length} sessions on disk. Reconnecting...`);
      for (const sessionId of sessionFolders) {
        this.createSession(sessionId);
      }
    }
  }

  async createSession(sessionId: string) {
    const authFolder = `auth_info/${sessionId}`;
    const { state, saveCreds } = await useMultiFileAuthState(authFolder);

    const sock = makeWASocket({
      auth: state,
      logger: pino({ level: 'silent' }) as any,
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 60000,
    });

    this.sessions.set(sessionId, sock);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        console.log(`\nScan QR for session: ${sessionId}`);
        qrcode.generate(qr, { small: true });
        
        // آپدیت وضعیت در دیتابیس (منتظر اسکن)
        await this.prisma.session.upsert({
            where: { id: sessionId },
            update: { status: 'SCAN_QR' },
            create: { id: sessionId, status: 'SCAN_QR' }
        });
      }

      if (connection === 'close') {
        const shouldReconnect = (lastDisconnect?.error as any)?.output?.statusCode !== DisconnectReason.loggedOut;
        
        // آپدیت دیتابیس (قطع شد)
        await this.prisma.session.update({ where: { id: sessionId }, data: { status: 'DISCONNECTED' } }).catch(() => {});

        if (shouldReconnect) {
          setTimeout(() => this.createSession(sessionId), 3000);
        } else {
          console.log(`Session ${sessionId} logged out.`);
          this.sessions.delete(sessionId);
        }
      } else if (connection === 'open') {
        console.log(`✅ Session ${sessionId} is ready!`);
        
        // آپدیت دیتابیس (متصل شد + ذخیره شماره متصل شده)
        const myPhone = sock.user?.id?.split(':')[0];
        await this.prisma.session.upsert({
            where: { id: sessionId },
            update: { status: 'CONNECTED', phone: myPhone },
            create: { id: sessionId, status: 'CONNECTED', phone: myPhone }
        });
      }
    });

    sock.ev.on('creds.update', saveCreds);

    // --- ذخیره پیام‌های دریافتی ---
    sock.ev.on('messages.upsert', async (m) => {
      const msg = m.messages[0];
      const senderJid = msg.key.remoteJid;

      if (m.type === 'notify' && senderJid) {
        const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || msg.message?.imageMessage?.caption || '';
        const isFromMe = msg.key.fromMe || false;

        // ذخیره در دیتابیس
        await this.prisma.message.create({
            data: {
                text: text,
                sender: senderJid.replace('@s.whatsapp.net', ''),
                receiver: 'ME',
                isFromMe: isFromMe,
                type: msg.message?.imageMessage ? 'image' : 'text',
                sessionId: sessionId
            }
        });
        console.log(`💾 Incoming message saved for ${sessionId}`);
        
        // چت بات ساده
        if (!isFromMe && text.trim() === 'سلام') {
            await sock.sendMessage(senderJid, { text: 'سلام! ربات هستم 🤖' }, { quoted: msg });
        }
      }
    });

    return { status: 'initializing', sessionId };
  }

  // تابع کمکی برای اطمینان از اتصال
  private async waitForConnection(sessionId: string, sock: any): Promise<boolean> {
    if (sock.ws.isOpen) return true;
    let retries = 0;
    while (retries < 10) {
        if (sock.ws.isOpen) return true;
        await new Promise(r => setTimeout(r, 500));
        retries++;
    }
    return false;
  }

  async sendTextMessage(sessionId: string, phone: string, message: string) {
    const sock = this.sessions.get(sessionId);
    if (!sock) throw new Error(`Session ${sessionId} not found!`);
    await this.waitForConnection(sessionId, sock);

    const jid = `${phone}@s.whatsapp.net`;
    await sock.sendMessage(jid, { text: message });

    // --- ذخیره پیام ارسالی در دیتابیس ---
    await this.prisma.message.create({
        data: {
            text: message,
            sender: 'ME',
            receiver: phone,
            isFromMe: true,
            type: 'text',
            sessionId: sessionId
        }
    });

    return { status: 'success', sessionId, phone };
  }

  async sendImageMessage(sessionId: string, phone: string, imageSource: string, caption: string, isLocalFile: boolean = false) {
    const sock = this.sessions.get(sessionId);
    if (!sock) throw new Error(`Session ${sessionId} not found!`);
    
    await this.waitForConnection(sessionId, sock);

    const jid = `${phone}@s.whatsapp.net`;
    let imagePayload: any;

    if (isLocalFile) {
        try {
            const imageBuffer = fs.readFileSync(imageSource);
            imagePayload = { image: imageBuffer, caption: caption };
        } catch (error) {
            throw new Error(`Local file not found: ${imageSource}`);
        }
    } else {
        imagePayload = { image: { url: imageSource }, caption: caption };
    }

    await sock.sendMessage(jid, imagePayload);

    // --- ذخیره پیام تصویری در دیتابیس ---
    await this.prisma.message.create({
        data: {
            text: caption || '[IMAGE]',
            sender: 'ME',
            receiver: phone,
            isFromMe: true,
            type: 'image',
            sessionId: sessionId
        }
    });

    return { status: 'success', sessionId, type: 'image' };
  }
}