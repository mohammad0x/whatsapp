import { WebSocketGateway, WebSocketServer, OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({
  cors: {
    origin: '*', // در پروداکشن محدود شود
  },
})
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  // وقتی کاربر (فرانت‌ند) وصل شد
  handleConnection(client: Socket) {
    console.log(`🔌 Client connected: ${client.id}`);
  }

  // وقتی کاربر قطع شد
  handleDisconnect(client: Socket) {
    console.log(`❌ Client disconnected: ${client.id}`);
  }

  // تابعی که سرویس‌های دیگر صدا می‌زنند تا پیام بفرستند
  sendMessageToClients(event: string, data: any) {
    this.server.emit(event, data);
  }
}