import { Injectable, OnModuleInit, NotFoundException } from '@nestjs/common';
import makeWASocket, { DisconnectReason, useMultiFileAuthState, jidDecode } from '@whiskeysockets/baileys';
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

  async onModuleInit() {
    const authDir = 'auth_info';
    if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });

    const folders = fs.readdirSync(authDir);
    for (const sessionId of folders) {
      if(fs.existsSync(`${authDir}/${sessionId}/creds.json`)) {
           console.log(`🔄 Recovering Session: ${sessionId}`);
           await this.createSession(sessionId, 0, false);
      }
    }
  }

  async getSessionStatus(sessionId: string, userId: number) {
    const sock = this.sessions.get(sessionId);
    if(sock?.user) return { status: 'CONNECTED', qr: null, phone: sock.user.id.split(':')[0], sessionId };
    
    const qr = this.qrCodes.get(sessionId);
    if (qr) return { status: 'SCAN_QR', qr, sessionId };

    const sessionRecord = await this.prisma.session.findUnique({ where: { id: sessionId } });
    if (!sessionRecord) return { status: 'NOT_CREATED', message: 'Please start session first', sessionId };

    return { status: 'DISCONNECTED', qr: null, sessionId };
  }

  async createSession(sessionId: string, userId: number, isNew = true) {
    if (this.sessions.has(sessionId)) return { message: 'Already active', sessionId };

    const authFolder = `auth_info/${sessionId}`;
    const { state, saveCreds } = await useMultiFileAuthState(authFolder);

    const sock = makeWASocket({
      auth: state,
      logger: pino({ level: 'silent' }) as any, 
      connectTimeoutMs: 60000,
      printQRInTerminal: false,
      browser: ['Whatsapp 360 Clone', 'Chrome', '1.0.0'],
      retryRequestDelayMs: 5000,
    });

    this.sessions.set(sessionId, sock);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        console.log(`\n📷 Scan QR Code for ${sessionId}:`);
        qrcodeTerminal.generate(qr, { small: true });
        const qrImage = await QRCode.toDataURL(qr);
        this.qrCodes.set(sessionId, qrImage);
        if (userId !== 0) await this.saveSessionToDb(sessionId, 'SCAN_QR', userId);
      }

      if (connection === 'open') {
        console.log(`✅ Session ${sessionId} CONNECTED!`);
        this.qrCodes.delete(sessionId);
        const myPhone = sock.user?.id?.split(':')[0];
        
        if (userId !== 0) await this.saveSessionToDb(sessionId, 'CONNECTED', userId, myPhone);
        else await this.prisma.session.update({ where: { id: sessionId }, data: { status: 'CONNECTED', phone: myPhone } }).catch(() => {});
      }
      
      if (connection === 'close') {
          const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
          this.qrCodes.delete(sessionId); 

          if (shouldReconnect) {
              // console.log(`⚠️ Reconnecting ${sessionId}...`);
              this.sessions.delete(sessionId);
              setTimeout(() => this.createSession(sessionId, userId, false), 3000);
          } else {
              console.log(`❌ Logged out ${sessionId}`);
              this.sessions.delete(sessionId);
              try { fs.rmSync(authFolder, { recursive: true, force: true }); } catch(e) {}
              await this.prisma.session.update({ where: { id: sessionId }, data: { status: 'DISCONNECTED' } }).catch(() => {});
          }
      }
    });

    sock.ev.on('creds.update', saveCreds);

// 📩 دریافت پیام (نسخه بدون باگ TypeScript)
    sock.ev.on('messages.upsert', async (m) => {
      try {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return; 

        let senderJid = msg.key.remoteJid;
        if (!senderJid || senderJid === 'status@broadcast') return;

        // 🕵️ تشخیص نوع پیام
        // از ?. استفاده می‌کنیم تا اگر خاصیتی نبود، ارور ندهد
        const messageType = Object.keys(msg.message)[0];
        let text = '';
        let type = 'text';

        if (messageType === 'conversation') {
            text = msg.message.conversation || '';
        } else if (messageType === 'extendedTextMessage') {
            text = msg.message.extendedTextMessage?.text || '';
        } else if (messageType === 'imageMessage') {
            type = 'image';
            text = msg.message.imageMessage?.caption || '[Photo]';
        } else if (messageType === 'videoMessage') {
            type = 'video';
            text = msg.message.videoMessage?.caption || '[Video]';
        } else if (messageType === 'documentMessage') {
            type = 'document';
            text = msg.message.documentMessage?.caption || msg.message.documentMessage?.fileName || '[File]';
        } else {
            // اگر نوع پیام چیز دیگری بود (مثلا استیکر)، فعلاً نادیده بگیر یا لاگ کن
            // console.log('Unknown message type:', messageType);
            return; 
        }

        // تمیز کردن شماره
        const senderClean = senderJid.split('@')[0];

        // Duplicate Check
        const recentDuplicate = await this.prisma.message.findFirst({
            where: {
                sessionId,
                text, 
                sender: senderClean,
                createdAt: { gte: new Date(Date.now() - 2000) } 
            }
        });

        if (recentDuplicate) return;

        console.log(`📩 New ${type} from ${senderClean}: ${text}`);

        // ذخیره در دیتابیس
        const savedMsg = await this.prisma.message.create({
            data: {
                text: text,
                sender: senderClean,
                receiver: 'ME',
                isFromMe: false,
                type: type,
                sessionId: sessionId
            }
        });

        // ارسال وب‌هوک
        await this.triggerWebhook(sessionId, {
            event: 'message.received',
            data: {
                id: savedMsg.id,
                wa_id: msg.key.id,
                from: senderClean,
                type: type,
                body: text,
                timestamp: Math.floor(Date.now() / 1000),
                pushName: msg.pushName || ''
            }
        });

      } catch (error) {
          console.error('Error handling message:', error.message);
      }
    });

    return { message: 'Session started', sessionId };
  }

  private async triggerWebhook(sessionId: string, payload: any) {
      try {
          const session = await this.prisma.session.findUnique({ 
              where: { id: sessionId },
              select: { webhookUrl: true } 
          });

          if (session?.webhookUrl) {
              // لاگ کوتاه و تمیز
              console.log(`🚀 Webhook -> ${session.webhookUrl} [${payload.data.from}]`);
              await axios.post(session.webhookUrl, payload, { timeout: 5000 });
          }
      } catch (error) {
          // فقط اگر خطا داد لاگ بگیر
          console.error(`❌ Webhook Error: ${error.message}`);
      }
  }

  // ... (سایر متدها: setWebhook, sendTextMessage, etc بدون تغییر)
  async setWebhook(sessionId: string, url: string, userId: number) {
    const session = await this.prisma.session.findUnique({ where: { id: sessionId }});
    if (!session) {
         await this.prisma.session.create({ data: { id: sessionId, userId, status: 'DISCONNECTED', webhookUrl: url } });
    } else {
         await this.prisma.session.update({ where: { id: sessionId }, data: { webhookUrl: url } });
    }
    return { message: 'Webhook updated successfully', url };
  }

  async sendTextMessage(sessionId: string, phone: string, message: string, userId: number) {
    let sock = this.sessions.get(sessionId);
    const formattedPhone = phone.replace(/\D/g, '').replace(/^0/, '98');
    const jid = `${formattedPhone}@s.whatsapp.net`;

    if (!sock) {
         const exists = await this.prisma.session.findUnique({ where: { id: sessionId }});
         if(!exists) throw new NotFoundException('Session not found.');
         await this.createSession(sessionId, userId, false);
         await new Promise(r => setTimeout(r, 3000));
         sock = this.sessions.get(sessionId);
    }
    if (!sock) throw new Error('Could not connect.');

    await this.waitForConnection(sock);
    await sock.sendMessage(jid, { text: message });

    await this.prisma.message.create({
        data: { text: message, sender: 'ME', receiver: formattedPhone, isFromMe: true, type: 'text', sessionId }
    });
    return { status: 'sent', phone: formattedPhone };
  }
  
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

  async sendDocumentMessage(sessionId: string, phone: string, fileUrl: string, fileName: string, caption: string, userId: number) {
      let sock = this.sessions.get(sessionId);
      const formattedPhone = phone.replace(/\D/g, '').replace(/^0/, '98');
      const jid = `${formattedPhone}@s.whatsapp.net`;
      let buffer: Buffer; let mimetype: string = 'application/octet-stream';
      try {
          if (fileUrl.startsWith('http')) {
              const response = await axios.get(fileUrl, { responseType: 'arraybuffer' });
              buffer = Buffer.from(response.data, 'binary');
              mimetype = response.headers['content-type'] || mimetype;
          } else {
              if (!fs.existsSync(fileUrl)) throw new Error(`File not found: ${fileUrl}`);
              buffer = fs.readFileSync(fileUrl);
          }
      } catch (e) { throw new Error(e.message); }
      if (!sock) { await this.createSession(sessionId, userId, false); await new Promise(r => setTimeout(r, 3000)); sock = this.sessions.get(sessionId); }
      await this.waitForConnection(sock);
      await sock.sendMessage(jid, { document: buffer, mimetype, fileName, caption });
      await this.prisma.message.create({ data: { text: caption || `[FILE: ${fileName}]`, sender: 'ME', receiver: formattedPhone, isFromMe: true, type: 'document', sessionId } });
      return { status: 'success' };
  }

  async getContacts(sessionId: string) {
      const messages = await this.prisma.message.findMany({ where: { sessionId }, orderBy: { createdAt: 'desc' }, distinct: ['sender', 'receiver'] });
      const contacts = new Map();
      messages.forEach(msg => { const p = msg.isFromMe ? msg.receiver : msg.sender; if (p !== 'ME' && !contacts.has(p)) contacts.set(p, { phone: p, lastMessage: msg.text }); });
      return Array.from(contacts.values());
  }

  async getChatHistory(sessionId: string, phone: string) {
      const clean = phone.replace(/\D/g, ''); 
      return this.prisma.message.findMany({ where: { sessionId, OR: [{ sender: clean }, { receiver: clean }] }, orderBy: { createdAt: 'asc' } });
  }

  private async saveSessionToDb(id: string, status: string, userId: number, phone?: string) {
    if(userId === 0) return;
    try { 
        await this.prisma.session.upsert({ where: { id }, update: { status, phone }, create: { id, status, phone, userId } }); 
    } catch(e) {}
  }

  private async waitForConnection(sock: any): Promise<void> {
    if (sock?.user && sock?.ws?.isOpen) return;
    let attempts = 0;
    while (attempts < 10) {
        if (sock?.user && sock?.ws?.isOpen) return;
        await new Promise(r => setTimeout(r, 500));
        attempts++;
    }
    throw new Error('Connection timed out');
  }
}