export const generateKeyPair = async (): Promise<CryptoKeyPair> => {
  return await window.crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveKey", "deriveBits"]
  );
};

export const exportPublicKey = async (key: CryptoKey): Promise<JsonWebKey> => {
  return await window.crypto.subtle.exportKey("jwk", key);
};

export const importPublicKey = async (jwk: JsonWebKey): Promise<CryptoKey> => {
  return await window.crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDH", namedCurve: "P-256" },
    true,
    []
  );
};

export const deriveSharedKey = async (privateKey: CryptoKey, publicKey: CryptoKey): Promise<CryptoKey> => {
  return await window.crypto.subtle.deriveKey(
    { name: "ECDH", public: publicKey },
    privateKey,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
};

export const encryptChunk = async (key: CryptoKey, chunk: Uint8Array): Promise<Uint8Array> => {
  const iv = window.crypto.getRandomValues(new Uint8Array(12)); 
  
  const encrypted = await window.crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv },
    key,
    chunk 
  );

  const packageData = new Uint8Array(iv.length + encrypted.byteLength);
  packageData.set(iv);
  packageData.set(new Uint8Array(encrypted), iv.length);

  return packageData;
};

export const decryptChunk = async (key: CryptoKey, data: Uint8Array): Promise<ArrayBuffer> => {
  const iv = data.slice(0, 12);
  const ciphertext = data.slice(12);

  return await window.crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv },
    key,
    ciphertext
  );
};