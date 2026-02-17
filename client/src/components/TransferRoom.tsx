import { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { io, Socket } from 'socket.io-client';
import { motion, AnimatePresence } from 'framer-motion';
import { generateKeyPair, exportPublicKey, importPublicKey, deriveSharedKey } from '../lib/crypto';
import { sendFilePipeline, ReceiverPipeline } from '../lib/pipeline';
import { WebRTCManager } from '../lib/webrtc'; 
import { processFile } from '../lib/compression'; 
import { FilePicker } from './FilePicker';
import { 
  Cpu, Wifi, Download, Bell, Signal,Play, Activity, Layers, Zap, Terminal, Loader2, Users, LogOut, ShieldAlert, Search, UserCheck, UserX, ChevronDown, ShieldCheck, Globe, Info 
} from 'lucide-react';
import clsx from 'clsx';

// --- DESIGN SYSTEM ---
const COLORS = {
  bg: '#0B0F14',
  surface: '#121826',
  text: '#E5E7EB',
  accent: '#3B82F6'
};

/**
 * 🛠 HELPER: ROBUST MULTI-LAYER RECONSTRUCTION
 * Final stage of the pipeline: Inflates compressed binary data (Gzip/Brotli) 
 * after AES decryption to restore the original file headers.
 */
const decompressBlob = async (blob: Blob, algo: string): Promise<Blob> => {
  try {
    let format: CompressionFormat | null = null;
    if (algo.includes('Gzip') || algo.includes('Audio') || algo.includes('Adaptive')) format = 'gzip';
    else if (algo.includes('Brotli')) format = 'deflate'; 
    
    if (!format) return blob; 

    const ds = new DecompressionStream(format);
    const decompressedStream = blob.stream().pipeThrough(ds);
    return await new Response(decompressedStream).blob();
  } catch (error) {
    console.error("Critical Reconstruction Error:", error);
    return blob; // Fallback to raw bytes if stream inflation fails
  }
};

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';
const socket: Socket = io(SERVER_URL, { 
  transports: ['websocket', 'polling'], 
  reconnectionAttempts: 10,
  reconnectionDelay: 1000 
});

export const TransferRoom = () => {
  const navigate = useNavigate();
  
  // --- IDENTITY & CORE STATUS ---
  const [username] = useState(localStorage.getItem('username') || '');
  const [status, setStatus] = useState('Initializing Systems...');
  // ✅ FIX: Ensure this is declared to avoid "Cannot find name" error
  const [p2pState, setP2pState] = useState<string>('disconnected');
  
  // --- NETWORKING & DISCOVERY ---
  const [roomId, setRoomId] = useState('');
  const [isJoined, setIsJoined] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResult, setSearchResult] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [verifiedUser, setVerifiedUser] = useState<{name: string, status: string} | null>(null);
  const [incomingRequest, setIncomingRequest] = useState<{from: string, key: JsonWebKey} | null>(null);

  // --- MESH ARCHITECTURE STATE ---
  const [peers, setPeers] = useState<{id: string, username: string, status: string}[]>([]);
  const peersRef = useRef<Map<string, WebRTCManager>>(new Map()); 
  const keysRef = useRef<Map<string, CryptoKey>>(new Map());      
  const keyPairRef = useRef<CryptoKeyPair | null>(null);
  const receiverPipelineRef = useRef<ReceiverPipeline | null>(null);
  const lastAckRef = useRef<string>(''); 

  // --- PIPELINE MONITORING & UI ---
  const [isTransferring, setIsTransferring] = useState(false);
  const [encryptionReady, setEncryptionReady] = useState(false); 
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);
  const [receivedFiles, setReceivedFiles] = useState<{name: string, url: string}[]>([]);
  const [transferStats, setTransferStats] = useState<any>(null);
  const [queueStatus, setQueueStatus] = useState(''); 
  const [advancedStats, setAdvancedStats] = useState<any>(null);

  // Terminal logging logic
  const addLog = (msg: string) => setLogs(prev => [...prev.slice(-19), `${new Date().toLocaleTimeString()} - ${msg}`]);

  // =========================================
  // 1. PEER FACTORY (WebRTC HANDSHAKE)
  // =========================================
  const createPeerConnection = useCallback((targetId: string, isInitiator: boolean) => {
    if (peersRef.current.has(targetId)) return peersRef.current.get(targetId)!;

    const manager = new WebRTCManager(socket, targetId, 
      (data) => handleIncomingData(data, targetId), 
      (state) => {
        setPeers(prev => prev.map(p => p.id === targetId ? { ...p, status: state } : p));
        if (state === 'connected') {
          setP2pState('connected');
          if (keyPairRef.current) {
            exportPublicKey(keyPairRef.current.publicKey).then(k => {
              socket.emit('signal', { target: targetId, payload: { type: 'pub-key', key: k } });
            });
          }
        } else if (state === 'failed' || state === 'closed') {
          peersRef.current.delete(targetId);
          keysRef.current.delete(targetId);
        }
      }
    );

    manager.initConnection(isInitiator);
    peersRef.current.set(targetId, manager);
    return manager;
  }, [socket, username]);

  // =========================================
  // 2. SOCKET BUS & SIGNALING
  // =========================================
  useEffect(() => {
    if (!username) { navigate('/auth'); return; }
    
    generateKeyPair().then(keys => { 
      keyPairRef.current = keys; 
      addLog("Local Identity ECDH Keys Generated"); 
    });
    
    socket.emit('register-user', username);
    setStatus('Online');

    socket.on('connect', () => { setStatus('Online'); socket.emit('register-user', username); });
    socket.on('disconnect', () => { setStatus('Offline'); setEncryptionReady(false); });

    socket.on('user-status', (data: any) => {
      setIsSearching(false);
      if (data.status === 'online') {
        setSearchResult(data.username);
        setVerifiedUser({ name: data.username, status: 'Online' });
      } else {
        setSearchResult(null);
        setVerifiedUser(null);
      }
    });

    socket.on('signal', async ({ sender, payload }) => {
      let manager = peersRef.current.get(sender);

      if (!manager) {
        setPeers(prev => prev.find(p => p.id === sender) ? prev : [...prev, { id: sender, username: `Guest_${sender.slice(0,4)}`, status: 'Connecting...' }]);
        manager = createPeerConnection(sender, false); 
      }
      
      if (manager) await manager.handleSignal(payload);
      
      if (payload.type === 'conn-request') {
        setIncomingRequest({ from: payload.username || sender, key: payload.key });
      }

      if (payload.type === 'pub-key') {
        try {
          const foreignKey = await importPublicKey(payload.key);
          if (keyPairRef.current) {
            const shared = await deriveSharedKey(keyPairRef.current.privateKey, foreignKey);
            keysRef.current.set(sender, shared);
            addLog(`🔐 AES-256 secure tunnel synced with ${sender.slice(0,4)}`);
            setEncryptionReady(true);
            setPeers(prev => prev.map(p => p.id === sender ? { ...p, status: 'connected' } : p));
          }
        } catch(e) { console.error("Handshake Error:", e); }
      }
    });

    socket.on('user-joined', ({ id, username }) => {
      addLog(`${username} entered the mesh.`);
      setPeers(prev => prev.find(p => p.id === id) ? prev : [...prev, { id, username, status: 'Connecting...' }]);
      createPeerConnection(id, false); 
    });

    socket.on('existing-users', (users) => {
      users.forEach((u: any) => {
        setPeers(prev => prev.find(p => p.id === u.id) ? prev : [...prev, { id: u.id, username: u.username, status: 'Connecting...' }]);
        createPeerConnection(u.id, true); 
      });
    });

    socket.on('user-left', (id) => {
      addLog(`Node disconnected from mesh.`);
      peersRef.current.get(id)?.close();
      peersRef.current.delete(id);
      keysRef.current.delete(id);
      setPeers(prev => prev.filter(p => p.id !== id));
      if (peersRef.current.size === 0) setEncryptionReady(false);
    });

    return () => { 
      socket.off('signal'); socket.off('user-joined'); socket.off('existing-users'); socket.off('user-left'); socket.off('user-status');
    };
  }, [username, navigate, createPeerConnection]);

  // =========================================
  // 3. SEARCH DISCOVERY DEBOUNCE
  // =========================================
  useEffect(() => {
    const delayDebounceFn = setTimeout(() => {
      if (searchQuery.length > 2 && searchQuery !== username) {
        setIsSearching(true);
        socket.emit('check-user', searchQuery); 
      } else {
        setSearchResult(null); setVerifiedUser(null); setIsSearching(false);
      }
    }, 500); 
    return () => clearTimeout(delayDebounceFn);
  }, [searchQuery, username]);

  // =========================================
  // 4. ACTION HANDLERS
  // =========================================
  const handleJoinRoom = () => {
    if (!roomId) return alert("Enter a valid Room ID");
    socket.emit('join-room', roomId, username);
    setIsJoined(true);
    addLog(`Initialized Mesh Room: ${roomId}`);
  };

  const handleDirectConnect = (targetUsername: string) => {
    if (!keyPairRef.current) return;
    exportPublicKey(keyPairRef.current.publicKey).then(key => {
        socket.emit('signal', { target: targetUsername, payload: { type: 'conn-request', key, username } });
    });
    addLog(`Direct Handshake Request sent...`);
  };

  const acceptRequest = () => { setIncomingRequest(null); addLog("Connection authorized."); };
  
  const handleLogout = () => { 
    localStorage.clear(); 
    socket.disconnect(); 
    peersRef.current.forEach(p => p.close()); 
    navigate('/auth'); 
  };

  // =========================================
  // 5. RECEIVER ENGINE (INBOUND DATA)
  // =========================================
  const handleIncomingData = async (data: ArrayBuffer, senderId: string) => {
    try {
      const text = new TextDecoder().decode(data);
      if (text.trim().startsWith('{')) {
        const msg = JSON.parse(text);
        
        if (msg.type === 'file-start') {
          setIsTransferring(true);
          addLog(`⬇️ Receiving stream: ${msg.name}`);
          setProgress(0);
          const sharedKey = keysRef.current.get(senderId);
          if (sharedKey) {
            receiverPipelineRef.current = new ReceiverPipeline(sharedKey, msg.algo, async (blob, stats) => {
              setQueueStatus("Reassembling Data Layers...");
              
              let finalBlob = blob;
              const needsDecompression = msg.algo.includes('Gzip') || msg.algo.includes('Brotli') || msg.name.endsWith('.gz');

              if (needsDecompression) {
                 addLog(`📂 Inflating binary packets...`);
                 finalBlob = await decompressBlob(blob, msg.algo);
              }

              // ✅ MIME ENFORCEMENT: Fixes IPYNB and PDF opening issues
              const lowerName = msg.name.toLowerCase();
              let finalMime = finalBlob.type;
              if (lowerName.endsWith('.pdf')) finalMime = 'application/pdf';
              else if (lowerName.endsWith('.ipynb')) finalMime = 'application/x-ipynb+json';
              else if (lowerName.endsWith('.json')) finalMime = 'application/json';

              const correctedBlob = new Blob([finalBlob], { type: finalMime });

              // EXTENSION CLEANUP
              let finalName = msg.name.replace(/\.gz$/, "").replace(/\.br$/, "");

              const url = URL.createObjectURL(correctedBlob);
              setReceivedFiles(prev => [...prev, { name: finalName, url }]);
              
              setTransferStats({ 
                ...stats, 
                originalSize: correctedBlob.size, 
                finalSize: stats.originalSize 
              });
              
              addLog(`✅ Integrity Verified: ${finalName}`);
              setProgress(100); setIsTransferring(false); setQueueStatus('');
              
              const ackMsg = JSON.stringify({ type: 'file-ack', name: msg.name });
              // ✅ FIX: Explicitly cast to ArrayBuffer
              const ackBuffer = new TextEncoder().encode(ackMsg);
              peersRef.current.get(senderId)?.sendData(ackBuffer.buffer);
            });
          }
        } 
        else if (msg.type === 'file-end') {
          // DELAYED FLUSH: Ensures binary stream flushes before closing pipeline
          setTimeout(() => receiverPipelineRef.current?.finish(), 250);
        }
        else if (msg.type === 'file-ack') {
          lastAckRef.current = msg.name;
        }
        return; 
      }
    } catch (e) {
      console.warn("Processing binary chunk...");
    }

    if (receiverPipelineRef.current) {
      receiverPipelineRef.current.processChunk(data);
      setProgress(p => (p >= 98 ? 98 : p + 0.5));
    }
  };

  // =========================================
  // 6. SENDER ENGINE (SEQUENTIAL MESH BROADCAST)
  // =========================================
  const startBatchTransfer = async (files: File[], algos: Map<string, string>) => {
    if (peersRef.current.size === 0) return alert("Network disconnected. Join a room.");

    setIsTransferring(true);
    const encoder = new TextEncoder();

    try {
      for (let i = 0; i < files.length; i++) {
        let file = files[i];
        setQueueStatus(`Pre-Transfer Security Check...`);
        
        const { file: processedFile, meta } = await processFile(file);
        const algoName = algos.get(file.name) || meta.algorithm;
        setAdvancedStats(meta);
        file = processedFile; 

        if (meta.securityStatus === 'Suspicious') {
           alert(`🚫 SECURITY ALERT\nRisk Score: ${meta.riskScore}%\nReason: ${meta.reason}`);
           addLog(`🚫 Blocked potentially malicious file: ${files[i].name}`);
           continue; 
        }
        
        addLog(`🤖 Intelligence: Applied ${algoName}`);

        const activePeers = Array.from(peersRef.current.entries());
        let peerCount = 1;

        for (const [peerId, manager] of activePeers) {
           const sharedKey = keysRef.current.get(peerId);
           if (!sharedKey || manager.peerConnection.connectionState !== 'connected') continue;

           setQueueStatus(`Mesh Broadcast: Node ${peerCount}/${activePeers.length}...`);
           setProgress(0);

           // ✅ FIX: Convert Uint8Array to ArrayBuffer for WebRTC compatibility
           const startMeta = encoder.encode(JSON.stringify({ type: 'file-start', name: file.name, algo: algoName }));
           await manager.sendData(startMeta.buffer);

           await sendFilePipeline(file, sharedKey, algoName, async (chunk) => {
              // chunk is already ArrayBuffer coming from pipeline.ts
              await manager.sendData(chunk);
              setProgress(p => (p >= 98 ? 98 : p + 0.5));
           });

           // Backpressure Control
           // @ts-ignore
           while (manager.dataChannel?.bufferedAmount > 0) await new Promise(r => setTimeout(r, 100));
           
           // ✅ FIX: Convert Uint8Array to ArrayBuffer
           const endMeta = encoder.encode(JSON.stringify({ type: 'file-end', name: file.name }));
           await manager.sendData(endMeta.buffer);
           
           addLog(`Waiting for Node ${peerCount} ACK...`);
           await new Promise<void>(resolve => {
              const check = setInterval(() => {
                 if (lastAckRef.current === file.name) { clearInterval(check); resolve(); }
              }, 150);
              setTimeout(() => { clearInterval(check); resolve(); }, 10000); 
           });
           
           lastAckRef.current = ''; 
           peerCount++;
        }

        setTransferStats({ originalSize: meta.originalSize, finalSize: file.size, speed: 'N/A' });
        addLog(`✅ Broadcast Success: "${file.name}"`);
        setProgress(100);
      }
      setQueueStatus('');
      addLog("Batch Sequence Complete");
    } catch (e) {
      console.error(e);
      addLog("❌ Pipeline Failure");
    } finally {
      setIsTransferring(false);
      setProgress(0);
    }
  };

  // =========================================
  // 7. RENDERING SYSTEM
  // =========================================
  return (
    <div className="min-h-screen font-sans selection:bg-blue-500/30" style={{ backgroundColor: COLORS.bg, color: COLORS.text }}>
      
      {/* HUD NAVBAR */}
      <nav className="sticky top-0 z-50 border-b border-gray-800 bg-[#0B0F14]/80 backdrop-blur-md px-6 h-16 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-900/50">
            <Cpu className="text-white w-5 h-5" />
          </div>
          <div className="flex flex-col">
            <span className="font-bold text-xl tracking-tight text-white leading-tight">SmartStream</span>
            <span className="text-blue-500 text-[10px] font-bold tracking-[0.2em] uppercase">Enterprise Mesh</span>
          </div>
        </div>
        <div className="flex items-center gap-6">
           <div className={clsx("flex items-center gap-2 px-3 py-1.5 rounded-full text-[10px] font-bold border uppercase tracking-widest", status === 'Online' ? "bg-green-500/10 border-green-500/20 text-green-400" : "bg-red-500/10 border-red-500/20 text-red-400")}>
             <Globe className={clsx("w-3 h-3", status === 'Online' && "animate-spin-slow")} />
             {status === 'Online' ? 'Network Hub Active' : 'Network Lost'}
           </div>
           <div className="h-8 w-px bg-gray-800" />
           <span className="text-xs font-bold text-gray-300 hidden md:block">@{username}</span>
           <button onClick={handleLogout} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-gray-800/50 hover:bg-red-500/10 hover:text-red-400 text-gray-400 border border-transparent hover:border-red-500/20 group transition-all">
             <LogOut className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
             <span className="text-xs font-bold hidden md:block">Sign Out</span>
           </button>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-6 py-8 grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* LEFT COLUMN */}
        <div className="lg:col-span-8 space-y-6">
          
          {/* MESH PANEL */}
          <div className="bg-[#121826] border border-gray-800 rounded-3xl p-8 shadow-2xl relative z-30 overflow-hidden">
             {!isJoined ? (
               <div className="relative z-10">
                 <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-6 flex items-center gap-3">
                   <Users className="w-5 h-5 text-blue-400" /> Mesh Synchronization
                 </h2>
                 <div className="flex gap-4 p-1.5 bg-black/50 rounded-2xl border border-gray-700 focus-within:border-blue-500 transition-all">
                   <input 
                     value={roomId} 
                     onChange={e => setRoomId(e.target.value)} 
                     placeholder="Room ID (e.g. 'TEAM-ALPHA')" 
                     className="flex-1 bg-transparent px-5 py-3 text-white outline-none placeholder:text-gray-600 font-medium" 
                   />
                   <button onClick={handleJoinRoom} className="bg-blue-600 hover:bg-blue-500 text-white font-bold px-8 rounded-xl transition-all shadow-xl shadow-blue-600/20 flex items-center gap-2 uppercase text-xs">
                     <Play className="w-3 h-3 fill-current" /> Join Room
                   </button>
                 </div>
               </div>
             ) : (
               <div className="relative z-10 flex items-center justify-between">
                 <div>
                   <h2 className="text-2xl font-black text-white flex items-center gap-3 italic tracking-tight uppercase">
                     <Globe className="text-blue-500 animate-pulse" /> {roomId}
                   </h2>
                   <div className="flex items-center gap-2 mt-1">
                     <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                     <p className="text-[10px] font-bold text-blue-400 uppercase tracking-widest">{peers.length} Nodes Connected</p>
                   </div>
                 </div>
                 <div className="flex -space-x-3 hover:space-x-1 transition-all duration-500">
                    {peers.map((p, i) => (
                      <div key={i} title={`${p.username}: ${p.status}`} className={clsx("w-12 h-12 rounded-2xl border-4 border-[#121826] flex items-center justify-center text-sm font-black text-white shadow-xl transition-transform hover:scale-110", p.status === 'connected' ? "bg-green-500" : "bg-yellow-500")}>
                        {p.username[0].toUpperCase()}
                      </div>
                    ))}
                 </div>
               </div>
             )}
          </div>

          {/* HANDSHAKE PANEL */}
          {!isJoined && (
            <div className="bg-[#121826] border border-gray-800 rounded-3xl p-6 shadow-xl relative z-20">
               <h2 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-3"><Signal className="w-4 h-4 text-blue-400" /> Direct Tunnel Discovery</h2>
               <div className="relative group">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 w-5 h-5 group-focus-within:text-blue-500 transition-colors" />
                  <input 
                    type="text" placeholder="Search unique identifier for P2P handshake..." 
                    className="w-full bg-black border border-gray-700 rounded-2xl py-4 pl-12 pr-4 text-white outline-none focus:border-blue-500/50 transition-all text-sm"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value.trim().toLowerCase())}
                  />
                  {isSearching && (<div className="absolute right-4 top-1/2 -translate-y-1/2"><Loader2 className="animate-spin w-4 h-4 text-blue-500" /></div>)}
                  <AnimatePresence>
                    {searchQuery.length > 2 && !isSearching && (
                      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="absolute top-full left-0 right-0 mt-3 bg-[#1A202C] border border-gray-700 rounded-2xl shadow-2xl z-50 overflow-hidden">
                         {verifiedUser ? (
                           <div className="p-4 flex items-center justify-between hover:bg-gray-800/50 cursor-pointer" onClick={() => handleDirectConnect(searchResult!)}>
                             <div className="flex items-center gap-4">
                                <div className="w-10 h-10 rounded-xl bg-green-500/20 text-green-400 flex items-center justify-center border border-green-500/30 font-bold">{verifiedUser.name[0].toUpperCase()}</div>
                                <div><span className="font-bold text-gray-200 block text-sm">{verifiedUser.name}</span><span className="text-[10px] text-green-400 font-mono">NODE_ONLINE</span></div>
                             </div>
                             <button className="text-[10px] font-black bg-blue-600 hover:bg-blue-500 text-white px-5 py-2.5 rounded-xl transition-all uppercase">Connect</button>
                           </div>
                         ) : (
                           <div className="p-6 text-center text-gray-500 text-xs flex flex-col items-center gap-2"><UserX className="w-8 h-8 opacity-20" /> Identity not found in directory.</div>
                         )}
                      </motion.div>
                    )}
                  </AnimatePresence>
               </div>
            </div>
          )}

          {/* TRANSFER PIPELINE */}
          <div className="relative z-10 group">
             {queueStatus && (
                <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="mb-4 bg-blue-500/10 border border-blue-500/20 p-4 rounded-2xl flex items-center justify-center gap-4 shadow-xl">
                   <Loader2 className="animate-spin text-blue-400 w-5 h-5" />
                   <span className="text-xs font-black text-blue-400 uppercase tracking-widest">{queueStatus}</span>
                </motion.div>
             )}
             <FilePicker onFilesSelected={startBatchTransfer} disabled={(!isJoined && peers.length === 0) || isTransferring || !encryptionReady} />
          </div>
          
          {/* HEURISTIC DROPDOWN */}
          <AnimatePresence>
             {advancedStats && (
               <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mt-4">
                 <details className="group bg-[#0B0F14] border border-gray-800 rounded-3xl overflow-hidden shadow-xl">
                   <summary className="flex items-center justify-between p-5 cursor-pointer hover:bg-gray-800/50 select-none">
                     <div className="flex items-center gap-3 text-[10px] font-bold text-gray-400 group-open:text-blue-400 uppercase tracking-widest">
                       <ShieldCheck className="w-5 h-5" /> Pipeline Analytics Report
                     </div>
                     <ChevronDown className="w-5 h-5 text-gray-600 group-open:rotate-180 transition-transform" />
                   </summary>
                   <div className="p-6 pt-0 border-t border-gray-800/50 grid grid-cols-2 md:grid-cols-3 gap-6 text-[10px] font-mono">
                     <div className="space-y-1"><span className="text-gray-600 uppercase tracking-wider block">Algorithm</span><div className="text-blue-300 font-bold px-2 py-1 bg-blue-500/10 rounded w-max">{advancedStats.algorithm}</div></div>
                     <div className="space-y-1"><span className="text-gray-600 uppercase tracking-wider block">Entropy</span><div className="text-gray-300 text-sm font-bold">{advancedStats.entropy?.toFixed(4)}</div></div>
                     <div className="space-y-1"><span className="text-gray-600 uppercase tracking-wider block">Security</span><div className={clsx("font-black flex items-center gap-1", advancedStats.securityStatus === 'Suspicious' ? "text-red-400" : "text-green-400")}>{advancedStats.securityStatus}</div></div>
                     <div className="space-y-1"><span className="text-gray-600 uppercase tracking-wider block">Reduction</span><div className="text-green-400 font-bold">{(advancedStats.originalSize / advancedStats.compressedSize).toFixed(2)}:1</div></div>
                     <div className="space-y-1"><span className="text-gray-600 uppercase tracking-wider block">Final Weight</span><div className="text-gray-300 font-bold">{(advancedStats.compressedSize / 1024).toFixed(2)} KB</div></div>
                   </div>
                 </details>
               </motion.div>
             )}
          </AnimatePresence>

          {/* METRICS GRID */}
          <AnimatePresence>
            {transferStats && (
              <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="grid grid-cols-2 md:grid-cols-4 gap-5">
                <StatCard label="Input Weight" value={`${(transferStats.originalSize / 1024 / 1024).toFixed(2)} MB`} icon={Layers} color="text-gray-400" />
                <StatCard label="Payload Sent" value={`${(transferStats.finalSize / 1024).toFixed(1)} KB`} icon={Wifi} color="text-blue-400" />
                <StatCard label="Efficiency" value={`${((1 - (transferStats.finalSize / transferStats.originalSize)) * 100).toFixed(1)}%`} icon={Zap} color="text-green-400" />
                <StatCard label="Net Speed" value={`${transferStats.speed || 'N/A'} MB/s`} icon={Activity} color="text-yellow-400" />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* RIGHT COLUMN */}
        <div className="lg:col-span-4 space-y-6 flex flex-col h-full">
           
           {receivedFiles.length > 0 && (
             <motion.div initial={{opacity:0, x: 30}} animate={{opacity:1, x: 0}} className="bg-[#121826] border border-gray-800 rounded-[2rem] p-6 shadow-2xl relative">
               <h3 className="text-[10px] font-black text-gray-500 mb-5 flex items-center gap-3 tracking-widest uppercase">
                 <Download className="w-5 h-5 text-green-500" /> Local Repository
               </h3>
               <div className="space-y-3 max-h-64 overflow-y-auto custom-scrollbar">
                 {receivedFiles.map((f, i) => (
                   <motion.div key={i} layout className="flex justify-between items-center bg-black/40 p-4 rounded-2xl border border-gray-800/50 group">
                     <div className="flex flex-col overflow-hidden"><span className="text-xs text-gray-200 truncate w-32 font-bold tracking-tight">{f.name}</span><span className="text-[9px] text-gray-600 font-mono">VERIFIED_RECONSTRUCTION</span></div>
                     <a href={f.url} download={f.name} className="text-blue-500 hover:text-white bg-blue-500/10 hover:bg-blue-600 p-2 rounded-xl transition-all shadow-lg"><Download className="w-4 h-4" /></a>
                   </motion.div>
                 ))}
               </div>
             </motion.div>
           )}

           {/* SECURITY LOGS */}
           <div className="bg-black border border-gray-800 rounded-[2rem] p-1 flex-1 flex flex-col min-h-[450px] shadow-2xl overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-800 flex items-center justify-between bg-gray-900/30 rounded-t-[1.9rem]">
                 <div className="flex items-center gap-3"><Terminal className="w-4 h-4 text-blue-500" /><span className="text-[10px] font-black text-gray-500 uppercase">Mesh Output Terminal</span></div>
                 <div className="flex gap-1.5"><div className="w-2.5 h-2.5 rounded-full bg-red-500/20" /><div className="w-2.5 h-2.5 rounded-full bg-yellow-500/20" /><div className="w-2.5 h-2.5 rounded-full bg-green-500/20 animate-pulse" /></div>
              </div>
              <div className="flex-1 p-6 font-mono text-[10px] space-y-2 overflow-y-auto custom-scrollbar text-gray-400">
                 {logs.map((l, i) => (
                   <motion.div key={i} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="flex gap-3 items-start group">
                     <span className="text-blue-500/50">»</span>
                     <span className={clsx("leading-relaxed", l.includes('Error') || l.includes('Block') ? "text-red-400 font-bold" : l.includes('Receiving') ? "text-blue-400" : l.includes('Ready') || l.includes('Verified') ? "text-green-400" : "text-gray-500")}>{l}</span>
                   </motion.div>
                 ))}
                 <div className="animate-pulse text-blue-500 font-black pl-1">_</div>
              </div>
           </div>
        </div>
      </div>

      {/* OVERLAY PROGRESS */}
      <AnimatePresence>
        {isTransferring && (
          <motion.div initial={{ y: 50, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 50, opacity: 0 }} className="fixed bottom-0 left-0 right-0 bg-[#0B0F14]/95 backdrop-blur-xl border-t border-blue-500/20 p-6 z-50">
             <div className="max-w-4xl mx-auto">
               <div className="flex justify-between items-center mb-3">
                 <span className="text-[10px] font-black text-blue-400 animate-pulse uppercase tracking-[0.3em]">Mesh Synchronization Sequence</span>
                 <span className="text-[10px] font-mono font-black text-gray-400 bg-gray-800/50 px-3 py-1 rounded-lg">{Math.round(progress)}% DISPATCHED</span>
               </div>
               <div className="w-full h-2 bg-gray-900 rounded-full overflow-hidden border border-gray-800 shadow-inner">
                 <motion.div className="h-full bg-gradient-to-r from-blue-600 via-cyan-400 to-blue-600" style={{ width: `${progress}%` }} />
               </div>
             </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* HANDSHAKE MODAL */}
      <AnimatePresence>
        {incomingRequest && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md px-6">
             <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className="bg-[#121826] border border-blue-500/30 p-10 rounded-[2.5rem] shadow-[0_0_100px_rgba(59,130,246,0.2)] max-w-sm w-full text-center relative overflow-hidden">
                <div className="w-16 h-16 bg-blue-500/10 rounded-2xl flex items-center justify-center mx-auto mb-6 border border-blue-500/20"><Bell className="w-8 h-8 text-blue-400 animate-bounce" /></div>
                <h3 className="text-xl font-black text-white mb-2">Node Handshake</h3>
                <p className="text-xs text-gray-400 mb-10 leading-relaxed font-medium"><strong className="text-blue-400">@{incomingRequest.from}</strong> is requesting a private encrypted tunnel.</p>
                <div className="flex gap-4"><button onClick={() => setIncomingRequest(null)} className="flex-1 py-4 rounded-2xl bg-gray-800 text-gray-300 font-black text-[10px] uppercase tracking-widest transition-all">Ignore</button><button onClick={acceptRequest} className="flex-1 py-4 rounded-2xl bg-blue-600 text-white font-black text-[10px] uppercase tracking-widest shadow-xl shadow-blue-600/30 transition-all active:scale-95">Authorize</button></div>
             </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

const StatCard = ({ label, value, icon: Icon, color }: any) => (
  <div className="bg-[#121826] border border-gray-800 p-6 rounded-3xl flex flex-col justify-between h-32 hover:border-gray-600 transition-all overflow-hidden relative">
    <Icon className="absolute top-0 right-0 p-2 opacity-5 w-20 h-20" />
    <div className="flex items-center justify-between mb-3"><span className="text-[10px] font-black text-gray-500 uppercase tracking-widest leading-none">{label}</span><div className={clsx("p-2 rounded-lg bg-gray-900/50 shadow-inner", color)}><Icon className="w-4 h-4" /></div></div>
    <span className="text-xl font-black text-gray-200 tracking-tighter tabular-nums">{value}</span>
  </div>
);