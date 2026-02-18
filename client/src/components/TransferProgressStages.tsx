import React, { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, Cpu, Zap, Lock, Send, Download, Unplug } from 'lucide-react';

export type TransferStage = 'idle' | 'algo-selected' | 'compressing' | 'compressed' | 'encrypting' | 'encrypted' | 'transferring' | 'transferred' | 'decrypting' | 'decrypted' | 'decompressing' | 'decompressed' | 'complete';

interface Stage {
  id: TransferStage;
  label: string;
  description: string;
  icon: React.ReactNode;
}

interface TransferProgressStagesProps {
  currentStage: TransferStage;
  isReceiver?: boolean;
  fileName?: string;
}

const SENDER_STAGES: Stage[] = [
  {
    id: 'algo-selected',
    label: 'Algorithm Selected',
    description: 'Compression algorithm chosen',
    icon: <Cpu className="w-5 h-5" />
  },
  {
    id: 'compressed',
    label: 'Compressed',
    description: 'File data compressed',
    icon: <Zap className="w-5 h-5" />
  },
  {
    id: 'encrypted',
    label: 'Encrypted',
    description: 'Data encrypted with AES-GCM',
    icon: <Lock className="w-5 h-5" />
  },
  {
    id: 'transferred',
    label: 'Transferred',
    description: 'Sent to receiver(s)',
    icon: <Send className="w-5 h-5" />
  }
];

const RECEIVER_STAGES: Stage[] = [
  {
    id: 'transferred',
    label: 'Received',
    description: 'Data received via P2P',
    icon: <Download className="w-5 h-5" />
  },
  {
    id: 'decrypted',
    label: 'Decrypted',
    description: 'AES-GCM decryption complete',
    icon: <Lock className="w-5 h-5" />
  },
  {
    id: 'decompressed',
    label: 'Decompressed',
    description: 'Original file restored',
    icon: <Unplug className="w-5 h-5" />
  },
  {
    id: 'complete',
    label: 'Complete',
    description: 'Ready to download',
    icon: <Check className="w-5 h-5" />
  }
];

/**
 * Check if a stage is completed based on current stage
 */
const isStageDone = (stageId: TransferStage, currentStage: TransferStage): boolean => {
  const stageOrder: TransferStage[] = [
    'algo-selected', 'compressing', 'compressed', 
    'encrypting', 'encrypted', 'transferring', 'transferred',
    'decrypting', 'decrypted', 'decompressing', 'decompressed', 'complete'
  ];
  
  const currentIndex = stageOrder.indexOf(currentStage);
  const stageIndex = stageOrder.indexOf(stageId);
  
  return stageIndex <= currentIndex;
};

/**
 * Get the main visible stage (filter out intermediate states)
 */
const getMainStage = (stage: TransferStage): TransferStage => {
  if (stage.includes('compressing')) return 'compressed';
  if (stage.includes('encrypting')) return 'encrypted';
  if (stage.includes('decrypting')) return 'decrypted';
  if (stage.includes('decompressing')) return 'decompressed';
  return stage;
};

export const TransferProgressStages: React.FC<TransferProgressStagesProps> = ({
  currentStage,
  isReceiver = false,
  fileName = 'File'
}) => {
  const stages = isReceiver ? RECEIVER_STAGES : SENDER_STAGES;
  const mainStage = getMainStage(currentStage);

  const progressPercent = useMemo(() => {
    const doneCount = stages.filter(s => isStageDone(s.id, mainStage)).length;
    return (doneCount / stages.length) * 100;
  }, [stages, mainStage]);

  const currentStageInfo = useMemo(() => {
    return stages.find(s => s.id === mainStage);
  }, [stages, mainStage]);

  return (
    <div className="space-y-4">
      {/* File Name & Current Status */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-300 truncate">{fileName}</h3>
          <span className="text-xs font-mono text-blue-400 bg-blue-500/10 px-3 py-1 rounded-full">
            {progressPercent.toFixed(0)}%
          </span>
        </div>
        <AnimatePresence mode="wait">
          <motion.p
            key={mainStage}
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="text-xs text-gray-400"
          >
            {currentStageInfo?.description || 'Initializing...'}
          </motion.p>
        </AnimatePresence>
      </div>

      {/* Progress Line with Stages */}
      <div className="space-y-4">
        {/* Stages Container */}
        <div className="flex items-stretch justify-between gap-0">
          {stages.map((stage, index) => {
            const isDone = isStageDone(stage.id, mainStage);
            const isCurrentMain = mainStage === stage.id;
            const isActive = isDone || isCurrentMain;

            return (
              <div key={stage.id} className="flex flex-col items-center relative" style={{ flex: `0 0 ${100/stages.length}%` }}>
                {/* Connecting Line */}
                {index < stages.length - 1 && (
                  <div className="absolute top-6 left-[calc(50%+24px)] right-[-50%] h-1">
                    <motion.div
                      initial={{ scaleX: 0 }}
                      animate={{ scaleX: isDone ? 1 : 0 }}
                      transition={{ duration: 0.6, ease: 'easeInOut' }}
                      className="w-full h-full bg-gradient-to-r from-green-500 to-green-400 rounded-full origin-left"
                      style={{
                        boxShadow: isDone ? '0 0 8px rgba(34, 197, 94, 0.3)' : 'none'
                      }}
                    />
                    <div className="w-full h-full bg-gray-700/40 rounded-full" />
                  </div>
                )}

                {/* Stage Circle */}
                <motion.div
                  initial={false}
                  animate={{
                    backgroundColor: isDone ? 'rgb(34, 197, 94)' : isCurrentMain ? 'rgb(59, 130, 246)' : 'rgb(55, 65, 81)',
                    boxShadow: isActive
                      ? isDone
                        ? '0 0 12px rgba(34, 197, 94, 0.4)'
                        : '0 0 12px rgba(59, 130, 246, 0.3)'
                      : 'none'
                  }}
                  transition={{ duration: 0.4 }}
                  className="relative z-10 w-12 h-12 rounded-full flex items-center justify-center border-2 border-gray-800 flex-shrink-0"
                >
                  {isDone ? (
                    <motion.div
                      initial={{ scale: 0, rotate: -180 }}
                      animate={{ scale: 1, rotate: 0 }}
                      transition={{ duration: 0.5, type: 'spring', stiffness: 200 }}
                    >
                      <Check className="w-6 h-6 text-white" strokeWidth={3} />
                    </motion.div>
                  ) : (
                    <motion.div
                      animate={isCurrentMain ? { scale: [1, 1.2, 1] } : { scale: 1 }}
                      transition={{ duration: 2, repeat: isCurrentMain ? Infinity : 0 }}
                    >
                      {stage.icon}
                    </motion.div>
                  )}
                </motion.div>

                {/* Stage Label */}
                <motion.div
                  initial={false}
                  animate={{
                    color: isDone ? 'rgb(34, 197, 94)' : isCurrentMain ? 'rgb(59, 130, 246)' : 'rgb(107, 114, 128)'
                  }}
                  transition={{ duration: 0.3 }}
                  className="mt-3 text-center"
                >
                  <p className="text-[11px] font-bold uppercase tracking-wider">{stage.label}</p>
                </motion.div>
              </div>
            );
          })}
        </div>

        {/* Overall Progress Bar */}
        <div className="h-1.5 bg-gray-800/50 rounded-full overflow-hidden border border-gray-700/50">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${progressPercent}%` }}
            transition={{ duration: 0.6, ease: 'easeInOut' }}
            className="h-full bg-gradient-to-r from-blue-500 via-green-500 to-green-400 rounded-full"
            style={{
              boxShadow: '0 0 8px rgba(34, 197, 94, 0.25)'
            }}
          />
        </div>
      </div>

      {/* Status Message */}
      <div className="flex items-center justify-between pt-2 border-t border-gray-800/50">
        <span className="text-xs text-gray-500">
          {isReceiver ? 'Receiving & Processing' : 'Sending & Processing'}
        </span>
        <motion.span
          animate={{ opacity: [0.5, 1, 0.5] }}
          transition={{ duration: 2, repeat: Infinity }}
          className="text-xs text-blue-400 font-mono"
        >
          ● Live
        </motion.span>
      </div>
    </div>
  );
};
