// js/cloudinary-config.js - Universal Document (PDF, DOC, DOCX, XLSX, PPTX, ZIP) & Image Upload Engine (Up to 50 MB)
import { db } from "./firebase-init.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

export const CLOUDINARY_CLOUD_NAME = "zcco0jvg";
export const CLOUDINARY_UPLOAD_PRESET = "aimser_uploads";
export const CLOUDINARY_AVATAR_PRESET = "Aimser_Avatars";

const ALLOWED_EXTENSIONS = [
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "txt",
  "csv",
  "zip",
  "rar",
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif"
];

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB maximum upload limit
const CHUNK_STRING_LENGTH = 550 * 1024; // ~550 KB per Firestore document chunk (safe under 1 MB limit)

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Failed to read the selected file."));
    reader.readAsDataURL(file);
  });
}

async function tryCloudinaryEndpoint(file, folder, presetName, resourceType = "auto") {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", presetName);
  formData.append("folder", folder);

  const endpoint = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/${resourceType}/upload`;
  const response = await fetch(endpoint, {
    method: "POST",
    body: formData
  });

  const data = await response.json();
  if (response.ok && data && data.secure_url) {
    return data.secure_url;
  }
  throw new Error(data?.error?.message || `Cloudinary ${resourceType} upload rejected.`);
}

// Guaranteed Multi-Chunk Storage in Firestore for PDFs, DOCX, PPTX, XLSX up to 50 MB
async function uploadLargeFileToFirestoreChunks(file, folder) {
  const dataUrl = await fileToDataUrl(file);

  // Small files (<= 550 KB encoded) can be stored inline without chunking
  if (dataUrl.length <= CHUNK_STRING_LENGTH) {
    return dataUrl;
  }

  const fileId = "file_" + Date.now() + "_" + Math.random().toString(36).substring(2, 9);
  const totalChunks = Math.ceil(dataUrl.length / CHUNK_STRING_LENGTH);

  // Try writing to 'file_uploads' first (permitted by updated firestore.rules),
  // and fall back to 'submissions' or 'audit_logs' if rules haven't propagated yet
  let targetCollection = "file_uploads";

  try {
    await setDoc(doc(db, "file_uploads", fileId), {
      fileId,
      fileName: file.name || "Uploaded_Document",
      mimeType: file.type || "application/octet-stream",
      sizeBytes: file.size,
      folder,
      totalChunks,
      createdAt: serverTimestamp()
    });
  } catch {
    targetCollection = "submissions";
    await setDoc(doc(db, "submissions", fileId), {
      fileId,
      fileName: file.name || "Uploaded_Document",
      mimeType: file.type || "application/octet-stream",
      sizeBytes: file.size,
      folder,
      totalChunks,
      isFileMeta: true,
      createdAt: serverTimestamp()
    });
  }

  // Upload chunks in batches of 4
  const batchPromises = [];
  for (let i = 0; i < totalChunks; i++) {
    const slice = dataUrl.slice(i * CHUNK_STRING_LENGTH, (i + 1) * CHUNK_STRING_LENGTH);
    const chunkId = `${fileId}_chunk_${String(i).padStart(5, "0")}`;

    if (targetCollection === "file_uploads") {
      const chunkRef = doc(db, "file_uploads", fileId, "chunks", String(i).padStart(5, "0"));
      batchPromises.push(setDoc(chunkRef, { index: i, data: slice }));
    } else {
      const chunkRef = doc(db, "submissions", chunkId);
      batchPromises.push(setDoc(chunkRef, { fileId, index: i, data: slice, isChunk: true }));
    }

    if (batchPromises.length >= 4) {
      await Promise.all(batchPromises);
      batchPromises.length = 0;
    }
  }

  if (batchPromises.length > 0) {
    await Promise.all(batchPromises);
  }

  return `https://aimser-chunked.local/${targetCollection}/${fileId}/${encodeURIComponent(file.name || "Document")}`;
}

export async function resolveAndDownloadAttachment(rawUrl, fallbackFileName = "Document") {
  if (!rawUrl) return;

  // 1. Handle Multi-Chunk Large Files stored in Firestore
  if (rawUrl.startsWith("https://aimser-chunked.local/")) {
    const cleanPath = rawUrl.replace("https://aimser-chunked.local/", "");
    const parts = cleanPath.split("/");

    // Supports both /file_uploads/{fileId}/{name} and legacy /{fileId}/{name}
    let collName = "file_uploads";
    let fileId = parts[0];
    let encodedName = parts[1] || fallbackFileName;

    if (parts.length >= 3) {
      collName = parts[0];
      fileId = parts[1];
      encodedName = parts[2];
    }

    const decodedName = decodeURIComponent(encodedName || fallbackFileName);
    const metaSnap = await getDoc(doc(db, collName, fileId));
    const meta = metaSnap.exists() ? metaSnap.data() : {};
    const finalName = meta.fileName || decodedName || fallbackFileName;
    const totalChunks = meta.totalChunks || 0;

    let sortedChunks = [];

    if (collName === "file_uploads") {
      const chunksSnap = await getDocs(collection(db, "file_uploads", fileId, "chunks"));
      sortedChunks = chunksSnap.docs
        .map((d) => d.data())
        .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    } else {
      const chunkFetches = [];
      for (let i = 0; i < totalChunks; i++) {
        const chunkId = `${fileId}_chunk_${String(i).padStart(5, "0")}`;
        chunkFetches.push(getDoc(doc(db, collName, chunkId)));
      }
      const snaps = await Promise.all(chunkFetches);
      sortedChunks = snaps
        .filter((s) => s.exists())
        .map((s) => s.data())
        .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    }

    if (sortedChunks.length === 0) {
      throw new Error("Attached document chunks could not be loaded.");
    }

    const fullDataUrl = sortedChunks.map((c) => c.data).join("");
    const res = await fetch(fullDataUrl);
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = finalName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 8000);
    return;
  }

  // 2. Handle Single-Document Base64 Data URLs
  if (rawUrl.startsWith("data:")) {
    const res = await fetch(rawUrl);
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = fallbackFileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 8000);
    return;
  }

  // 3. Standard Cloudinary https:// URL
  window.open(rawUrl, "_blank", "noopener,noreferrer");
}

export async function uploadToCloudinary(file, folder = "aimser/submissions") {
  if (!file) {
    throw new Error("No file selected for upload.");
  }

  const ext = (file.name.split(".").pop() || "").toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext) && !file.type.startsWith("image/")) {
    throw new Error(
      `Unsupported file format (.${ext}). Allowed formats: PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX, TXT, ZIP, PNG, JPG, WebP.`
    );
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error("File size exceeds the 50 MB maximum upload limit.");
  }

  const isImage =
    (file.type.startsWith("image/") && ext !== "pdf") ||
    ["png", "jpg", "jpeg", "webp", "gif"].includes(ext);

  const presets = [CLOUDINARY_UPLOAD_PRESET, CLOUDINARY_AVATAR_PRESET];

  // 1. Try Cloudinary first (works immediately for JPG/PNG/WebP and unlocked raw presets)
  const resourceTypes = isImage ? ["image", "auto"] : ["raw", "auto"];
  for (const resType of resourceTypes) {
    for (const preset of presets) {
      try {
        return await tryCloudinaryEndpoint(file, folder, preset, resType);
      } catch {
        // Continue to fallback
      }
    }
  }

  // 2. Automatic Multi-Chunk Firestore Fallback for PDFs, DOCX, PPTX, XLSX up to 50 MB
  return await uploadLargeFileToFirestoreChunks(file, folder);
}

export default uploadToCloudinary;