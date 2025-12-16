import { Injectable, OnModuleInit } from '@nestjs/common';
import makeWASocket, { DisconnectReason, useMultiFileAuthState } from '@whiskeysockets/baileys';
import * as QRCode from 'qrcode';
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

  // 🔄 شروع برنامه
  async onModuleInit() {
    const authDir = 'auth_info';
    if (fs.existsSync(authDir)) {
      const folders = fs.readdirSync(authDir);
      for (const sessionId of folders) {
        if(fs.existsSync(`${authDir}/${sessionId}/creds.json`)) {
             console.log(`🔄 Recovering: ${sessionId}`);
             await this.createSession(sessionId, 0, false);
        }
      }
    }
  }

  // 📊 وضعیت
  async getSessionStatus(sessionId: string, userId: number) {
    const sock = this.sessions.get(sessionId);
    if(sock?.user) return { status: 'CONNECTED', qr: null, phone: sock.user.id.split(':')[0] };
    
    const qr = this.qrCodes.get(sessionId);
    if (qr) return { status: 'SCAN_QR', qr };

    return { status: 'INITIALIZING', qr: null };
  }

  // 🔥 ساخت اتصال
  async createSession(sessionId: string, userId: number, isNew = true) {
    const authFolder = `auth_info/${sessionId}`;
    const { state, saveCreds } = await useMultiFileAuthState(authFolder);

    const sock = makeWASocket({
      auth: state,
      logger: pino({ level: 'silent' }) as any, 
      connectTimeoutMs: 60000,
      browser: ['Whatsapp Panel', 'Chrome', '1.0.0'],
    });

    this.sessions.set(sessionId, sock);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        console.log(`📷 Scan QR for: ${sessionId}`);
        const qrImage = await QRCode.toDataURL(qr);
        this.qrCodes.set(sessionId, qrImage);
        if (isNew) await this.saveSessionToDb(sessionId, 'SCAN_QR', userId);
      }

      if (connection === 'open') {
        console.log(`✅ Session ${sessionId} CONNECTED!`);
        this.qrCodes.delete(sessionId);
        const myPhone = sock.user?.id?.split(':')[0];
        if (isNew) await this.saveSessionToDb(sessionId, 'CONNECTED', userId, myPhone);
      }
      
      if (connection === 'close') {
          const shouldReconnect = (lastDisconnect?.error as any)?.output?.statusCode !== DisconnectReason.loggedOut;
          if (shouldReconnect) {
              setTimeout(() => this.createSession(sessionId, userId, isNew), 3000);
          } else {
              console.log(`❌ Session ${sessionId} Logged Out.`);
              this.sessions.delete(sessionId);
              try { fs.rmSync(authFolder, { recursive: true, force: true }); } catch(e) {}
              await this.prisma.session.update({ where: { id: sessionId }, data: { status: 'DISCONNECTED' } }).catch(() => {});
          }
      }
    });

    sock.ev.on('creds.update', saveCreds);

    // 📩 مدیریت پیام‌های دریافتی (اصلاح شده برای رفع خطای TS)
    // 📩 مدیریت پیام‌ها (تست مستقیم و بدون واسطه)
    sock.ev.on('messages.upsert', async (m) => {
      try {
        const msg = m.messages[0];
        if (!msg.message) return;
        const senderJid = msg.key.remoteJid;
        if (!senderJid) return;

        // فقط پیام‌های متنی
        const text = msg.message.conversation || 
                     msg.message.extendedTextMessage?.text || '';

        if (!text) return; // اگر عکس یا چیز دیگری بود فعلا کاری نداریم

        const isFromMe = msg.key.fromMe;
        console.log(`🔍 [DEBUG] Msg: "${text}" | FromMe: ${isFromMe} | JID: ${senderJid}`);

        // اگر از طرف خودم بود، بیخیال شو
        if (isFromMe) return;

        // --- تست حیاتی: پاسخ مستقیم بدون شرط ---
        console.log('🚀 [ACTION] Attempting DIRECT REPLY...');

        try {
            // ۱. ارسال وضعیت تایپ (تست اتصال)
            await sock.sendPresenceUpdate('composing', senderJid);
            
            // ۲. ارسال مستقیم پیام (بدون استفاده از ChatbotService)
            await sock.sendMessage(senderJid, { 
                text: `✅ پیام شما رسید!\nمتن: ${text}\n(این یک پیام تست مستقیم است)` 
            });
            
            console.log('✅ [SUCCESS] Direct reply sent!');
            
        } catch (sendError) {
            console.error('❌ [SEND ERROR] Failed to send message:', sendError);
        }

      } catch (error) {
          console.error('❌ [CRITICAL ERROR] Inside Handler:', error);
      }
    });
  }

  // 🚀 ارسال پیام متنی
  async sendTextMessage(sessionId: string, phone: string, message: string, userId: number) {
    let sock = this.sessions.get(sessionId);
    const formattedPhone = phone.replace(/\D/g, '').replace(/^0/, '98');
    const jid = `${formattedPhone}@s.whatsapp.net`;

    try {
        if (!sock) {
             await this.createSession(sessionId, userId, false);
             await new Promise(r => setTimeout(r, 2000));
             sock = this.sessions.get(sessionId);
        }
        await this.waitForConnection(sock);
        await sock.sendMessage(jid, { text: message });

    } catch (error) {
        console.warn(`⚠️ Retry sending...`);
        this.sessions.delete(sessionId);
        await this.createSession(sessionId, userId, false);
        await new Promise(r => setTimeout(r, 4000));
        sock = this.sessions.get(sessionId);
        await this.waitForConnection(sock);
        await sock.sendMessage(jid, { text: message });
    }

    await this.prisma.message.create({
        data: { text: message, sender: 'ME', receiver: formattedPhone, isFromMe: true, type: 'text', sessionId }
    });
    return { status: 'sent', phone: formattedPhone };
  }

  // 📷 ارسال عکس
  async sendImageBuffer(sessionId: string, phone: string, fileBuffer: Buffer, caption: string, userId: number) {
    let sock = this.sessions.get(sessionId);
    const formattedPhone = phone.replace(/\D/g, '').replace(/^0/, '98');
    const jid = `${formattedPhone}@s.whatsapp.net`;

    if (!Buffer.isBuffer(fileBuffer) || fileBuffer.length === 0) throw new Error('File Error');

    try {
        if (!sock) {
             await this.createSession(sessionId, userId, false);
             await new Promise(r => setTimeout(r, 2000));
             sock = this.sessions.get(sessionId);
        }
        await this.waitForConnection(sock);
        await sock.sendMessage(jid, { image: fileBuffer, caption, mimetype: 'image/jpeg' });

    } catch (error) {
        console.warn(`⚠️ Retry Image...`);
        this.sessions.delete(sessionId);
        await this.createSession(sessionId, userId, false);
        await new Promise(r => setTimeout(r, 5000));
        sock = this.sessions.get(sessionId);
        await this.waitForConnection(sock);
        await sock.sendMessage(jid, { image: fileBuffer, caption, mimetype: 'image/jpeg' });
    }

    await this.prisma.message.create({
        data: { text: caption || '[IMAGE]', sender: 'ME', receiver: formattedPhone, isFromMe: true, type: 'image', sessionId }
    });
    return { status: 'sent', type: 'image' };
  }

  // 📂 ارسال فایل
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
            mimetype = response.headers['content-type'] || 'application/pdf';
        } else {
            if (!fs.existsSync(fileUrl)) throw new Error(`File not found: ${fileUrl}`);
            buffer = fs.readFileSync(fileUrl);
        }
    } catch (e) { throw new Error(e.message); }

    try {
        if (!sock) {
             await this.createSession(sessionId, userId, false);
             await new Promise(r => setTimeout(r, 2000));
             sock = this.sessions.get(sessionId);
        }
        await this.waitForConnection(sock);
        await sock.sendMessage(jid, { document: buffer, mimetype, fileName, caption });

    } catch (error) {
        this.sessions.delete(sessionId);
        await this.createSession(sessionId, userId, false);
        await new Promise(r => setTimeout(r, 5000));
        sock = this.sessions.get(sessionId);
        await this.waitForConnection(sock);
        await sock.sendMessage(jid, { document: buffer, mimetype, fileName, caption });
    }

    await this.prisma.message.create({
        data: { text: caption || `[FILE: ${fileName}]`, sender: 'ME', receiver: formattedPhone, isFromMe: true, type: 'document', sessionId }
    });
    return { status: 'success' };
  }

  // --- ابزارها ---
  async getContacts(sessionId: string) {
    const messages = await this.prisma.message.findMany({
        where: { sessionId }, orderBy: { createdAt: 'desc' }, distinct: ['sender', 'receiver']
    });
    const contacts = new Map();
    messages.forEach(msg => {
        const p = msg.isFromMe ? msg.receiver : msg.sender;
        if (p !== 'ME' && !contacts.has(p)) contacts.set(p, { phone: p, lastMessage: msg.text });
    });
    return Array.from(contacts.values());
  }

  async getChatHistory(sessionId: string, phone: string) {
    const clean = phone.replace(/\D/g, ''); 
    return this.prisma.message.findMany({
        where: { sessionId, OR: [{ sender: clean }, { receiver: clean }] },
        orderBy: { createdAt: 'asc' }
    });
  }

  async setWebhook(sessionId: string, url: string, userId: number) {
    await this.prisma.session.update({ where: { id: sessionId }, data: { webhookUrl: url } });
    return { message: 'OK' };
  }

  async getSessionIdByUser(userId: number) {
    const s = await this.prisma.session.findFirst({ where: { userId } });
    return s ? s.id : 'main';
  }

  private async saveSessionToDb(id: string, status: string, userId: number, phone?: string) {
    if(userId === 0) return;
    try { await this.prisma.session.upsert({ where: { id }, update: { status, phone }, create: { id, status, phone, userId } }); } catch(e){}
  }

  private async waitForConnection(sock: any): Promise<void> {
    if (sock?.user && sock?.ws?.isOpen) return;
    for(let i=0; i<20; i++) {
        if (sock?.user && sock?.ws?.isOpen) return;
        await new Promise(r => setTimeout(r, 1000));
    }
    throw new Error('Connection timed out');
  }
}