import { Socket } from 'socket.io-client';

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' }
  ]
};

export class WebRTCManager {
  public peerConnection: RTCPeerConnection;
  public dataChannel: RTCDataChannel | null = null;
  private socket: Socket;
  private targetId: string;
  private onData: (data: ArrayBuffer) => void;
  private onStateChange: (state: string) => void;

  constructor(socket: Socket, targetId: string, onData: (data: ArrayBuffer) => void, onStateChange: (state: string) => void) {
    this.socket = socket;
    this.targetId = targetId;
    this.onData = onData;
    this.onStateChange = onStateChange;

    this.peerConnection = new RTCPeerConnection(ICE_SERVERS);

    // 1. ICE Candidate Exchange
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

    // 3. Receiver: Handle incoming channel creation from Peer
    this.peerConnection.ondatachannel = (event) => {
      this.setupDataChannel(event.channel);
    };
  }

  // Sender: Initialize connection
  public async initConnection(isInitiator: boolean) {
    if (isInitiator) {
      // ✅ 'ordered: true' ensures bits don't arrive shuffled (essential for PDF/IPYNB)
      const channel = this.peerConnection.createDataChannel("file-transfer", { 
        ordered: true 
      });
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
    try {
      if (payload.type === 'offer') {
        await this.peerConnection.setRemoteDescription(payload.sdp);
        const answer = await this.peerConnection.createAnswer();
        await this.peerConnection.setLocalDescription(answer);
        
        this.socket.emit('signal', { 
          target: this.targetId, 
          payload: { type: 'answer', sdp: answer } 
        });
      } 
      else if (payload.type === 'answer') {
        await this.peerConnection.setRemoteDescription(payload.sdp);
      } 
      else if (payload.type === 'ice-candidate') {
        if (payload.candidate) {
          await this.peerConnection.addIceCandidate(payload.candidate);
        }
      }
    } catch (error) {
      console.error("WebRTC Signaling Error:", error);
    }
  }

  private setupDataChannel(channel: RTCDataChannel) {
    this.dataChannel = channel;
    
    // ✅ CRITICAL: Force Binary Type to 'arraybuffer' to prevent corruption
    this.dataChannel.binaryType = 'arraybuffer';
    
    // Set threshold for backpressure (256KB)
    this.dataChannel.bufferedAmountLowThreshold = 256 * 1024;

    this.dataChannel.onopen = () => this.onStateChange('connected');
    this.dataChannel.onclose = () => this.onStateChange('disconnected');
    
    // Receiver: Direct raw data to the handler
    this.dataChannel.onmessage = (e) => {
      if (e.data instanceof ArrayBuffer) {
        this.onData(e.data);
      } else {
        // Handle metadata as JSON strings if necessary
        const decoder = new TextDecoder();
        const text = decoder.decode(e.data);
        if (text.startsWith('{')) {
           // Pass JSON through as an ArrayBuffer to be handled by the pipeline
           this.onData(e.data);
        }
      }
    };
  }

  // ✅ OPTIMIZED SEND LOGIC (Event-Driven Backpressure)
  // This prevents browser memory from overflowing and corrupting the stream
  public async sendData(data: ArrayBuffer): Promise<void> {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
      console.warn("Attempted to send data while channel was not open.");
      return;
    }

    // If browser buffer is dangerously full (>1MB), pause and wait
    if (this.dataChannel.bufferedAmount > 1024 * 1024) {
      await new Promise<void>(resolve => {
        const onLow = () => {
          this.dataChannel?.removeEventListener('bufferedamountlow', onLow);
          resolve();
        };
        this.dataChannel?.addEventListener('bufferedamountlow', onLow);
      });
    }

    try {
      this.dataChannel.send(data);
    } catch (e) {
      console.error(`Transmission failure to ${this.targetId}:`, e);
    }
  }

  public close() {
    if (this.dataChannel) {
      this.dataChannel.onmessage = null;
      this.dataChannel.close();
    }
    this.peerConnection.close();
  }
}