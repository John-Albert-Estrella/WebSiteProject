// js/cloudinary-config.js - Universal Document (PDF, DOC, DOCX, XLSX, PPTX) & Image Upload Engine
export const CLOUDINARY_CLOUD_NAME = "dvh6g7k2m";
export const CLOUDINARY_UPLOAD_PRESET = "Aimser_Avatars";

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

  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
  formData.append("folder", folder);

  // /auto/upload accepts PDFs, Word docs, spreadsheets, archives, and images
  const endpoint = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/auto/upload`;

  const response = await fetch(endpoint, {
    method: "POST",
    body: formData
  });

  const data = await response.json();
  if (!response.ok || !data.secure_url) {
    throw new Error(data.error?.message || "Document upload failed. Please try again.");
  }

  return data.secure_url;
}

export default uploadToCloudinary;