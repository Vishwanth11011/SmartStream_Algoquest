// client/src/lib/webrtc.ts
import { Socket } from 'socket.io-client';

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' }
  ]
};

export class WebRTCManager {
  public peerConnection: RTCPeerConnection | null = null;
  public dataChannel: RTCDataChannel | null = null;
  private socket: Socket;
  private targetUser: string;
  private onDataReceived: (data: ArrayBuffer) => void;
  private onStatusChange: (status: string) => void;

  constructor(socket: Socket, targetUser: string, onData: (d: ArrayBuffer) => void, onStatus: (s: string) => void) {
    this.socket = socket;
    this.targetUser = targetUser;
    this.onDataReceived = onData;
    this.onStatusChange = onStatus;
  }

  public async initConnection(isInitiator: boolean) {
    this.peerConnection = new RTCPeerConnection(ICE_SERVERS);

    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        this.socket.emit('file-relay', {
          targetUsername: this.targetUser,
          payload: { type: 'ice-candidate', candidate: event.candidate }
        });
      }
    };

    this.peerConnection.onconnectionstatechange = () => {
      this.onStatusChange(this.peerConnection?.connectionState || 'closed');
    };

    if (isInitiator) {
      this.dataChannel = this.peerConnection.createDataChannel("file-transfer", { ordered: true });
      this.setupChannelListeners();
      const offer = await this.peerConnection.createOffer();
      await this.peerConnection.setLocalDescription(offer);
      this.socket.emit('file-relay', { targetUsername: this.targetUser, payload: { type: 'offer', sdp: offer } });
    } else {
      this.peerConnection.ondatachannel = (event) => {
        this.dataChannel = event.channel;
        this.setupChannelListeners();
      };
    }
  }

  private setupChannelListeners() {
    if (!this.dataChannel) return;
    this.dataChannel.onopen = () => this.onStatusChange('connected');
    this.dataChannel.onclose = () => this.onStatusChange('disconnected');
    this.dataChannel.onmessage = (e) => this.onDataReceived(e.data);
  }

  public async handleSignal(payload: any) {
    if (!this.peerConnection) return;
    if (payload.type === 'offer') {
      await this.peerConnection.setRemoteDescription(new RTCSessionDescription(payload.sdp));
      const answer = await this.peerConnection.createAnswer();
      await this.peerConnection.setLocalDescription(answer);
      this.socket.emit('file-relay', { targetUsername: this.targetUser, payload: { type: 'answer', sdp: answer } });
    } else if (payload.type === 'answer') {
      await this.peerConnection.setRemoteDescription(new RTCSessionDescription(payload.sdp));
    } else if (payload.type === 'ice-candidate') {
      await this.peerConnection.addIceCandidate(new RTCIceCandidate(payload.candidate));
    }
  }

  // ✅ OPTIMIZED SEND LOGIC (Event-Driven Backpressure)
  public async sendData(data: ArrayBuffer): Promise<void> {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') return;

    // 1MB Limit prevents browser crash
    if (this.dataChannel.bufferedAmount > 1024 * 1024) {
      await new Promise<void>(resolve => {
        if (!this.dataChannel) return resolve();
        this.dataChannel.bufferedAmountLowThreshold = 256 * 1024; // Resume at 256KB
        const onLow = () => {
          this.dataChannel?.removeEventListener('bufferedamountlow', onLow);
          resolve();
        };
        this.dataChannel.addEventListener('bufferedamountlow', onLow);
      });
    }

    try {
      this.dataChannel.send(data);
    } catch (e) {
      console.error("Send Error", e);
    }
  }

  public close() {
    this.dataChannel?.close();
    this.peerConnection?.close();
  }
}