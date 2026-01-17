import numpy as np
from sklearn.ensemble import RandomForestClassifier
from skl2onnx import convert_sklearn
from skl2onnx.common.data_types import FloatTensorType
import onnx

# 1. Generate Synthetic Data
# Features: [Entropy (0-8), FileSize (MB), Is_Binary (0/1)]
# Labels: 0 = Brotli (Text), 1 = Zstd (Data), 2 = NoCompression (Images/Zip)

X = [
    [2.5, 0.5, 0], [3.1, 2.0, 0], # Low entropy, Text -> Brotli
    [5.5, 10.0, 1], [6.2, 5.0, 1], # Med entropy, Binary -> Zstd
    [7.9, 50.0, 1], [7.95, 100.0, 1] # High entropy, Compressed -> None
]
y = [0, 0, 1, 1, 2, 2]

# 2. Train Model
clf = RandomForestClassifier(n_estimators=10)
clf.fit(X, y)

# 3. Convert to ONNX
# We define the input type as a float tensor of shape [1, 3] (1 row, 3 features)
initial_type = [('float_input', FloatTensorType([None, 3]))]
onnx_model = convert_sklearn(clf, initial_types=initial_type)

# 4. Save
with open("model.onnx", "wb") as f:
    f.write(onnx_model.SerializeToString())

print("✅ Model saved as model.onnx")