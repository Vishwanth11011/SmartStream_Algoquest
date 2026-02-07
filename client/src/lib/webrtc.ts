import { Socket } from 'socket.io-client';

// Free STUN servers from Google (Essential for connecting over different Wi-Fis)
const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' }
  ]
};

export class WebRTCManager {
  private peerConnection: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
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

  // 1. Initialize Connection
  public async initConnection(isInitiator: boolean) {
    this.peerConnection = new RTCPeerConnection(ICE_SERVERS);

    // A. Handle ICE Candidates (Network Paths)
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

    // B. Setup Data Channel (The Pipe)
    if (isInitiator) {
      // Sender creates the channel
      this.dataChannel = this.peerConnection.createDataChannel("file-transfer", { ordered: true });
      this.setupChannelListeners();
      
      // Create Offer
      const offer = await this.peerConnection.createOffer();
      await this.peerConnection.setLocalDescription(offer);
      
      this.socket.emit('file-relay', {
        targetUsername: this.targetUser,
        payload: { type: 'offer', sdp: offer }
      });
    } else {
      // Receiver waits for channel
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

  // 2. Handle Incoming Signals (Offer/Answer/ICE)
  public async handleSignal(payload: any) {
    if (!this.peerConnection) return;

    if (payload.type === 'offer') {
      await this.peerConnection.setRemoteDescription(new RTCSessionDescription(payload.sdp));
      const answer = await this.peerConnection.createAnswer();
      await this.peerConnection.setLocalDescription(answer);
      
      this.socket.emit('file-relay', {
        targetUsername: this.targetUser,
        payload: { type: 'answer', sdp: answer }
      });
    } 
    else if (payload.type === 'answer') {
      await this.peerConnection.setRemoteDescription(new RTCSessionDescription(payload.sdp));
    } 
    else if (payload.type === 'ice-candidate') {
      await this.peerConnection.addIceCandidate(new RTCIceCandidate(payload.candidate));
    }
  }

  // 3. Send Data (With Backpressure for Speed)
  // Inside client/src/lib/webrtc.ts

  // 3. Send Data (Stricter Backpressure)
  public async sendData(data: ArrayBuffer): Promise<void> {
    return new Promise((resolve) => {
      if (!this.dataChannel || this.dataChannel.readyState !== 'open') return resolve();

      // 🔴 OLD LIMIT: 16MB (Too risky, causes flooding)
      // 🟢 NEW LIMIT: 64KB (Safe, matches network speed)
      const MAX_BUFFER = 64 * 1024; 

      if (this.dataChannel.bufferedAmount > MAX_BUFFER) {
        // Wait for buffer to drain completely
        const interval = setInterval(() => {
          if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
            clearInterval(interval);
            resolve();
            return;
          }
          
          if (this.dataChannel.bufferedAmount === 0) {
            clearInterval(interval);
            this.dataChannel.send(data);
            resolve();
          }
        }, 10); // Check every 10ms
      } else {
        try {
          this.dataChannel.send(data);
        } catch (e) {
          console.warn("Send buffer full, retrying...");
          setTimeout(() => this.sendData(data).then(resolve), 50);
          return;
        }
        resolve();
      }
    });
  }

  public close() {
    this.dataChannel?.close();
    this.peerConnection?.close();
  }
}