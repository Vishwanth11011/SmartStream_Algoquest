import os
import math
import zlib
import zstandard as zstd # pip install zstandard
import brotli # pip install brotli
import numpy as np
from sklearn.ensemble import RandomForestClassifier
from skl2onnx import convert_sklearn
from skl2onnx.common.data_types import FloatTensorType

DATASET_DIR = "./dataset"

def get_entropy(data):
    if not data: return 0
    entropy = 0
    for x in range(256):
        p_x = float(data.count(x))/len(data)
        if p_x > 0: entropy += - p_x * math.log(p_x, 2)
    return entropy

def get_best_algo(filepath):
    with open(filepath, 'rb') as f:
        data = f.read() # Read full file for Ground Truth
        
    original_size = len(data)
    if original_size == 0: return 2 # None

    # 1. Try Brotli (Best for Text)
    try:
        brotli_size = len(brotli.compress(data))
    except: brotli_size = original_size

    # 2. Try Zstd (Best Balance)
    cctx = zstd.ZstdCompressor(level=3)
    zstd_size = len(cctx.compress(data))

    # 3. Compare Ratios
    # If compression saves less than 5%, don't bother (waste of CPU)
    min_size = min(brotli_size, zstd_size)
    if min_size > original_size * 0.95:
        return 2 # Class 2: None (Don't compress)

    if brotli_size < zstd_size * 0.98: # If Brotli is significantly better (2%)
        return 0 # Class 0: Brotli
    else:
        return 1 # Class 1: Zstd

# --- MAIN LOOP ---
features = []
labels = []

print("🚀 Scanning Dataset...")

for filename in os.listdir(DATASET_DIR):
    path = os.path.join(DATASET_DIR, filename)
    if not os.path.isfile(path): continue

    # 1. EXTRACT FEATURES (The "Inputs")
    # We simulate the Client-Side logic: Read 3 chunks
    file_size = os.path.getsize(path)
    with open(path, 'rb') as f:
        # Read Header, Middle, Tail (16KB each)
        chunks = []
        chunks.append(f.read(16384))
        f.seek(max(0, file_size // 2))
        chunks.append(f.read(16384))
        f.seek(max(0, file_size - 16384))
        chunks.append(f.read(16384))
        
        # Combine entropies
        entropies = [get_entropy(c) for c in chunks]
        avg_entropy = sum(entropies) / len(entropies)
        
        # Hint Feature
        ext = filename.split('.')[-1].lower()
        hint = 0
        if ext in ['txt', 'csv', 'js', 'md']: hint = 1
        if ext in ['jpg', 'mp4', 'zip']: hint = 2

        features.append([avg_entropy, math.log10(file_size + 1), hint])

    # 2. DETERMINE GROUND TRUTH (The "Correct Answer")
    best_algo = get_best_algo(path)
    labels.append(best_algo)
    
    algo_name = ["Brotli", "Zstd", "None"][best_algo]
    print(f"File: {filename} | Entropy: {avg_entropy:.2f} | Winner: {algo_name}")

# --- TRAIN & EXPORT ---
print("🧠 Training AI...")
clf = RandomForestClassifier(n_estimators=20, max_depth=5)
clf.fit(features, labels)

initial_type = [('float_input', FloatTensorType([None, 3]))]
onnx_model = convert_sklearn(clf, initial_types=initial_type)

with open("model.onnx", "wb") as f:
    f.write(onnx_model.SerializeToString())

print("✅ Real-World Model Saved to model.onnx")