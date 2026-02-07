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
  // client/src/lib/webrtc.ts

  public async sendData(data: ArrayBuffer): Promise<void> {
    return new Promise((resolve) => {
      // Safety check
      if (!this.dataChannel || this.dataChannel.readyState !== 'open') return resolve();

      // 🟢 SPEED BOOST CONFIGURATION
      // Allow up to 1MB of data to sit in the waiting line.
      // This keeps the upload speed maxed out.
      const MAX_BUFFER_LIMIT = 1024 * 1024; // 1 MB
      const LOW_WATER_MARK = 256 * 1024;    // Resume when drops to 256KB

      if (this.dataChannel.bufferedAmount > MAX_BUFFER_LIMIT) {
        // 🛑 BUFFER FULL: PAUSE
        // We wait until the buffer drains down to the Low Water Mark
        // This prevents "Stop-and-Go" stuttering.
        const interval = setInterval(() => {
          if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
            clearInterval(interval);
            resolve();
            return;
          }
          
          if (this.dataChannel.bufferedAmount <= LOW_WATER_MARK) {
            clearInterval(interval);
            try {
              this.dataChannel.send(data);
            } catch (e) {
              console.warn("Packet dropped, retrying...");
            }
            resolve();
          }
        }, 5); // Check frequently (5ms) for responsiveness
      } else {
        // 🟢 BUFFER OK: SEND IMMEDIATELY
        try {
          this.dataChannel.send(data);
        } catch (e) {
          // If sending fails (rare), just resolve to keep loop moving
          console.error("Send failed", e);
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