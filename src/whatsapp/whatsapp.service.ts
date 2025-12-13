import { Injectable, OnModuleInit } from '@nestjs/common';
import makeWASocket, { DisconnectReason, useMultiFileAuthState } from '@whiskeysockets/baileys';
import * as qrcode from 'qrcode-terminal';
import pino from 'pino';
import * as fs from 'fs';

@Injectable()
export class WhatsappService implements OnModuleInit {
  private sessions = new Map<string, any>();

  async onModuleInit() {
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
      connectTimeoutMs: 60000, // افزایش تایم‌اوت اتصال
      defaultQueryTimeoutMs: 60000, // افزایش تایم‌اوت کوئری‌ها (برای عکس مهم است)
    });

    this.sessions.set(sessionId, sock);

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        console.log(`\nScan QR for session: ${sessionId}`);
        qrcode.generate(qr, { small: true });
      }

      if (connection === 'close') {
        const shouldReconnect = (lastDisconnect?.error as any)?.output?.statusCode !== DisconnectReason.loggedOut;
        if (shouldReconnect) {
          // مکانیزم تاخیر در اتصال مجدد برای جلوگیری از لوپ
          setTimeout(() => this.createSession(sessionId), 3000);
        } else {
          console.log(`Session ${sessionId} logged out.`);
          this.sessions.delete(sessionId);
        }
      } else if (connection === 'open') {
        console.log(`✅ Session ${sessionId} is ready!`);
      }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async (m) => {
      const msg = m.messages[0];
      const senderJid = msg.key.remoteJid;
      if (!msg.key.fromMe && m.type === 'notify' && senderJid) {
        const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
        console.log(`[${sessionId}] Msg from ${senderJid}: ${text}`);
        if (text.trim() === 'سلام') {
            await sock.sendMessage(senderJid, { text: 'سلام! ربات هستم 🤖' }, { quoted: msg });
        }
      }
    });

    return { status: 'initializing', sessionId };
  }

  // --- تابع کمکی برای اطمینان از اتصال ---
  private async waitForConnection(sessionId: string, sock: any): Promise<boolean> {
    if (sock.ws.isOpen) return true;

    console.log(`⚠️ Session ${sessionId} is not open. Waiting...`);
    
    // تلاش می‌کنیم تا 5 ثانیه منتظر وصل شدن بمانیم
    let retries = 0;
    while (retries < 10) {
        if (sock.ws.isOpen) return true;
        await new Promise(r => setTimeout(r, 500)); // نیم ثانیه صبر
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
    return { status: 'success', sessionId, phone };
  }

  async sendImageMessage(sessionId: string, phone: string, imageSource: string, caption: string, isLocalFile: boolean = false) {
    const sock = this.sessions.get(sessionId);
    if (!sock) throw new Error(`Session ${sessionId} not found!`);

    // ۱. اطمینان از اتصال
    const isConnected = await this.waitForConnection(sessionId, sock);
    if (!isConnected) throw new Error('Connection failed via waitForConnection');

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

    // ۲. تلاش برای ارسال با مدیریت خطا
    try {
        await sock.sendMessage(jid, imagePayload);
        return { status: 'success', sessionId, type: 'image' };
    } catch (error) {
        console.error('Send Error, retrying once...', error);
        // تلاش مجدد (یک بار)
        await new Promise(r => setTimeout(r, 2000)); // ۲ ثانیه صبر
        await sock.sendMessage(jid, imagePayload);
        return { status: 'success', sessionId, type: 'image', retry: true };
    }
  }
}