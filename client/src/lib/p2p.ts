import Peer from 'peerjs';
import type { DataConnection } from 'peerjs';
import { io, Socket } from 'socket.io-client';

export class P2PManager {
  peer: Peer | null = null;
  conn: DataConnection | null = null;
  onData: (data: any) => void;
  onConnect: () => void;
  onError: (err: string) => void;
  socket: Socket;
  username: string;
  peerId: string = '';
  private socketConnected = false;
  private peerReady = false;
  private peerInitialized = false;

  constructor(username: string, onConnect: () => void, onData: (data: any) => void, onError?: (err: string) => void) {
    this.onConnect = onConnect;
    this.onData = onData;
    this.onError = onError || ((err) => console.error(err));
    this.username = username;

    // Connect to signaling server
    const serverUrl = 'http://10.34.16.107:3001';
    this.socket = io(serverUrl, {
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: 5,
      transports: ['websocket', 'polling']
    });

    // Setup socket listeners first
    this.setupSocketListeners();
    
    // Initialize Peer connection after a small delay to ensure socket is ready
    setTimeout(() => {
      if (!this.peerInitialized) {
        this.initializePeer();
      }
    }, 500);
  }

  private setupSocketListeners() {
    this.socket.on('connect', () => {
      this.socketConnected = true;
      console.log('✅ Connected to signaling server');
      // Try to register if peer is already ready
      this.tryRegister();
    });

    this.socket.on('disconnect', () => {
      this.socketConnected = false;
      console.log('❌ Disconnected from signaling server');
      this.onError('Disconnected from server');
    });

    this.socket.on('register-success', (peerId) => {
      console.log('✅ Successfully registered with server:', peerId);
    });

    this.socket.on('user-online', (data) => {
      console.log(`👤 User online: ${data.username} (${data.peerId})`);
    });

    this.socket.on('user-offline', (data) => {
      console.log(`👤 User offline: ${data.username}`);
    });
  }

  private initializePeer() {
    if (this.peerInitialized) return;
    this.peerInitialized = true;

    console.log('🚀 Initializing PeerJS...');

    try {
      // Create a Peer without specifying an ID and without host/port (uses default)
      this.peer = new Peer({
        debug: 2,
        config: {
          iceServers: [
            // Google STUN
            { urls: 'stun:stun.l.google.com:19302' },
            
            // OpenRelay TURN (Keep this, it's correct)
            { 
              urls: 'turn:openrelay.metered.ca:80', 
              username: 'openrelayproject', 
              credential: 'openrelayproject' 
            },
            { 
              urls: 'turn:openrelay.metered.ca:443', 
              username: 'openrelayproject', 
              credential: 'openrelayproject' 
            },
            { 
              urls: 'turn:openrelay.metered.ca:443?transport=tcp', 
              username: 'openrelayproject', 
              credential: 'openrelayproject' 
            }
          ],
          // ⚠️ ADD THESE FLAGS FOR STABILITY ⚠️
          iceTransportPolicy: 'all', // Try everything (Local + Public)
          iceCandidatePoolSize: 10,
        },
      });

      this.peer.on('open', (id) => {
        this.peerId = id;
        this.peerReady = true;
        console.log('✅ My PeerJS ID is:', id);
        this.tryRegister();
      });

      this.peer.on('connection', (conn) => {
        console.log("📞 Incoming connection from:", conn.peer);
        this.setupConnection(conn);
      });

      this.peer.on('error', (err) => {
        console.error("❌ PeerJS Error:", err);
        // Don't fail on network error immediately, retry
        if (err.type === 'network') {
          console.log('⚠️ Network error, PeerJS will auto-reconnect...');
        } else {
          this.onError(`PeerJS Error: ${err.type}`);
        }
      });

      this.peer.on('disconnected', () => {
        console.log('⚠️ PeerJS disconnected, attempting to reconnect...');
        if (this.peer) {
          this.peer.reconnect();
        }
      });

      this.peer.on('close', () => {
        console.log('❌ PeerJS connection closed');
        this.peerReady = false;
      });

    } catch (error) {
      console.error('Failed to initialize PeerJS:', error);
      this.onError('Failed to initialize P2P connection');
    }
  }

  private tryRegister() {
    if (this.socketConnected && this.peerReady && this.peerId) {
      console.log(`📝 Registering ${this.username} with PeerJS ID: ${this.peerId}`);
      this.socket.emit('register-user', this.username, this.peerId);
    }
  }

  // Call another user by username with retry logic
  connectTo(targetUsername: string, retries: number = 5, delayMs: number = 1200) {
    // Prevent multiple simultaneous connection attempts
    if (this.conn) {
      console.warn('⚠️ Already connected or connecting');
      return;
    }

    const attemptConnection = (retriesLeft: number) => {
      console.log(`\n✨ Looking up ${targetUsername}... (${retriesLeft} retries left)`);
      
      this.socket.emit('get-user', targetUsername, (response: any) => {
        if (response.found) {
          console.log(`\n🎯 FOUND ${targetUsername}! Peer ID: ${response.peerId}`);
          console.log('📡 Initiating WebRTC connection...\n');
          
          // Create the connection
          const conn = this.peer.connect(response.peerId, {
            reliable: true,
            ordered: true,
          });
          
          // Setup listeners immediately
          this.setupConnection(conn);
        } else {
          if (retriesLeft > 0) {
            console.log(`⏳ "${targetUsername}" not found yet - waiting for them to click "Start Node"...`);
            console.log(`   Retrying in ${delayMs}ms... (${retriesLeft} attempts left)`);
            setTimeout(() => attemptConnection(retriesLeft - 1), delayMs);
          } else {
            const errorMsg = `❌ Could not find "${targetUsername}" after multiple attempts.\n\nMake sure:\n1. "${targetUsername}" clicked "Start Node" first\n2. Username spelling matches EXACTLY (case-sensitive)\n3. Both users are on the same server`;
            console.error(errorMsg);
            this.onError(errorMsg);
          }
        }
      });
    };

    // Start the connection attempt
    attemptConnection(retries);
  }

  // Setup listeners for the data channel
  private setupConnection(conn: DataConnection) {
    this.conn = conn;
    let iceFailureTimeout: ReturnType<typeof setTimeout>;
    let connectionEstablished = false;

    // Force connection after 10 seconds if it hasn't opened
    const forceConnectionTimeout = setTimeout(() => {
      if (!connectionEstablished) {
        console.warn('⚠️ Forcing connection after timeout...');
        // Try to force the connection by checking the underlying RTCDataChannel
        try {
          if (conn.peerConnection && conn.peerConnection.connectionState) {
            console.log(`RTCPeerConnection state: ${conn.peerConnection.connectionState}`);
          }
        } catch (e) {
          console.error('Error checking connection:', e);
        }
      }
    }, 10000);

    // Monitor ICE connection state
    conn.peerConnection.oniceconnectionstatechange = () => {
      const state = conn.peerConnection.iceConnectionState;
      console.log(`❄️ ICE State: ${state}`);
      
      switch(state) {
        case 'checking':
          console.log('🔍 ICE is checking candidates...');
          break;
          
        case 'connected':
        case 'completed':
          console.log('✅ ICE Connected! Waiting for data channel...');
          clearTimeout(iceFailureTimeout);
          break;
          
        case 'disconnected':
          console.warn('⚠️ ICE Disconnected - may reconnect');
          clearTimeout(iceFailureTimeout);
          break;
          
        case 'failed':
          console.error('❌ ICE Connection Failed');
          clearTimeout(iceFailureTimeout);
          this.onError('Connection failed - firewall blocking. On same machine? Try different network.');
          break;
          
        case 'closed':
          console.log('Connection closed');
          clearTimeout(iceFailureTimeout);
          break;
      }
    };

    // Monitor RTCPeerConnection state (higher level)
    conn.peerConnection.onconnectionstatechange = () => {
      const state = conn.peerConnection.connectionState;
      console.log(`🔗 Peer Connection State: ${state}`);
      
      if (state === 'failed') {
        clearTimeout(forceConnectionTimeout);
        this.onError('Peer connection failed');
      } else if (state === 'connected' || state === 'completed') {
        console.log('✅ Peer connection established at RTCPeerConnection level');
      }
    };

    // Monitor ICE candidates
    conn.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        console.log(`🧊 ICE Candidate (${event.candidate.type}):`, event.candidate.candidate.substring(0, 100));
      } else {
        console.log('✅ All ICE candidates gathered - connection should proceed');
      }
    };

    conn.on('open', () => {
      console.log("🤝 ✅✅✅ Connection Open! Data channel is ready! ✅✅✅");
      connectionEstablished = true;
      clearTimeout(iceFailureTimeout);
      clearTimeout(forceConnectionTimeout);
      this.onConnect();
    });

    conn.on('data', (data) => {
      console.log('📨 Received data');
      this.onData(data);
    });

    conn.on('error', (err) => {
      console.error("❌ Connection Error:", err);
      clearTimeout(iceFailureTimeout);
      clearTimeout(forceConnectionTimeout);
      this.onError(`Connection Error: ${err}`);
    });

    conn.on('close', () => {
      console.log('Connection closed');
      this.conn = null;
    });
  }

  send(data: any) {
    if (this.conn && this.conn.open) {
      this.conn.send(data);
    } else {
      console.warn("⚠️ Cannot send, connection not open.");
    }
  }

  destroy() {
    this.socket.disconnect();
    if (this.peer) {
      this.peer.destroy();
    }
  }
}