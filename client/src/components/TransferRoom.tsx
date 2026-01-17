import React, { useEffect, useState, useRef } from 'react';
import { P2PManager } from '../lib/p2p';
import { generateKeyPair, exportPublicKey, importPublicKey, deriveSharedKey } from '../lib/crypto';
import { sendFilePipeline, ReceiverPipeline } from '../lib/pipeline';
import { FilePicker } from './FilePicker';
import { ShieldCheck, Cpu, Terminal } from 'lucide-react';

export const TransferRoom = () => {
  const [username, setUsername] = useState('');
  const [targetUser, setTargetUser] = useState('');
  const [joined, setJoined] = useState(false);
  const [status, setStatus] = useState('Disconnected');
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);
  
  const p2pRef = useRef<P2PManager | null>(null);
  const keyPairRef = useRef<CryptoKeyPair | null>(null);
  const sharedKeyRef = useRef<CryptoKey | null>(null);
  const receiverPipelineRef = useRef<ReceiverPipeline | null>(null);

  const addLog = (msg: string) => setLogs(prev => [...prev.slice(-5), msg]);

  // 1. Generate Keys on Mount
  useEffect(() => {
    generateKeyPair().then(keys => {
      keyPairRef.current = keys;
      addLog("🔐 Crypto Keys Ready");
    });
    return () => p2pRef.current?.destroy(); // Cleanup on unmount
  }, []);

  const handleJoin = () => {
    if (!username) return;
    setJoined(true);
    addLog(`⏳ Initializing Node as ${username}...`);

    // Initialize PeerJS
    p2pRef.current = new P2PManager(
      username, 
      // 1. On Connect Callback (The connection worked!)
      async () => {
        setStatus('🟢 P2P Connected');
        addLog("🤝 Peer Connection Opened!");
        
        // NOW we do the handshake
        if (keyPairRef.current) {
          addLog("🔑 Sending Crypto Keys...");
          const pubKey = await exportPublicKey(keyPairRef.current.publicKey);
          p2pRef.current?.send({ type: 'key-swap', key: pubKey });
        } else {
          addLog("❌ Error: Crypto Keys not ready yet!");
        }
      },
      // 2. On Data Callback
      async (data: any) => {
         await handleIncomingData(data);
      }
    );

    // ⚠️ NEW: Listen for "ID Taken" errors explicitly
    p2pRef.current.peer.on('error', (err) => {
      if (err.type === 'unavailable-id') {
        alert(`The name '${username}' is taken! Please refresh and try a unique name (e.g. ${username}_${Math.floor(Math.random()*1000)})`);
        setJoined(false); // Go back to login
      } else {
        addLog(`❌ P2P Error: ${err.type}`);
      }
    });
  };
  
  const handleConnect = () => {
    if (!targetUser) return;
    addLog(`📞 Calling ${targetUser}...`);
    p2pRef.current?.connectTo(targetUser);
  };

  const handleIncomingData = async (data: any) => {
    // 1. Protocol Messages (JSON)
    if (data.type) {
      if (data.type === 'key-swap') {
        addLog("🔑 Received Public Key");
        const foreignKey = await importPublicKey(data.key);
        if (keyPairRef.current) {
          sharedKeyRef.current = await deriveSharedKey(keyPairRef.current.privateKey, foreignKey);
          addLog("🔒 Secure Tunnel Established (AES-GCM)");
        }
      }
      if (data.type === 'file-start') {
        addLog(`📥 Receiving File: ${data.name}`);
        if (sharedKeyRef.current) {
          receiverPipelineRef.current = new ReceiverPipeline(sharedKeyRef.current, (blob) => {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = data.name;
            a.click();
            addLog("✅ Download Complete!");
            setProgress(100);
          });
        }
      }
      return;
    }

    // 2. Binary Data (Encrypted Chunks)
    // PeerJS sends binary as ArrayBuffer
    if (data instanceof ArrayBuffer || data instanceof Uint8Array) {
      if (receiverPipelineRef.current) {
        await receiverPipelineRef.current.processChunk(new Uint8Array(data));
        setProgress(p => (p >= 90 ? 90 : p + 2));
      }
    }
  };

  const startTransfer = async (file: File, algo: string) => {
    if (!sharedKeyRef.current) return alert("Wait for Secure Handshake!");
    
    addLog(`🚀 Sending (${algo})...`);
    p2pRef.current?.send({ type: 'file-start', name: file.name });

    await sendFilePipeline(file, sharedKeyRef.current, (chunk) => {
      // PeerJS can send Uint8Array directly
      p2pRef.current?.send(chunk);
      setProgress(p => (p >= 100 ? 100 : p + 1));
    });
    
    setProgress(100);
    addLog("✅ File Sent.");
  };

  // --- RENDER (Same as before) ---
  return (
    <div className="max-w-5xl mx-auto p-4 text-white font-sans">
      <div className="flex justify-between items-center mb-8 border-b border-gray-700 pb-4">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Cpu className="text-blue-500" /> SmartStream (PeerJS)
        </h1>
        <div className={`px-3 py-1 rounded-full text-xs font-bold ${status.includes('Connected') ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
          {status}
        </div>
      </div>

      {!joined ? (
        <div className="max-w-md mx-auto bg-gray-800 p-8 rounded-2xl border border-gray-700">
          <h2 className="text-xl font-bold mb-4">Identity Setup</h2>
          <input 
            className="w-full bg-gray-900 border border-gray-600 rounded-lg p-3 mb-4 text-white"
            placeholder="Username (e.g. Alice)"
            value={username}
            onChange={e => setUsername(e.target.value)}
          />
          <button onClick={handleJoin} className="w-full bg-blue-600 hover:bg-blue-500 py-3 rounded-lg font-bold">
            Start Node
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
           {/* LEFT: Controls */}
           <div className="space-y-6">
            <div className="bg-gray-800 p-6 rounded-2xl border border-gray-700">
              <h3 className="text-sm font-semibold text-gray-400 uppercase mb-4">Connect</h3>
              <div className="flex gap-2">
                <input 
                  className="flex-1 bg-gray-900 border border-gray-600 rounded-lg p-2 text-sm text-white"
                  placeholder="Target Username"
                  value={targetUser}
                  onChange={e => setTargetUser(e.target.value)}
                />
                <button onClick={handleConnect} className="bg-green-600 px-4 rounded-lg text-sm font-bold hover:bg-green-500">
                  Connect
                </button>
              </div>
            </div>

            <div className="bg-gray-800 p-6 rounded-2xl border border-gray-700">
              <h3 className="text-sm font-semibold text-gray-400 uppercase mb-4">File Pipeline</h3>
              <FilePicker onFileSelected={startTransfer} />
            </div>
          </div>

          {/* RIGHT: Logs & Status */}
          <div className="space-y-6">
            <div className="bg-gray-800 p-6 rounded-2xl border border-gray-700 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-gray-200">Encryption</h3>
                <p className="text-xs text-gray-400 mt-1">{sharedKeyRef.current ? 'AES-GCM ACTIVE' : 'Waiting...'}</p>
              </div>
              <ShieldCheck className={`w-10 h-10 ${sharedKeyRef.current ? 'text-green-500' : 'text-gray-600'}`} />
            </div>

            <div className="bg-black p-4 rounded-xl border border-gray-800 h-64 overflow-y-auto font-mono text-xs space-y-2">
              <div className="flex items-center gap-2 text-gray-500 mb-2 border-b border-gray-800 pb-2">
                <Terminal className="w-4 h-4" /> System Log
              </div>
              {logs.map((log, i) => (
                <div key={i} className="text-green-400"> {log} </div>
              ))}
            </div>
             {progress > 0 && (
              <div className="w-full bg-gray-700 rounded-full h-2">
                <div className="bg-blue-500 h-2 rounded-full" style={{ width: `${progress}%` }}></div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};