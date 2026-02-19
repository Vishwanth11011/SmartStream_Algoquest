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
    console.log(`[WebRTC] Created peer connection for ${targetId}`);

    // 1. ICE Candidate Exchange
    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        console.log(`[WebRTC] ICE candidate generated for ${targetId}`);
        this.socket.emit('signal', { 
          target: this.targetId, 
          payload: { type: 'ice-candidate', candidate: event.candidate } 
        });
      } else {
        console.log(`[WebRTC] ICE gathering complete for ${targetId}`);
      }
    };

    // 2. Connection State Monitoring
    this.peerConnection.onconnectionstatechange = () => {
      const state = this.peerConnection.connectionState;
      console.log(`[WebRTC] Connection state change for ${targetId}: ${state}`);
      this.onStateChange(state);
    };

    // 2b. Signaling State Monitoring
    this.peerConnection.onsignalingstatechange = () => {
      const state = this.peerConnection.signalingState;
      console.log(`[WebRTC] Signaling state change for ${targetId}: ${state}`);
    };

    // 3. ICE Connection State Monitoring
    this.peerConnection.oniceconnectionstatechange = () => {
      const state = this.peerConnection.iceConnectionState;
      console.log(`[WebRTC] ICE connection state change for ${targetId}: ${state}`);
    };

    // 4. Receiver: Handle incoming channel creation from Peer
    this.peerConnection.ondatachannel = (event) => {
      console.log(`[WebRTC] Data channel received from ${targetId}`);
      this.setupDataChannel(event.channel);
    };
  }

  // Sender: Initialize connection
  public async initConnection(isInitiator: boolean) {
    if (isInitiator) {
      try {
        console.log(`[WebRTC] Initializing as INITIATOR for ${this.targetId}`);
        
        // ✅ 'ordered: true' ensures bits don't arrive shuffled (essential for PDF/IPYNB)
        const channel = this.peerConnection.createDataChannel("file-transfer", { 
          ordered: true 
        });
        console.log(`[WebRTC] Data channel created for ${this.targetId}`);
        this.setupDataChannel(channel);
        
        console.log(`[WebRTC] Creating offer for ${this.targetId}`);
        const offer = await this.peerConnection.createOffer();
        console.log(`[WebRTC] Offer created, setting as local description`);
        await this.peerConnection.setLocalDescription(offer);
        
        console.log(`[WebRTC] Sending offer to ${this.targetId}`);
        this.socket.emit('signal', { 
          target: this.targetId, 
          payload: { type: 'offer', sdp: { type: offer.type, sdp: offer.sdp } } 
        });
      } catch (error) {
        console.error(`[WebRTC] Error initializing connection for ${this.targetId}:`, error);
      }
    }
  }

  public async handleSignal(payload: any) {
    try {
      console.log(`[WebRTC] Received signal type: ${payload.type} for ${this.targetId}`);
      
      if (payload.type === 'offer') {
        console.log(`[WebRTC] Processing OFFER from ${this.targetId}`);
        const sdp = payload.sdp;
        const sdpString = typeof sdp === 'string' ? sdp : sdp.sdp;
        console.log(`[WebRTC] Setting remote description with SDP type: offer`);
        
        await this.peerConnection.setRemoteDescription({ 
          type: 'offer', 
          sdp: sdpString
        });
        
        console.log(`[WebRTC] Creating answer for ${this.targetId}`);
        const answer = await this.peerConnection.createAnswer();
        await this.peerConnection.setLocalDescription(answer);
        
        console.log(`[WebRTC] Sending answer to ${this.targetId}`);
        this.socket.emit('signal', { 
          target: this.targetId, 
          payload: { type: 'answer', sdp: { type: answer.type, sdp: answer.sdp } } 
        });
      } 
      else if (payload.type === 'answer') {
        console.log(`[WebRTC] Processing ANSWER from ${this.targetId}`);
        const sdp = payload.sdp;
        const sdpString = typeof sdp === 'string' ? sdp : sdp.sdp;
        console.log(`[WebRTC] Setting remote description with SDP type: answer`);
        
        await this.peerConnection.setRemoteDescription({ 
          type: 'answer', 
          sdp: sdpString
        });
      } 
      else if (payload.type === 'ice-candidate') {
        if (payload.candidate) {
          console.log(`[WebRTC] Adding ICE candidate for ${this.targetId}`);
          try {
            await this.peerConnection.addIceCandidate(payload.candidate);
          } catch (e) {
            console.warn(`[WebRTC] Failed to add ICE candidate:`, e);
          }
        }
      }
    } catch (error) {
      console.error(`[WebRTC] Signaling Error for ${this.targetId}:`, error);
    }
  }

  private setupDataChannel(channel: RTCDataChannel) {
    console.log(`[WebRTC] Setting up data channel for ${this.targetId}, label: ${channel.label}, id: ${channel.id}`);
    this.dataChannel = channel;
    
    // ✅ CRITICAL: Force Binary Type to 'arraybuffer' to prevent corruption
    this.dataChannel.binaryType = 'arraybuffer';
    
    // Set threshold for backpressure (256KB)
    this.dataChannel.bufferedAmountLowThreshold = 256 * 1024;

    this.dataChannel.onopen = () => {
      console.log(`[WebRTC] ✅ Data channel OPENED for ${this.targetId}, readyState: ${this.dataChannel?.readyState}`);
      this.onStateChange('connected');
    };
    
    this.dataChannel.onclose = () => {
      console.log(`[WebRTC] ❌ Data channel CLOSED for ${this.targetId}`);
      this.onStateChange('disconnected');
    };
    
    this.dataChannel.onerror = (error) => {
      console.error(`[WebRTC] ❌ Data channel ERROR for ${this.targetId}:`, error.error);
    };
    
    // Monitor bufferedAmount changes
    this.dataChannel.onbufferedamountlow = () => {
      console.log(`[WebRTC] Buffered amount low for ${this.targetId}: ${this.dataChannel?.bufferedAmount} bytes`);
    };
    
    // Receiver: Direct raw data to the handler
    this.dataChannel.onmessage = (e) => {
      const size = e.data instanceof ArrayBuffer ? e.data.byteLength : 'unknown';
      console.log(`[WebRTC] Received message from ${this.targetId}, size: ${size} bytes`);
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
    if (!this.dataChannel) {
      console.error(`[WebRTC] No data channel available for ${this.targetId}`);
      throw new Error(`No data channel for ${this.targetId}`);
    }

    const readyState = this.dataChannel.readyState;
    if (readyState !== 'open') {
      console.error(`[WebRTC] Data channel not open for ${this.targetId}, state: ${readyState}`);
      throw new Error(`Data channel not open: ${readyState}`);
    }

    // If browser buffer is dangerously full (>1MB), pause and wait
    if (this.dataChannel.bufferedAmount > 1024 * 1024) {
      console.warn(`[WebRTC] Backpressure detected for ${this.targetId}, buffered: ${this.dataChannel.bufferedAmount} bytes`);
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          console.error(`[WebRTC] Backpressure timeout for ${this.targetId}`);
          this.dataChannel?.removeEventListener('bufferedamountlow', onLow);
          reject(new Error('Backpressure timeout'));
        }, 30000); // 30 second timeout
        
        const onLow = () => {
          clearTimeout(timeout);
          console.log(`[WebRTC] Backpressure relieved for ${this.targetId}`);
          this.dataChannel?.removeEventListener('bufferedamountlow', onLow);
          resolve();
        };
        this.dataChannel?.addEventListener('bufferedamountlow', onLow);
      });
    }

    try {
      this.dataChannel.send(data);
    } catch (e) {
      console.error(`[WebRTC] Transmission failure to ${this.targetId}:`, e);
      throw e;
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