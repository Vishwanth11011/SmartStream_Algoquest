import os
import io
import zipfile
import requests
import math
import zstandard as zstd  # pip install zstandard
import brotli             # pip install brotli
import numpy as np
from sklearn.ensemble import RandomForestClassifier
from skl2onnx import convert_sklearn
from skl2onnx.common.data_types import FloatTensorType

# --- CONFIGURATION ---
DATASET_URL = "https://sun.aei.polsl.pl//~sdeor/corpus/silesia.zip"

# Dynamic Path Calculation (Fixes the FileNotFoundError)
# This gets the absolute path of the folder containing this script (ai-training)
script_dir = os.path.dirname(os.path.abspath(__file__))

# Navigate relative to the script: Up one level (..) -> client -> public -> model.onnx
DOWNLOAD_DIR = os.path.join(script_dir, "dataset", "silesia")
MODEL_PATH = os.path.join(script_dir, "..", "client", "public", "model.onnx")

def download_and_extract():
    if os.path.exists(DOWNLOAD_DIR):
        print(f"✅ Dataset already exists in {DOWNLOAD_DIR}")
        return

    print(f"⬇️ Downloading Silesia Corpus from {DATASET_URL}...")
    try:
        r = requests.get(DATASET_URL)
        z = zipfile.ZipFile(io.BytesIO(r.content))
        os.makedirs(DOWNLOAD_DIR, exist_ok=True)
        z.extractall(DOWNLOAD_DIR)
        print("✅ Download & Extraction Complete.")
    except Exception as e:
        print(f"❌ Error downloading: {e}")
        exit(1)

def generate_compressed_samples():
    """
    Silesia only has uncompressed files. 
    We must manually create 'fake' compressed files (like .zip, .mp4) 
    so the AI learns when to say 'None'.
    """
    print("📦 Generating 'Already Compressed' samples for balance...")
    extra_dir = os.path.join(DOWNLOAD_DIR, "synthetic_compressed")
    os.makedirs(extra_dir, exist_ok=True)

    for filename in os.listdir(DOWNLOAD_DIR):
        file_path = os.path.join(DOWNLOAD_DIR, filename)
        if os.path.isdir(file_path): continue

        # Create a Zstd version of this file (High Entropy)
        with open(file_path, 'rb') as f_in:
            data = f_in.read()
            cctx = zstd.ZstdCompressor(level=3)
            compressed_data = cctx.compress(data)
            
            # Save as a new file
            new_name = f"{filename}.zst"
            with open(os.path.join(extra_dir, new_name), 'wb') as f_out:
                f_out.write(compressed_data)

def calculate_entropy(data):
    if not data: return 0
    entropy = 0
    for x in range(256):
        p_x = float(data.count(x))/len(data)
        if p_x > 0: entropy += - p_x * math.log(p_x, 2)
    return entropy

def extract_features(file_path):
    """
    Mimics the Frontend Logic: 
    Reads 3 chunks (Start, Middle, End) to get Average Entropy.
    """
    file_size = os.path.getsize(file_path)
    CHUNK_SIZE = 16384 # 16KB

    with open(file_path, 'rb') as f:
        # 1. Read Start
        head = f.read(CHUNK_SIZE)
        # 2. Read Middle
        f.seek(max(0, file_size // 2))
        mid = f.read(CHUNK_SIZE)
        # 3. Read End
        f.seek(max(0, file_size - CHUNK_SIZE))
        tail = f.read(CHUNK_SIZE)
    
    # Calculate Average Entropy
    entropies = [calculate_entropy(c) for c in [head, mid, tail] if c]
    avg_entropy = sum(entropies) / len(entropies) if entropies else 0

    # Log Size
    size_log = math.log10(file_size + 1)

    # Type Hint (0=Generic, 1=Text, 2=Media/Compressed)
    # Since Silesia files have no extension, we guess based on filename
    name = os.path.basename(file_path).lower()
    hint = 0
    if name in ['dickens', 'samba', 'webster', 'xml']: hint = 1 # Text-like
    if name.endswith('.zst') or name in ['mr']: hint = 2 # Compressed/Image

    return [avg_entropy, size_log, hint]

def get_best_label(file_path):
    """
    The 'Ground Truth' - actually runs the race.
    """
    with open(file_path, 'rb') as f:
        data = f.read()
    
    original = len(data)
    if original == 0: return 2

    # Race: Brotli vs Zstd
    # (We use faster levels for training speed)
    try:
        brotli_size = len(brotli.compress(data, quality=4))
    except: brotli_size = original

    cctx = zstd.ZstdCompressor(level=3)
    zstd_size = len(cctx.compress(data))

    # Decision Logic
    # If we can't save at least 5%, don't bother (Class 2: None)
    if min(brotli_size, zstd_size) > original * 0.95:
        return 2 
    
    # If Brotli beats Zstd by > 2%, pick Brotli (Class 0)
    # Otherwise default to Zstd (Class 1) because it's faster
    if brotli_size < zstd_size * 0.98:
        return 0
    else:
        return 1

# --- MAIN EXECUTION ---
if __name__ == "__main__":
    # 1. Setup
    download_and_extract()
    generate_compressed_samples()

    X_features = []
    y_labels = []

    print("\n🚀 Scanning & Labeling Dataset...")
    
    # Scan Original Silesia Files
    for filename in os.listdir(DOWNLOAD_DIR):
        path = os.path.join(DOWNLOAD_DIR, filename)
        if os.path.isdir(path): continue
        
        feats = extract_features(path)
        label = get_best_label(path)
        
        X_features.append(feats)
        y_labels.append(label)
        print(f"📄 {filename[:10]}... | Ent: {feats[0]:.2f} | Label: {['Brotli','Zstd','None'][label]}")

    # Scan Synthetic Compressed Files
    synthetic_dir = os.path.join(DOWNLOAD_DIR, "synthetic_compressed")
    for filename in os.listdir(synthetic_dir):
        path = os.path.join(synthetic_dir, filename)
        
        feats = extract_features(path)
        label = get_best_label(path) # Should almost always be 2 (None)
        
        X_features.append(feats)
        y_labels.append(label)
        print(f"📦 {filename[:10]}... | Ent: {feats[0]:.2f} | Label: {['Brotli','Zstd','None'][label]}")

    # 2. Train
    print(f"\n🧠 Training on {len(X_features)} samples...")
    clf = RandomForestClassifier(n_estimators=50, max_depth=7, random_state=42)
    clf.fit(X_features, y_labels)
    
    accuracy = clf.score(X_features, y_labels)
    print(f"✅ Training Accuracy: {accuracy * 100:.2f}%")

    # 3. Export to ONNX
    print("💾 Exporting to ONNX...")
    initial_type = [('float_input', FloatTensorType([None, 3]))]
    onnx_model = convert_sklearn(clf, initial_types=initial_type)

    with open(MODEL_PATH, "wb") as f:
        f.write(onnx_model.SerializeToString())

    print(f"🎉 Success! Model saved to {MODEL_PATH}")
    print("👉 Now restart your Frontend to use the new Brain.")