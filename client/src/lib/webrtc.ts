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
  private signalQueue: any[] = [];
  private remoteDescriptionSet = false;

  constructor(socket: Socket, targetId: string, onData: (data: ArrayBuffer) => void, onStateChange: (state: string) => void) {
    this.socket = socket;
    this.targetId = targetId;
    this.onData = onData;
    this.onStateChange = onStateChange;

    this.peerConnection = new RTCPeerConnection(ICE_SERVERS);
    console.log(`[WebRTC] Created peer connection for ${targetId}`);

    // 1. ICE Candidate Exchange (with batching)
    let iceCandidateQueue: any[] = [];
    let iceTimeout: any = null;
    
    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        console.log(`[WebRTC] ICE candidate generated for ${targetId}`);
        iceCandidateQueue.push(event.candidate);
        
        // Batch send candidates every 50ms to reduce overhead
        if (!iceTimeout) {
          iceTimeout = setTimeout(() => {
            if (iceCandidateQueue.length > 0) {
              console.log(`[WebRTC] Sending ${iceCandidateQueue.length} ICE candidates for ${targetId}`);
              iceCandidateQueue.forEach(candidate => {
                this.socket.emit('signal', { 
                  target: this.targetId, 
                  payload: { type: 'ice-candidate', candidate } 
                });
              });
              iceCandidateQueue = [];
            }
            iceTimeout = null;
          }, 50);
        }
      } else {
        console.log(`[WebRTC] ICE gathering complete for ${targetId}`);
        // Send any remaining candidates
        if (iceTimeout) clearTimeout(iceTimeout);
        if (iceCandidateQueue.length > 0) {
          console.log(`[WebRTC] Sending final ${iceCandidateQueue.length} ICE candidates for ${targetId}`);
          iceCandidateQueue.forEach(candidate => {
            this.socket.emit('signal', { 
              target: this.targetId, 
              payload: { type: 'ice-candidate', candidate } 
            });
          });
          iceCandidateQueue = [];
        }
      }
    };

    // 2. Connection State Monitoring
    this.peerConnection.onconnectionstatechange = () => {
      const state = this.peerConnection.connectionState;
      console.log(`[WebRTC] Connection state change for ${targetId}: ${state}`);
      console.log(`[WebRTC]   - ICE connection state: ${this.peerConnection.iceConnectionState}`);
      console.log(`[WebRTC]   - Signaling state: ${this.peerConnection.signalingState}`);
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
      console.log(`[WebRTC]   - Connection state: ${this.peerConnection.connectionState}`);
      
      // Only report connection as failed if ICE is truly failed (not just gathering/checking)
      if (state === 'failed') {
        console.error(`[WebRTC] ❌ ICE connection FAILED for ${targetId}`);
        // Give it a moment before reporting failure, in case it recovers
        setTimeout(() => {
          if (this.peerConnection.iceConnectionState === 'failed') {
            console.error(`[WebRTC] ICE failure confirmed for ${targetId}`);
          }
        }, 1000);
      }
    };

    // 4. Receiver: Handle incoming channel creation from Peer
    this.peerConnection.ondatachannel = (event) => {
      console.log(`[WebRTC] Data channel received from ${targetId}, label: ${event.channel.label}`);
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

  private async processSignalQueue() {
    while (this.signalQueue.length > 0 && this.remoteDescriptionSet) {
      const signal = this.signalQueue.shift();
      console.log(`[WebRTC] Processing queued signal: ${signal.type} for ${this.targetId}`);
      try {
        if (signal.type === 'ice-candidate' && signal.candidate) {
          await this.peerConnection.addIceCandidate(signal.candidate);
        }
      } catch (e) {
        console.warn(`[WebRTC] Failed to process queued signal:`, e);
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
        console.log(`[WebRTC] Setting remote description with SDP type: offer, length: ${sdpString.length}`);
        
        await this.peerConnection.setRemoteDescription({ 
          type: 'offer', 
          sdp: sdpString
        });
        this.remoteDescriptionSet = true;
        console.log(`[WebRTC] Remote description set successfully`);
        
        // Process any queued ICE candidates
        await this.processSignalQueue();
        
        console.log(`[WebRTC] Creating answer for ${this.targetId}`);
        const answer = await this.peerConnection.createAnswer();
        console.log(`[WebRTC] Answer created, setting as local description`);
        await this.peerConnection.setLocalDescription(answer);
        console.log(`[WebRTC] Local description set, sending answer back`);
        
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
        console.log(`[WebRTC] Setting remote description with SDP type: answer, length: ${sdpString.length}`);
        
        await this.peerConnection.setRemoteDescription({ 
          type: 'answer', 
          sdp: sdpString
        });
        this.remoteDescriptionSet = true;
        console.log(`[WebRTC] Remote description (answer) set successfully`);
        
        // Process any queued ICE candidates
        await this.processSignalQueue();
      } 
      else if (payload.type === 'ice-candidate') {
        if (!this.remoteDescriptionSet) {
          // Queue ICE candidates until remote description is set
          console.log(`[WebRTC] Queueing ICE candidate (waiting for remote description)`);
          this.signalQueue.push(payload);
        } else {
          if (payload.candidate) {
            console.log(`[WebRTC] Adding ICE candidate for ${this.targetId}`);
            try {
              await this.peerConnection.addIceCandidate(payload.candidate);
              console.log(`[WebRTC] ICE candidate added successfully`);
            } catch (e) {
              console.warn(`[WebRTC] Failed to add ICE candidate:`, e);
            }
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

    // Set initial threshold
    this.dataChannel.bufferedAmountLowThreshold = this.bufferThreshold;

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


  private setupTurboChannel(channel: RTCDataChannel) {
    channel.binaryType = 'arraybuffer';
    channel.bufferedAmountLowThreshold = 64 * 1024; // Keep light for speed

    channel.onmessage = (e) => {
      if (e.data instanceof ArrayBuffer) {
        this.onData(e.data);
      }
    };

    this.turboChannels.push(channel);
  }

  // ✅ ENABLE TURBO MODE (4 Parallel Channels)
  public async enableTurboMode() {
    if (this.isTurbo) return;
    this.isTurbo = true;
    console.log(`[WebRTC] 🚀 Enabling Turbo Mode (Parallel Channels)`);

    // Create 3 additional channels (Total 4 including main)
    for (let i = 1; i <= 3; i++) {
      const channel = this.peerConnection.createDataChannel(`turbo-${i}`, { ordered: true });
      this.setupTurboChannel(channel);
    }
  }

  public disableTurboMode() {
    if (!this.isTurbo) return;
    this.isTurbo = false;
    console.log(`[WebRTC] 🛑 Disabling Turbo Mode`);

    // Close aux channels
    this.turboChannels.forEach(c => c.close());
    this.turboChannels = [];
  }

  // ✅ DYNAMIC BUFFER TUNING
  public setBufferParams(limit: number, threshold: number) {
    this.bufferLimit = limit;
    this.bufferThreshold = threshold;
    if (this.dataChannel) {
      this.dataChannel.bufferedAmountLowThreshold = threshold;
    }
    console.log(`[WebRTC] Buffer tuned: Limit=${(limit / 1024 / 1024).toFixed(1)}MB, Threshold=${(threshold / 1024).toFixed(0)}KB`);
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
        targetChannel?.addEventListener('bufferedamountlow', onLow);
      });
    }

    try {
      targetChannel?.send(data);
    } catch (e) {
      console.error(`[WebRTC] Transmission failure to ${this.targetId}:`, e);
      throw e;
    }
  }

  public close() {
    this.disableTurboMode();  // Cleanup Turbo Channels
    if (this.dataChannel) {
      this.dataChannel.onmessage = null;
      this.dataChannel.close();
    }
    this.peerConnection.close();
  }
}