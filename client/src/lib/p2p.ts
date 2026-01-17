import Peer from 'peerjs';
import type { DataConnection } from 'peerjs'; 

export class P2PManager {
  peer: Peer;
  conn: DataConnection | null = null;
  onData: (data: any) => void;
  onConnect: () => void;

  constructor(username: string, onConnect: () => void, onData: (data: any) => void) {
    this.onConnect = onConnect;
    this.onData = onData;

    // Create a Peer with the username as the ID (so Bob knows to call "Bob")
    this.peer = new Peer(username, {
      debug: 2,
      config: {
        iceServers: [
          // 1. Google's Public STUN (Helps find IP)
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          
          // 2. OpenRelay (Free TURN Server - Bypasses Firewalls)
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
      },
    });

    this.peer.on('open', (id) => {
      console.log('✅ My P2P ID is:', id);
    });

    // Handle Incoming Connections (When someone calls me)
    this.peer.on('connection', (conn) => {
      console.log("📞 Incoming connection from:", conn.peer);
      this.setupConnection(conn);
    });

    this.peer.on('error', (err) => {
      console.error("❌ PeerJS Error:", err);
    });
  }

  // Call another user
  connectTo(targetUsername: string) {
    console.log(`✨ Connecting to ${targetUsername}...`);
    const conn = this.peer.connect(targetUsername);
    this.setupConnection(conn);
  }

  // Setup listeners for the data channel
  private setupConnection(conn: DataConnection) {
    this.conn = conn;

    // 1. Log Connection State Changes
    conn.peerConnection.oniceconnectionstatechange = () => {
      console.log(`❄️ ICE State: ${conn.peerConnection.iceConnectionState}`);
      // If this says "disconnected" or "failed", the firewall is blocking you.
    };

    conn.on('open', () => {
      console.log("🤝 Connection Open!");
      this.onConnect();
    });

    conn.on('data', (data) => {
      this.onData(data);
    });

    conn.on('error', (err) => console.error("Connection Error:", err));
  }

  send(data: any) {
    if (this.conn && this.conn.open) {
      this.conn.send(data);
    } else {
      console.warn("⚠️ Cannot send, connection not open.");
    }
  }

  destroy() {
    this.peer.destroy();
  }
}