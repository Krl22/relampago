// Encryption key is provisioned as an Edge secret, never a VITE_* variable.
const encoder = new TextEncoder();
const toBase64 = (data: Uint8Array) => btoa(String.fromCharCode(...data));
const fromBase64 = (data: string) => Uint8Array.from(atob(data), c => c.charCodeAt(0));

async function importKey(master: string) {
  const bytes = fromBase64(master);
  if (bytes.length !== 32) throw new Error("Invalid encryption configuration");
  return await crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptKey(secret: string, owner: string, provider: string, master: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv,
    additionalData: encoder.encode(`v1:${owner}:${provider}`) }, await importKey(master), encoder.encode(secret));
  return `v1.${toBase64(iv)}.${toBase64(new Uint8Array(encrypted))}`;
}

export async function decryptKey(envelope: string, owner: string, provider: string, master: string) {
  const [version, iv, ciphertext, extra] = envelope.split(".");
  if (version !== "v1" || !iv || !ciphertext || extra) throw new Error("Invalid encryption envelope");
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(iv),
    additionalData: encoder.encode(`v1:${owner}:${provider}`) }, await importKey(master), fromBase64(ciphertext));
  return new TextDecoder().decode(decrypted);
}
