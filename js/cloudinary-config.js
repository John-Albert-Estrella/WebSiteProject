// js/cloudinary-config.js - Universal Document (PDF, DOC, DOCX, XLSX, PPTX) & Image Upload Engine
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
  "png",
  "jpg",
  "jpeg",
  "webp"
];

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Failed to read the selected file."));
    reader.readAsDataURL(file);
  });
}

async function tryCloudinaryPreset(file, folder, presetName) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", presetName);
  formData.append("folder", folder);

  // /auto/upload handles PDFs, Word (.doc/.docx), Excel, PowerPoint, and Images automatically
  const endpoint = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/auto/upload`;
  const response = await fetch(endpoint, {
    method: "POST",
    body: formData
  });

  const data = await response.json();
  if (response.ok && data && data.secure_url) {
    return data.secure_url;
  }
  throw new Error(data?.error?.message || `Upload with preset ${presetName} failed.`);
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

  const maxBytes = 20 * 1024 * 1024;
  if (file.size > maxBytes) {
    throw new Error("File size exceeds the 20 MB maximum upload limit.");
  }

  // Use Aimser_Avatars for profile photos, and aimser_uploads for documents/submissions
  const isAvatar = folder.includes("avatar");
  const primaryPreset = isAvatar ? CLOUDINARY_AVATAR_PRESET : CLOUDINARY_UPLOAD_PRESET;
  const secondaryPreset = isAvatar ? CLOUDINARY_UPLOAD_PRESET : CLOUDINARY_AVATAR_PRESET;

  // 1. Try primary unsigned preset on cloud "zcco0jvg"
  try {
    return await tryCloudinaryPreset(file, folder, primaryPreset);
  } catch (primaryErr) {
    console.warn(`[Cloudinary] Primary preset (${primaryPreset}) notice:`, primaryErr.message);
  }

  // 2. Try secondary unsigned preset on cloud "zcco0jvg"
  try {
    return await tryCloudinaryPreset(file, folder, secondaryPreset);
  } catch (secondaryErr) {
    console.warn(`[Cloudinary] Secondary preset (${secondaryPreset}) notice:`, secondaryErr.message);
  }

  // 3. Final safety fallback: encode directly if file <= 750 KB so submission still succeeds
  if (file.size <= 750 * 1024) {
    return await fileToDataUrl(file);
  }

  throw new Error("Document upload failed. Please check your internet connection or try a smaller file.");
}

export default uploadToCloudinary;