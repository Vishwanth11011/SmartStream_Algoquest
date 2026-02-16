import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { io, Socket } from 'socket.io-client';
import { motion, AnimatePresence } from 'framer-motion';
import { generateKeyPair, exportPublicKey, importPublicKey, deriveSharedKey } from '../lib/crypto';
import { sendFilePipeline, ReceiverPipeline } from '../lib/pipeline';
import { WebRTCManager } from '../lib/webrtc'; 
import { processFile } from '../lib/compression'; 
import { FilePicker } from './FilePicker';
import { 
  Cpu, Wifi, Download, Bell, Lock, Activity, Layers, Link2Off, Zap, Terminal, Signal, Loader2, Users, Play, LogOut, ShieldAlert, Search, UserCheck, UserX, ChevronDown 
} from 'lucide-react';
import clsx from 'clsx';

// --- THEME CONSTANTS ---
const COLORS = {
  bg: '#0B0F14',
  surface: '#121826',
  text: '#E5E7EB',
};

// --- HELPER: ROBUST DECOMPRESSION ---
const decompressBlob = async (blob: Blob, algo: string): Promise<Blob> => {
  try {
    let format: CompressionFormat | null = null;
    if (algo.includes('Gzip') || algo.includes('Audio') || algo.includes('Adaptive')) format = 'gzip';
    else if (algo.includes('Brotli')) format = 'deflate'; 
    if (!format) return blob; 
    const ds = new DecompressionStream(format);
    return await new Response(blob.stream().pipeThrough(ds)).blob();
  } catch (error) {
    console.warn("Decompression failed:", error);
    return blob; 
  }
};

// --- SOCKET CONFIGURATION ---
const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';
const socket: Socket = io(SERVER_URL, { 
  transports: ['websocket', 'polling'], 
  reconnectionAttempts: 10,
  reconnectionDelay: 1000
});

export const TransferRoom = () => {
  const navigate = useNavigate();
  
  // --- STATE ---
  const [username] = useState(localStorage.getItem('username') || '');
  const [status, setStatus] = useState('Connecting...');
  
  const [roomId, setRoomId] = useState('');
  const [isJoined, setIsJoined] = useState(false);
  
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResult, setSearchResult] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [verifiedUser, setVerifiedUser] = useState<{name: string, status: string} | null>(null);
  const [incomingRequest, setIncomingRequest] = useState<{from: string, key: JsonWebKey} | null>(null);

  const [peers, setPeers] = useState<{id: string, username: string, status: string}[]>([]);
  
  // --- REFS ---
  const peersRef = useRef<Map<string, WebRTCManager>>(new Map()); 
  const keysRef = useRef<Map<string, CryptoKey>>(new Map());      
  const keyPairRef = useRef<CryptoKeyPair | null>(null);
  const receiverPipelineRef = useRef<ReceiverPipeline | null>(null);
  const lastAckRef = useRef<string>(''); 

  // --- UI STATE ---
  const [isTransferring, setIsTransferring] = useState(false);
  const [encryptionReady, setEncryptionReady] = useState(false); 
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);
  const [receivedFiles, setReceivedFiles] = useState<{name: string, url: string}[]>([]);
  const [transferStats, setTransferStats] = useState<any>(null);
  const [queueStatus, setQueueStatus] = useState(''); 
  const [advancedStats, setAdvancedStats] = useState<any>(null);

  const addLog = (msg: string) => setLogs(prev => [...prev.slice(-19), msg]);

  // --- INITIALIZATION ---
  useEffect(() => {
    if (!username) { navigate('/auth'); return; }
    
    generateKeyPair().then(keys => { 
      keyPairRef.current = keys; 
      addLog("Identity Keys Generated"); 
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
        setPeers(prev => {
            if (prev.find(p => p.id === sender)) return prev;
            return [...prev, { id: sender, username: `User ${sender.slice(0,4)}`, status: 'Connecting...' }];
        });
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
            addLog(`🔐 Secure Link Established with ${sender.slice(0,4)}`);
            setEncryptionReady(true);
            setPeers(prev => prev.map(p => p.id === sender ? { ...p, status: 'connected' } : p));
          }
        } catch(e) {
          console.error("Key Exchange Failed", e);
        }
      }
    });

    socket.on('user-joined', ({ id, username }) => {
      addLog(`${username} joined the room.`);
      setPeers(prev => {
        if (prev.find(p => p.id === id)) return prev;
        return [...prev, { id, username, status: 'Connecting...' }];
      });
      createPeerConnection(id, true); 
    });

    socket.on('existing-users', (users) => {
      users.forEach((u: any) => {
        setPeers(prev => {
            if (prev.find(p => p.id === u.id)) return prev;
            return [...prev, { id: u.id, username: u.username, status: 'Connecting...' }];
        });
        createPeerConnection(u.id, true); 
      });
    });

    socket.on('user-left', (id) => {
      addLog(`User ${id.slice(0,4)} left.`);
      peersRef.current.get(id)?.close();
      peersRef.current.delete(id);
      keysRef.current.delete(id);
      setPeers(prev => prev.filter(p => p.id !== id));
      if (peersRef.current.size === 0) setEncryptionReady(false);
    });

    return () => { 
      socket.off('signal'); socket.off('user-joined'); socket.off('existing-users'); socket.off('user-left'); socket.off('user-status');
    };
  }, [username, navigate]);

  // --- SEARCH DEBOUNCE ---
  useEffect(() => {
    const delayDebounceFn = setTimeout(() => {
      if (searchQuery.length > 2 && searchQuery !== username) {
        setIsSearching(true);
        socket.emit('check-user', searchQuery); 
      } else {
        setSearchResult(null);
        setVerifiedUser(null);
        setIsSearching(false);
      }
    }, 500); 
    return () => clearTimeout(delayDebounceFn);
  }, [searchQuery, username]);

  // --- CONNECTION LOGIC ---
  const createPeerConnection = (targetId: string, isInitiator: boolean) => {
    if (peersRef.current.has(targetId)) return peersRef.current.get(targetId)!;

    const manager = new WebRTCManager(socket, targetId, 
      (data) => handleIncomingData(data, targetId), 
      (state) => { 
        setPeers(prev => prev.map(p => p.id === targetId ? { ...p, status: state } : p));
        if (state === 'connected' && keyPairRef.current) {
           exportPublicKey(keyPairRef.current.publicKey).then(k => {
              socket.emit('signal', { target: targetId, payload: { type: 'pub-key', key: k } });
           });
        }
      }
    );

    manager.initConnection(isInitiator);
    peersRef.current.set(targetId, manager);
    return manager;
  };

  const handleJoinRoom = () => {
    if (!roomId) return alert("Enter a room ID");
    socket.emit('join-room', roomId, username);
    setIsJoined(true);
    addLog(`Joined Room: ${roomId}`);
  };

  const handleDirectConnect = (targetUsername: string) => {
    if (!keyPairRef.current) return;
    exportPublicKey(keyPairRef.current.publicKey).then(key => {
        socket.emit('signal', { 
            target: targetUsername, 
            payload: { type: 'conn-request', key, username } 
        });
    });
    addLog(`Request sent to ${targetUsername}...`);
  };

  const acceptRequest = async () => {
    if (!incomingRequest || !keyPairRef.current) return;
    setIncomingRequest(null);
    addLog("Connection Accepted.");
  };

  const handleLogout = () => {
    localStorage.removeItem('username');
    localStorage.removeItem('token');
    if (socket.connected) socket.disconnect();
    peersRef.current.forEach(p => p.close());
    navigate('/auth');
  };

  // --- RECEIVER LOGIC ---
  const handleIncomingData = async (data: ArrayBuffer, senderId: string) => {
    try {
      const text = new TextDecoder().decode(data);
      if (text.trim().startsWith('{')) {
        const msg = JSON.parse(text);
        
        if (msg.type === 'file-start') {
          setIsTransferring(true);
          addLog(`⬇️ Receiving from ${senderId.slice(0,4)}...`);
          setProgress(0);
          
          const sharedKey = keysRef.current.get(senderId);
          if (sharedKey) {
            receiverPipelineRef.current = new ReceiverPipeline(sharedKey, msg.algo, async (blob, stats) => {
              let finalBlob = blob;
              let finalName = msg.name;
              
              const needsDecompression = msg.algo.includes('Gzip') || msg.algo.includes('Brotli') || finalName.endsWith('.gz') || finalName.endsWith('.br');

              if (needsDecompression) {
                 setQueueStatus("Decompressing...");
                 addLog(`📂 Unpacking ${msg.algo}...`);
                 finalBlob = await decompressBlob(blob, msg.algo);
                 if (finalName.endsWith('.gz')) finalName = finalName.slice(0, -3);
                 if (finalName.endsWith('.br')) finalName = finalName.slice(0, -3);
              }

              const url = URL.createObjectURL(finalBlob);
              setReceivedFiles(prev => [...prev, { name: finalName, url }]);
              
              setTransferStats({ 
                ...stats, 
                originalSize: finalBlob.size, 
                finalSize: stats.originalSize 
              });
              
              addLog(`✅ Saved: ${finalName}`);
              setProgress(100);
              setIsTransferring(false);
              setQueueStatus('');
              
              const ackMsg = JSON.stringify({ type: 'file-ack', name: msg.name });
              // FIX: Cast Uint8Array to any/unknown to satisfy strict TypeScript 'ArrayBuffer' requirement
              peersRef.current.get(senderId)?.sendData(new TextEncoder().encode(ackMsg) as any);
            });
          }
        } 
        else if (msg.type === 'file-end') {
          receiverPipelineRef.current?.finish();
        }
        else if (msg.type === 'file-ack') {
          lastAckRef.current = msg.name;
        }
        return; 
      }
    } catch (e) {}

    if (receiverPipelineRef.current) {
      receiverPipelineRef.current.processChunk(new Uint8Array(data));
      setProgress(p => (p >= 98 ? 98 : p + 0.5));
    }
  };

  // --- SENDER LOGIC ---
  const startBatchTransfer = async (files: File[], algos: Map<string, string>) => {
    if (peersRef.current.size === 0) return alert("No peers connected! Join a room or connect to a user.");

    setIsTransferring(true);
    const encoder = new TextEncoder();

    try {
      for (let i = 0; i < files.length; i++) {
        let file = files[i];
        setQueueStatus(`Scanning ${file.name}...`);
        
        const { file: processedFile, meta } = await processFile(file);
        const algoName = algos.get(file.name) || meta.algorithm;
        setAdvancedStats(meta);
        file = processedFile; 

        if (meta.securityStatus === 'Suspicious') {
           alert(`🚫 SECURITY BLOCK: "${files[i].name}" was automatically removed.\nReason: ${meta.reason}`);
           addLog(`🚫 Auto-Blocked: ${files[i].name} (Malware Risk)`);
           continue; 
        }
        
        addLog(`🤖 Strategy: ${algoName}`);
        if (file.size < meta.originalSize) {
           addLog(`📉 Reduced by ${((meta.originalSize - file.size)/1024).toFixed(0)} KB`);
        }

        const activePeers = Array.from(peersRef.current.entries());
        let peerIndex = 1;

        for (const [peerId, manager] of activePeers) {
           const sharedKey = keysRef.current.get(peerId);
           if (!sharedKey || manager.peerConnection.connectionState !== 'connected') continue;

           setQueueStatus(`Sending to Peer ${peerIndex}/${activePeers.length}...`);
           setProgress(0);

           // FIX: Cast to any for TS error
           await manager.sendData(encoder.encode(JSON.stringify({ type: 'file-start', name: file.name, algo: algoName })) as any);

           await sendFilePipeline(file, sharedKey, algoName, async (chunk) => {
              // FIX: Cast to any for TS error
              manager.sendData(chunk as any);
              setProgress(p => (p >= 98 ? 98 : p + 0.5));
           });

           // @ts-ignore
           while (manager.dataChannel?.bufferedAmount > 0) await new Promise(r => setTimeout(r, 50));
           
           // FIX: Cast to any for TS error
           await manager.sendData(encoder.encode(JSON.stringify({ type: 'file-end', name: file.name })) as any);
           
           addLog(`Waiting for Peer ${peerIndex} verification...`);
           await new Promise<void>(resolve => {
              const check = setInterval(() => {
                 if (lastAckRef.current === file.name) { clearInterval(check); resolve(); }
              }, 100);
              setTimeout(() => { clearInterval(check); resolve(); }, 8000); 
           });
           
           lastAckRef.current = ''; 
           peerIndex++;
        }

        setTransferStats({ originalSize: meta.originalSize, finalSize: file.size, speed: 'N/A' });
        addLog(`✅ Broadcast Complete: "${file.name}"`);
        setProgress(100);
        await new Promise(r => setTimeout(r, 500));
      }
      setQueueStatus('');
      addLog("Batch Transfer Complete");
    } catch (e) {
      console.error(e);
      addLog("❌ Transfer Error (Check Console)");
    } finally {
      setIsTransferring(false);
      setProgress(0);
    }
  };

  // --- RENDER ---
  return (
    <div className="min-h-screen font-sans selection:bg-blue-500/30" style={{ backgroundColor: COLORS.bg, color: COLORS.text }}>
      
      {/* NAVBAR */}
      <nav className="sticky top-0 z-50 border-b border-gray-800 bg-[#0B0F14]/80 backdrop-blur-md px-6 h-16 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-900/50">
            <Cpu className="text-white w-5 h-5" />
          </div>
          <span className="font-bold text-xl tracking-tight text-white">SmartStream <span className="text-blue-500 text-xs align-top">ULTIMATE</span></span>
        </div>
        <div className="flex items-center gap-4">
           <div className={clsx("flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold border hidden sm:flex", status === 'Online' ? "bg-green-500/10 border-green-500/20 text-green-400" : "bg-red-500/10 border-red-500/20 text-red-400")}>
             <div className={clsx("w-2 h-2 rounded-full", status === 'Online' ? "bg-green-400" : "bg-red-400")} />
             {status === 'Online' ? 'Signal OK' : 'No Signal'}
           </div>
           <span className="text-sm font-medium text-gray-400 hidden sm:block">@{username}</span>
           <button onClick={handleLogout} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-800/50 hover:bg-red-500/10 hover:text-red-400 text-gray-400 transition-all border border-transparent hover:border-red-500/20 group">
             <LogOut className="w-4 h-4 group-hover:scale-110 transition-transform" />
             <span className="text-xs font-bold hidden md:block">Sign Out</span>
           </button>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-6 py-8 grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* LEFT COLUMN: CONTROLS */}
        <div className="lg:col-span-8 space-y-6">
          
          {/* PANEL 1: ROOM CONNECTION (MESH) */}
          <div className="bg-[#121826] border border-gray-800 rounded-2xl p-6 shadow-xl relative z-30">
             {!isJoined ? (
               <div>
                 <h2 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2"><Users className="w-4 h-4 text-blue-400" /> Join a Room (Multi-User)</h2>
                 <div className="flex gap-4">
                   <input 
                     value={roomId} 
                     onChange={e => setRoomId(e.target.value)} 
                     placeholder="Enter Room ID (e.g. 'CS-101')" 
                     className="flex-1 bg-black border border-gray-700 rounded-xl px-4 py-3 text-white outline-none focus:border-blue-500 transition-all" 
                   />
                   <button onClick={handleJoinRoom} className="bg-blue-600 hover:bg-blue-500 text-white font-bold px-6 rounded-xl transition-all shadow-lg shadow-blue-600/20">JOIN</button>
                 </div>
               </div>
             ) : (
               <div className="flex items-center justify-between">
                 <div>
                   <h2 className="text-xl font-bold text-white flex items-center gap-2"><Users className="text-blue-400" /> Room: {roomId}</h2>
                   <p className="text-sm text-gray-400 mt-1">{peers.length} Peers Connected</p>
                 </div>
                 <div className="flex -space-x-2">
                    {peers.map((p, i) => (
                      <div key={i} title={p.username} className={clsx("w-10 h-10 rounded-full border-2 border-[#121826] flex items-center justify-center text-sm font-bold text-white shadow-lg", p.status === 'connected' ? "bg-green-500" : "bg-yellow-500")}>
                        {p.username[0].toUpperCase()}
                      </div>
                    ))}
                    {peers.length === 0 && <div className="text-gray-500 text-sm italic py-2 pl-4">Waiting for others...</div>}
                 </div>
               </div>
             )}
          </div>

          {/* PANEL 2: DIRECT SEARCH (LEGACY P2P) */}
          {!isJoined && (
            <div className="bg-[#121826] border border-gray-800 rounded-2xl p-6 shadow-xl relative z-20">
               <h2 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2"><Search className="w-4 h-4 text-blue-400" /> Direct Connect</h2>
               <div className="relative group">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 w-5 h-5" />
                  <input 
                    type="text" placeholder="Search username..." 
                    className="w-full bg-black border border-gray-700 rounded-xl py-3 pl-12 pr-4 text-white outline-none focus:border-blue-500/50 transition-all"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value.trim().toLowerCase())}
                  />
                  
                  {isSearching && (
                     <div className="absolute right-4 top-1/2 -translate-y-1/2"><Loader2 className="animate-spin w-4 h-4 text-blue-500" /></div>
                  )}

                  <AnimatePresence>
                    {searchQuery.length > 2 && !isSearching && (
                      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="absolute top-full left-0 right-0 mt-2 bg-[#1A202C] border border-gray-700 rounded-xl shadow-2xl z-50 overflow-hidden">
                         {verifiedUser ? (
                           <div className="p-3 flex items-center justify-between hover:bg-gray-800 cursor-pointer transition-colors" onClick={() => handleDirectConnect(searchResult!)}>
                             <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-full bg-green-500/20 text-green-400 flex items-center justify-center border border-green-500/30"><UserCheck className="w-4 h-4" /></div>
                                <div><span className="font-bold text-gray-200 block">{verifiedUser.name}</span><span className="text-[10px] text-green-400 font-mono">ONLINE</span></div>
                             </div>
                             <button className="text-xs font-bold bg-blue-600 text-white px-4 py-2 rounded-lg">CONNECT</button>
                           </div>
                         ) : (
                           <div className="p-4 text-center text-gray-500 text-sm flex items-center justify-center gap-2"><UserX className="w-4 h-4" /> User not found</div>
                         )}
                      </motion.div>
                    )}
                  </AnimatePresence>
               </div>
            </div>
          )}

          {/* FILE PICKER */}
          <div className="relative z-10">
             {queueStatus && (
                <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="mb-4 bg-blue-500/10 border border-blue-500/20 p-3 rounded-xl flex items-center justify-center gap-3">
                   <Loader2 className="animate-spin text-blue-400 w-4 h-4" />
                   <span className="text-sm font-bold text-blue-400">{queueStatus}</span>
                </motion.div>
             )}
             <FilePicker onFilesSelected={startBatchTransfer} disabled={(!isJoined && peers.length === 0) || isTransferring} />
          </div>
          
          {/* ADVANCED STATS DROPDOWN */}
          <AnimatePresence>
             {advancedStats && (
               <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mt-4">
                 <details className="group bg-[#0B0F14] border border-gray-800 rounded-xl overflow-hidden transition-all duration-300 open:border-blue-500/30">
                   <summary className="flex items-center justify-between p-4 cursor-pointer hover:bg-gray-800/50 select-none">
                     <div className="flex items-center gap-2 text-sm font-bold text-gray-400 group-open:text-blue-400">
                       <Cpu className="w-4 h-4" /> Analysis Report
                     </div>
                     <ChevronDown className="w-4 h-4 text-gray-600 group-open:rotate-180 transition-transform" />
                   </summary>
                   
                   <div className="p-4 pt-0 border-t border-gray-800/50 grid grid-cols-2 gap-4 text-xs font-mono">
                     <div className="col-span-2 space-y-1">
                       <span className="text-gray-500 uppercase tracking-wider">Algorithm</span>
                       <div className="flex items-center gap-2 text-blue-300 bg-blue-500/10 px-2 py-1 rounded border border-blue-500/20 w-max">
                          <Terminal className="w-3 h-3" /> {advancedStats.algorithm}
                       </div>
                     </div>
                     <div className="space-y-1">
                       <span className="text-gray-500 uppercase tracking-wider">Entropy</span>
                       <div className="text-gray-300">{advancedStats.entropy ? advancedStats.entropy.toFixed(3) : 'N/A'} <span className="text-gray-600">bits</span></div>
                     </div>
                     <div className="space-y-1">
                       <span className="text-gray-500 uppercase tracking-wider">Security</span>
                       <div className={clsx("font-bold flex items-center gap-1", advancedStats.securityStatus === 'Suspicious' ? "text-red-400" : "text-green-400")}>
                         {advancedStats.securityStatus === 'Suspicious' ? <ShieldAlert className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
                         {advancedStats.securityStatus} ({advancedStats.riskScore}%)
                       </div>
                     </div>
                     <div className="space-y-1">
                       <span className="text-gray-500 uppercase tracking-wider">Ratio</span>
                       <div className="text-green-400 font-bold">{advancedStats.originalSize > 0 ? (advancedStats.originalSize / advancedStats.compressedSize).toFixed(1) : '1.0'}:1</div>
                     </div>
                     <div className="space-y-1">
                       <span className="text-gray-500 uppercase tracking-wider">Final Size</span>
                       <div className="text-gray-300">{(advancedStats.compressedSize / 1024).toFixed(1)} <span className="text-gray-600">KB</span></div>
                     </div>
                   </div>
                 </details>
               </motion.div>
             )}
          </AnimatePresence>

          {/* TRANSFER STATS GRID */}
          <AnimatePresence>
            {transferStats && (
              <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard label="Original Size" value={`${(transferStats.originalSize / 1024 / 1024).toFixed(2)} MB`} icon={Layers} color="text-gray-400" />
                <StatCard label="Bandwidth Used" value={transferStats.finalSize < 1024 * 1024 ? `${(transferStats.finalSize / 1024).toFixed(2)} KB` : `${(transferStats.finalSize / 1024 / 1024).toFixed(2)} MB`} icon={Wifi} color={transferStats.finalSize < transferStats.originalSize ? "text-blue-400" : "text-gray-400"} />
                <StatCard label="Compression" value={(() => { if (!transferStats.originalSize) return '0%'; const ratio = ((1 - (transferStats.finalSize / transferStats.originalSize)) * 100); return ratio > 0 ? `${ratio.toFixed(1)}%` : '0%'; })()} icon={Zap} color={transferStats.finalSize < transferStats.originalSize ? "text-green-400" : "text-gray-500"} />
                <StatCard label="Transfer Speed" value={`${transferStats.speed} MB/s`} icon={Activity} color="text-yellow-400" />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* RIGHT COLUMN: LOGS & FILES */}
        <div className="lg:col-span-4 space-y-4 flex flex-col h-full">
           {receivedFiles.length > 0 && (
             <motion.div initial={{opacity:0}} animate={{opacity:1}} className="bg-[#121826] border border-gray-800 rounded-2xl p-4 shadow-lg">
               <h3 className="text-xs font-bold text-gray-400 mb-3 flex items-center gap-2 tracking-wider"><Download className="w-4 h-4 text-green-500"/> DOWNLOADS</h3>
               <div className="space-y-2 max-h-40 overflow-y-auto custom-scrollbar">
                 {receivedFiles.map((f, i) => (
                   <div key={i} className="flex justify-between items-center bg-[#0B0F14] p-2.5 rounded-lg border border-gray-800/50 hover:border-gray-700 transition-colors group">
                     <span className="text-sm text-gray-300 truncate w-32 font-medium">{f.name}</span>
                     <a href={f.url} download={f.name} className="text-gray-500 hover:text-green-400 transition-colors p-1"><Download className="w-4 h-4"/></a>
                   </div>
                 ))}
               </div>
             </motion.div>
           )}

           <div className="bg-black border border-gray-800 rounded-2xl p-1 flex-1 flex flex-col min-h-[400px] shadow-lg">
              <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between bg-gray-900/50 rounded-t-xl">
                 <div className="flex items-center gap-2"><Terminal className="w-4 h-4 text-blue-500" /><span className="text-xs font-bold text-gray-400">SYSTEM OUTPUT</span></div>
                 <div className="flex gap-1.5"><div className="w-2.5 h-2.5 rounded-full bg-red-500/20" /><div className="w-2.5 h-2.5 rounded-full bg-yellow-500/20" /><div className="w-2.5 h-2.5 rounded-full bg-green-500/20" /></div>
              </div>
              <div className="flex-1 p-4 font-mono text-xs space-y-1.5 overflow-y-auto custom-scrollbar text-gray-400">
                 {logs.map((l, i) => (
                   <motion.div key={i} initial={{ opacity: 0, x: -5 }} animate={{ opacity: 1, x: 0 }} className="flex gap-2">
                     <span className="text-blue-500/50">➜</span>
                     <span className={clsx(l.includes('Error') || l.includes('Block') ? "text-red-400" : l.includes('Receiving') || l.includes('Broadcast') ? "text-blue-400" : l.includes('Saved') ? "text-green-400" : "text-gray-400")}>{l}</span>
                   </motion.div>
                 ))}
                 <div className="animate-pulse text-blue-500">_</div>
              </div>
           </div>
        </div>
      </div>

      {/* PROGRESS OVERLAY */}
      <AnimatePresence>
        {isTransferring && (
          <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 20, opacity: 0 }} className="fixed bottom-0 left-0 right-0 bg-[#121826] border-t border-gray-800 p-4 z-50 shadow-2xl">
             <div className="max-w-3xl mx-auto flex items-center gap-4">
               <span className="text-xs font-bold text-blue-400 animate-pulse flex items-center gap-2"><Activity className="w-4 h-4"/> TRANSFERRING...</span>
               <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
                 <motion.div className="h-full bg-gradient-to-r from-blue-500 to-cyan-400" animate={{ width: `${progress}%` }} />
               </div>
               <span className="text-xs font-mono text-gray-400">{Math.round(progress)}%</span>
             </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* MODAL: INCOMING REQUEST (FALLBACK) */}
      <AnimatePresence>
        {incomingRequest && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
             <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className="bg-[#121826] border border-blue-500/30 p-8 rounded-2xl shadow-2xl max-w-sm w-full text-center relative overflow-hidden">
                <Bell className="w-12 h-12 text-blue-400 mx-auto mb-4 animate-bounce relative z-10" />
                <h3 className="text-xl font-bold text-white mb-2 relative z-10">Connection Request</h3>
                <p className="text-gray-400 mb-8 relative z-10"><strong className="text-white">{incomingRequest.from}</strong> wants to open a direct P2P tunnel.</p>
                <div className="flex gap-3 justify-center relative z-10">
                  <button onClick={() => setIncomingRequest(null)} className="px-6 py-2.5 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-300 font-bold transition-colors">Ignore</button>
                  <button onClick={acceptRequest} className="px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold shadow-lg shadow-blue-500/25 transition-all">Accept</button>
                </div>
             </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

// --- HELPER COMPONENT ---
const StatCard = ({ label, value, icon: Icon, color }: any) => (
  <div className="bg-[#121826] border border-gray-800 p-4 rounded-xl flex flex-col justify-between h-24">
    <div className="flex items-center justify-between mb-2"><span className="text-[10px] font-bold text-gray-500 uppercase">{label}</span><Icon className={`w-4 h-4 ${color}`} /></div>
    <span className="text-lg font-bold text-gray-200 tracking-tight">{value}</span>
  </div>
);