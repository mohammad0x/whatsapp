import { Injectable, OnModuleInit, BadRequestException } from '@nestjs/common';
import makeWASocket, { DisconnectReason, useMultiFileAuthState, WAMessageStatus } from '@whiskeysockets/baileys';
import * as QRCode from 'qrcode';
import * as fs from 'fs';
import * as path from 'path';
import pino from 'pino';
import { PrismaService } from '../prisma/prisma.service';
import { ChatbotService } from './chatbot.service';
import { EventsGateway } from '../events.gateway';

@Injectable()
export class WhatsappService implements OnModuleInit {
  private sessions = new Map<string, any>();
  private qrCodes = new Map<string, string>();
  private readonly DEFAULT_SESSION_ID = 'session_1';

  constructor(
    private prisma: PrismaService,
    private chatbotService: ChatbotService,
    private eventsGateway: EventsGateway
  ) {}

 
 async onModuleInit() {
    const authDir = 'auth_info';
    if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });

    // خواندن تمام پوشه‌های سشن
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

  // ۱. اتصال به واتساپ (با پارامتر سینک تاریخچه)
  async createSession(sessionId: string, userId: number, syncHistory = true) {
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
      syncFullHistory: syncHistory, // 👈 فعال‌سازی مجدد تاریخچه
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
        console.log(`✅ Session CONNECTED! Syncing chats...`);
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
              console.log('⚠️ Reconnecting...');
              // اگر قطع شد، دفعه بعد بدون سینک تاریخچه وصل شو که سریع بیاید
              setTimeout(() => this.createSession(sid, userId, false), 5000);
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

    // 🔥 ۲. دریافت تاریخچه (این بخش برگردانده شد)
    sock.ev.on('messaging-history.set', async ({ messages, isLatest }) => {
        console.log(`📚 History Event: Received ${messages.length} messages. Saving to DB...`);
        
        let count = 0;
        for (const msg of messages) {
            // isHistory=true می‌فرستیم تا نوتیفیکیشن لایو برای فرانت نرود
            await this.handleIncomingMessage(sid, msg, sock, userId, true);
            count++;
        }
        console.log(`✅ History Sync Complete: ${count} messages processed.`);
    });

    // ۳. دریافت پیام‌های جدید
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
       for (const msg of messages) {
           if (!msg.message) continue;
           const isHistory = type === 'append'; 
           await this.handleIncomingMessage(sid, msg, sock, userId, isHistory);
       }
    });

    return { message: 'Session initializing...', sessionId: sid };
  }

  // ۴. پردازش پیام (با فلگ isHistory)
  private async handleIncomingMessage(sessionId: string, msg: any, sock: any, userId: number, isHistory = false) {
      const remoteJid = msg.key.remoteJid;
      if (!remoteJid || remoteJid === 'status@broadcast') return;

      let text = '';
      let msgType = 'text';

      if (msg.message?.conversation) text = msg.message.conversation;
      else if (msg.message?.extendedTextMessage?.text) text = msg.message.extendedTextMessage.text;
      else if (msg.message?.imageMessage) { msgType = 'image'; text = msg.message.imageMessage.caption || '[Image]'; }
      else if (msg.message?.documentMessage) { msgType = 'document'; text = msg.message.documentMessage.caption || '[Document]'; }

      if (!text && msgType === 'text') return; 

      const isFromMe = msg.key.fromMe;
      const contactPhone = remoteJid.split('@')[0];
      
      let contact = await this.prisma.contact.findUnique({ where: { phone: contactPhone } });
      if (!contact) {
          contact = await this.prisma.contact.create({ data: { phone: contactPhone, pushName: msg.pushName } });
      }

      let conversation = await this.prisma.conversation.findFirst({ where: { contactId: contact.id, sessionId } });
      if (!conversation) {
          conversation = await this.prisma.conversation.create({ data: { contactId: contact.id, sessionId, status: 'OPEN', unreadCount: 0 } });
      }

      const msgTimestamp = new Date((msg.messageTimestamp || Date.now() / 1000) * 1000);
      const duplicate = await this.prisma.message.findFirst({
          where: { conversationId: conversation.id, text, isFromMe, createdAt: msgTimestamp }
      });

      if (duplicate) return;

      const savedMsg = await this.prisma.message.create({
          data: {
              text, type: msgType, sender: isFromMe ? 'ME' : contactPhone,
              receiver: isFromMe ? contactPhone : 'ME', isFromMe,
              conversationId: conversation.id,
              createdAt: msgTimestamp
          }
      });

      await this.prisma.conversation.update({
          where: { id: conversation.id },
          data: { lastMessageAt: msgTimestamp, unreadCount: isFromMe ? 0 : { increment: 1 } }
      });

      // ارسال به فرانت (فقط اگر پیام زنده باشد)
      if (!isHistory) {
          console.log(`📩 New Live Message: ${text}`);
          this.eventsGateway.sendMessageToClients('message:new', {
              conversationId: conversation.id,
              message: savedMsg,
              contact
          });

          if (!isFromMe && msgType === 'text') {
              const botResponse = await this.chatbotService.getResponse(userId, text);
              if (botResponse) {
                  await new Promise(r => setTimeout(r, 2000));
                  await sock.sendMessage(remoteJid, { text: botResponse });
              }
          }
      }
  }

  // --- بقیه متدها بدون تغییر ---
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
        if (sock) { sock.end(undefined); this.sessions.delete(sid); }
        const authFolder = path.join(process.cwd(), 'auth_info', sid);
        if (fs.existsSync(authFolder)) fs.rmSync(authFolder, { recursive: true, force: true });
        
        console.log('🧹 Clearing DB...');
        await this.prisma.message.deleteMany({ where: { conversation: { sessionId: sid } } });
        await this.prisma.conversation.deleteMany({ where: { sessionId: sid } });
        
        this.eventsGateway.sendMessageToClients('session:disconnected', {});
        this.qrCodes.delete(sid);
        await this.prisma.session.updateMany({ where: { id: sid }, data: { status: 'DISCONNECTED', phone: null } });
        return { status: 'success' };
    } catch (error) { throw new BadRequestException('Failed to disconnect'); }
  }

  async sendTextMessage(sessionId: string, phone: string, message: string, userId: number) {
    const sid = sessionId || this.DEFAULT_SESSION_ID;
    const sock = this.sessions.get(sid);
    if (!sock) throw new BadRequestException('ربات متصل نیست');

    let cleanPhone = phone.replace(/\D/g, '');
    if (cleanPhone.startsWith('09')) cleanPhone = '98' + cleanPhone.substring(1);
    if (cleanPhone.length < 10) throw new BadRequestException(`شماره نامعتبر: ${phone}`);

    const jid = `${cleanPhone}@s.whatsapp.net`;
    console.log(`🚀 Sending to: ${jid}`);
    
    try {
        await sock.sendPresenceUpdate('composing', jid);
        const sentMsg = await sock.sendMessage(jid, { text: message });
        await sock.sendPresenceUpdate('paused', jid);
        console.log('✅ Sent! ID:', sentMsg?.key?.id);
        return { status: 'sent', phone: cleanPhone, messageId: sentMsg?.key?.id };
    } catch (error) {
        console.error('❌ Send Failed:', error);
        throw new BadRequestException('خطا در ارسال پیام');
    }
  }

  async sendImageBuffer(sessionId: string, phone: string, fileBuffer: Buffer, caption: string, userId: number) {
      const sid = sessionId || this.DEFAULT_SESSION_ID;
      const sock = this.sessions.get(sid);
      if (!sock) throw new BadRequestException('ربات متصل نیست');
      let cleanPhone = phone.replace(/\D/g, '');
      if (cleanPhone.startsWith('09')) cleanPhone = '98' + cleanPhone.substring(1);
      const jid = `${cleanPhone}@s.whatsapp.net`;
      await sock.sendMessage(jid, { image: fileBuffer, caption: caption });
      return { status: 'sent' };
  }

  async sendDocumentMessage(sessionId: string, phone: string, fileUrl: string, fileName: string, caption: string, userId: number) {
      return this.sendTextMessage(sessionId, phone, `${caption}\n\n📥 دانلود فایل: ${fileUrl}`, userId);
  }

  async getConversations(sessionId: string) {
      const sid = sessionId || this.DEFAULT_SESSION_ID;
      return this.prisma.conversation.findMany({
          where: { sessionId: sid },
          include: { contact: true, messages: { take: 1, orderBy: { createdAt: 'desc' } } },
          orderBy: { lastMessageAt: 'desc' }
      });
  }

  async getConversationMessages(conversationId: number) {
      return this.prisma.message.findMany({ where: { conversationId }, orderBy: { createdAt: 'asc' } });
  }

  async setWebhook(sessionId: string, url: string, userId: number) {
    const sid = sessionId || this.DEFAULT_SESSION_ID;
    return this.prisma.session.upsert({ where: { id: sid }, update: { webhookUrl: url }, create: { id: sid, userId, status: 'DISCONNECTED', webhookUrl: url } });
  }

  private async saveSessionToDb(id: string, status: string, userId: number, phone?: string) {
      try { await this.prisma.session.upsert({ where: { id }, update: { status, phone }, create: { id, status, phone, userId } }); } catch (e) {}
  }
}