import { Cryptography } from './Net/Cryptography';
import { InPacketOpcode } from './Net/InPacket';
import { OutPacket, OutPacketOpcode } from './Net/OutPacket';
import UILogin from './UI/UILogin';
import {NoticeMessage, NoticeType} from './UI/UILoginNotice';

class SessionManager {
  private static instance: SessionManager | null = null;
  private websocket: WebSocket | null = null;
  private isFirstMessage: boolean = true;
  private crypto: Cryptography | null = null;

  private constructor() {}

  static getInstance(): SessionManager {
    if (!SessionManager.instance) {
      SessionManager.instance = new SessionManager();
    }
    return SessionManager.instance;
  }

  initialize(websocketUrl: string): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.websocket = new WebSocket(websocketUrl);
        this.websocket.binaryType = 'arraybuffer';
        this.isFirstMessage = true;

        this.websocket.addEventListener('open', () => {
          console.log('WebSocket connected');
          resolve();
        });

        this.websocket.addEventListener('error', (error) => {
          console.error('WebSocket error:', error);
          reject(error);
        });

        this.websocket.addEventListener('close', (event) => {
          this.websocket = null;
          console.log('WebSocket closed:', event.code, event);
          alert('WebSocket closed');
        });

        this.websocket.addEventListener('message', (event) => {
          if (this.isFirstMessage) {
            this.isFirstMessage = false;
            this.setupCrypto(event.data);
          } else {
            this.handleMessage(event.data);
          }
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  private setupCrypto(data: ArrayBuffer): void {
    this.crypto = new Cryptography(new Uint8Array(data));
  }

  private handleMessage(data: ArrayBuffer): void {
    const bytes = new Uint8Array(data);
    const payloadLength = this.crypto!.checkLength(bytes);
    console.log('payloadLength:', payloadLength);
    const payload = bytes.subarray(Cryptography.HEADER_LENGTH);
    this.crypto!.decrypt(payload, payloadLength);
    console.log('decrypted:', payload);

    const view = new DataView(payload.buffer);
    const opcode = view.getUint16(Cryptography.HEADER_LENGTH, true);
    console.debug('opcode:', opcode);
    switch (opcode) { // @todo: split it into a separate class
      case InPacketOpcode.LOGIN_STATUS:
        const reasonCode = view.getUint8(Cryptography.HEADER_LENGTH + 2);
        console.log('Login status is:', reasonCode);
        if (reasonCode === 23) {
          UILogin.showTOS();
        } else {
          UILogin.showNotice(NoticeType.NORMAL, reasonCode as NoticeMessage);
        }
        break;
      case InPacketOpcode.PING:
        new OutPacket(OutPacketOpcode.PONG).dispatch();
        break;
      default:
        console.warn('Unhandled opcode:', opcode);
        break;
    }
  }

  isConnected(): boolean {
    return this.websocket?.readyState === WebSocket.OPEN;
  }

  disconnect(): void {
    if (this.websocket) {
      this.websocket.close();
      this.websocket = null;
    }
  }

  sendMessage(bytes: Uint8Array): boolean {
    if (!this.isConnected()) {
      console.warn('Cannot send message: WebSocket not connected');
      return false;
    }

    try {
      let header: Uint8Array = new Uint8Array(4);
      this.crypto!.createHeader(header, bytes.length);
      this.crypto!.encrypt(bytes, bytes.length);

      console.log('header packet bytes:', header);
      console.log('Login packet after encrypt:', bytes);

      this.websocket!.send(header.buffer);
      console.log('header packet sent');
      this.websocket!.send(bytes.buffer);
      console.log('login packet sent');
      return true;
    } catch (error) {
      console.error('Failed to send message:', error);
      return false;
    }
  }
}

export default SessionManager.getInstance();
