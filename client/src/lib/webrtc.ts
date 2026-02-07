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
  public async sendData(data: ArrayBuffer): Promise<void> {
    return new Promise((resolve) => {
      if (!this.dataChannel || this.dataChannel.readyState !== 'open') return resolve();

      // BACKPRESSURE LOGIC:
      // If the buffer is full (16MB), wait for it to drain. 
      // This prevents the browser from crashing on large files.
      if (this.dataChannel.bufferedAmount > 16 * 1024 * 1024) {
        const interval = setInterval(() => {
          if (this.dataChannel!.bufferedAmount < 4 * 1024 * 1024) {
            clearInterval(interval);
            this.dataChannel!.send(data);
            resolve();
          }
        }, 50);
      } else {
        this.dataChannel.send(data);
        resolve();
      }
    });
  }

  public close() {
    this.dataChannel?.close();
    this.peerConnection?.close();
  }
}