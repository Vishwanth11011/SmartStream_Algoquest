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
  // Dynamic Buffer Control (Safe Defaults)
  private bufferLimit: number = 1024 * 1024; // 1MB (Safe)
  private bufferThreshold: number = 64 * 1024; // 64KB (Conservative)

  // TURBO MODE (Parallel Channels)
  private turboChannels: RTCDataChannel[] = [];
  private isTurbo: boolean = false;
  private currentChannelIndex: number = 0;

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
      // If label starts with 'turbo-', add to turbo pool
      if (event.channel.label.startsWith('turbo-')) {
        console.log(`[WebRTC] Received Turbo Channel: ${event.channel.label}`);
        this.setupTurboChannel(event.channel);
      } else {
        this.setupDataChannel(event.channel);
      }
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
    } catch (error) {
      console.error("WebRTC Signaling Error:", error);
    }
  }

  private setupDataChannel(channel: RTCDataChannel) {
    this.dataChannel = channel;

    // ✅ CRITICAL: Force Binary Type to 'arraybuffer' to prevent corruption
    this.dataChannel.binaryType = 'arraybuffer';

    // Set initial threshold
    this.dataChannel.bufferedAmountLowThreshold = this.bufferThreshold;

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
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
      console.warn("Attempted to send data while channel was not open.");
      return;
    }

    // If browser buffer is dangerously full (>limit), pause and wait
    // Turbo Mode: Check ALL channels or just the current one? 
    // Strategy: Round-Robin Load Balancing

    let targetChannel = this.dataChannel;

    if (this.isTurbo && this.turboChannels.length > 0) {
      // Round Robin Selection
      const pool = [this.dataChannel!, ...this.turboChannels];
      targetChannel = pool[this.currentChannelIndex] || this.dataChannel;
      this.currentChannelIndex = (this.currentChannelIndex + 1) % pool.length;
    }

    if (targetChannel && targetChannel.bufferedAmount > this.bufferLimit) {
      await new Promise<void>(resolve => {
        const onLow = () => {
          targetChannel?.removeEventListener('bufferedamountlow', onLow);
          resolve();
        };
        targetChannel?.addEventListener('bufferedamountlow', onLow);
      });
    }

    try {
      targetChannel?.send(data);
    } catch (e) {
      console.error(`Transmission failure to ${this.targetId}:`, e);
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