import { Socket } from 'socket.io-client';

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' }
  ]
};

export class WebRTCManager {
  public peerConnection: RTCPeerConnection;
  public dataChannel: RTCDataChannel | null = null;
  private socket: Socket;
  private targetId: string; // ✅ Now targets specific Socket ID (for Mesh)
  private onData: (data: ArrayBuffer) => void;
  private onStateChange: (state: string) => void;

  constructor(socket: Socket, targetId: string, onData: (data: ArrayBuffer) => void, onStateChange: (state: string) => void) {
    this.socket = socket;
    this.targetId = targetId;
    this.onData = onData;
    this.onStateChange = onStateChange;

    this.peerConnection = new RTCPeerConnection(ICE_SERVERS);

    // 1. ICE Candidate Handling
    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        this.socket.emit('signal', { 
          target: this.targetId, 
          payload: { type: 'ice-candidate', candidate: event.candidate } 
        });
      }
    };

    // 2. Connection State Monitoring
    this.peerConnection.onconnectionstatechange = () => {
      this.onStateChange(this.peerConnection.connectionState);
    };

    // 3. Handle Incoming Data Channel (Receiver Side)
    this.peerConnection.ondatachannel = (event) => {
      this.setupDataChannel(event.channel);
    };
  }

  // Sender creates the channel
  public async initConnection(isInitiator: boolean) {
    if (isInitiator) {
      // "ordered: true" ensures packets arrive in order (critical for files)
      const channel = this.peerConnection.createDataChannel("file-transfer", { ordered: true });
      this.setupDataChannel(channel);
      
      const offer = await this.peerConnection.createOffer();
      await this.peerConnection.setLocalDescription(offer);
      
      this.socket.emit('signal', { 
        target: this.targetId, 
        payload: { type: 'offer', sdp: offer } 
      });
    }
  }

  public async handleSignal(payload: any) {
    if (payload.type === 'offer') {
      await this.peerConnection.setRemoteDescription(new RTCSessionDescription(payload.sdp));
      const answer = await this.peerConnection.createAnswer();
      await this.peerConnection.setLocalDescription(answer);
      
      this.socket.emit('signal', { 
        target: this.targetId, 
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

  private setupDataChannel(channel: RTCDataChannel) {
    this.dataChannel = channel;
    
    // Set threshold for backpressure (256KB)
    this.dataChannel.bufferedAmountLowThreshold = 256 * 1024;

    this.dataChannel.onopen = () => this.onStateChange('connected');
    this.dataChannel.onclose = () => this.onStateChange('disconnected');
    this.dataChannel.onmessage = (e) => this.onData(e.data);
  }

  // ✅ OPTIMIZED SEND LOGIC (Event-Driven Backpressure)
  // This prevents the browser from crashing when sending large files to multiple people
  public async sendData(data: ArrayBuffer): Promise<void> {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') return;

    // If buffer is full (>1MB), wait for it to drain
    if (this.dataChannel.bufferedAmount > 1024 * 1024) {
      await new Promise<void>(resolve => {
        if (!this.dataChannel) return resolve();
        
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
      console.error(`Send Error to ${this.targetId}:`, e);
    }
  }

  public close() {
    this.dataChannel?.close();
    this.peerConnection.close();
  }
}