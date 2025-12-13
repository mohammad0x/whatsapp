import { Injectable, OnModuleInit } from '@nestjs/common';
import makeWASocket, { DisconnectReason, useMultiFileAuthState } from '@whiskeysockets/baileys';
import * as qrcode from 'qrcode-terminal';
import pino from 'pino';

@Injectable()
export class WhatsappService implements OnModuleInit {
  // این متغیر سوکت را نگه می‌دارد تا در همه جای کلاس در دسترس باشد
  private sock: any;

  async onModuleInit() {
    this.connectToWhatsapp();
  }

  async connectToWhatsapp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    this.sock = makeWASocket({
      auth: state,
      logger: pino({ level: 'silent' }) as any,
    });

    this.sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        console.log('QR Code received, please scan!');
        qrcode.generate(qr, { small: true });
      }

      if (connection === 'close') {
        const shouldReconnect = (lastDisconnect?.error as any)?.output?.statusCode !== DisconnectReason.loggedOut;
        console.log('Connection closed, reconnecting:', shouldReconnect);
        
        if (shouldReconnect) {
          this.connectToWhatsapp();
        }
      } else if (connection === 'open') {
        console.log('Opened connection to WhatsApp!');
      }
    });

    this.sock.ev.on('creds.update', saveCreds);

    // ... کدهای قبلی (connection.update)

    // ۴. گوش دادن به پیام‌های جدید
   // ۴. گوش دادن به پیام‌های جدید
    this.sock.ev.on('messages.upsert', async (m) => {
      const msg = m.messages[0];

      // شرط اول: پیام نباید از طرف خود ربات باشد
      if (!msg.key.fromMe && m.type === 'notify') {
        
        console.log('------------------------------------------------');
        console.log('📩 New Message Packet Received');

        // استخراج متن پیام (با در نظر گرفتن همه حالات ممکن)
        const text = msg.message?.conversation || 
                     msg.message?.extendedTextMessage?.text || 
                     msg.message?.imageMessage?.caption || 
                     '';

        const senderJid = msg.key.remoteJid;

        console.log('👤 Sender:', senderJid);
        console.log('💬 Text Received:', `"${text}"`); // گذاشتن داخل "" برای دیدن فاصله‌های اضافی

        // اصلاح شرط: به جای === از includes استفاده میکنیم تا اگر فاصله داشت هم کار کند
        // همچنین trim() را استفاده میکنیم تا فاصله‌های اول و آخر را حذف کند
        if (text && text.trim() === 'سلام') {
           console.log('✅ Keyword "Salam" matched! Attempting to reply...');
           
           try {
             // نکته مهم: اینجا مستقیم از sendMessage استفاده می‌کنیم
             // و senderJid را مستقیم پاس می‌دهیم (چون فرمت آن درست است)
             await this.sock.sendMessage(senderJid, { 
               text: 'سلام! چطور میتونم کمکتون کنم؟ 🤖' 
             }, { quoted: msg }); // این باعث می‌شود روی پیام کاربر ریپلای کند

             console.log('✅ Reply sent successfully');
           } catch (error) {
             console.error('❌ Error sending reply:', error);
           }
        } else {
            console.log('❌ Keyword did not match. (Received !== Expected)');
        }
      }
    });
    

    this.sock.ev.on('creds.update', saveCreds);
  }

// --- تابع ارسال عکس ---
  async sendImageMessage(phone: string, imageUrl: string, caption: string) {
    if (!this.sock) throw new Error('Whatsapp is not connected!');

    const jid = `${phone}@s.whatsapp.net`;

    // ارسال عکس از طریق URL
    await this.sock.sendMessage(jid, { 
      image: { url: imageUrl }, 
      caption: caption 
    });

    return { status: 'success', type: 'image' };
  }
  
  // --- تابع جدید برای ارسال پیام ---
  async sendTextMessage(phone: string, message: string) {
    if (!this.sock) {
      throw new Error('Whatsapp is not connected yet!');
    }

    // فرمت کردن شماره برای واتساپ (مثلاً 98912... به 98912...@s.whatsapp.net)
    // فرض می‌کنیم شماره ورودی بدون + و صفر اول است
    const jid = `${phone}@s.whatsapp.net`;

    // ارسال پیام (صبر می‌کنیم تا ارسال شود)
    await this.sock.sendMessage(jid, { text: message });

    return { status: 'success', phone, message };
  }
}