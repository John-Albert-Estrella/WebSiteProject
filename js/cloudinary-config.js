// js/cloudinary-config.js
export const CLOUDINARY_CLOUD_NAME = "zcoo0jvg";
export const CLOUDINARY_UPLOAD_PRESET = "aimser_uploads";

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB limit
const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/png",
  "image/jpeg",
  "image/webp"
];

export async function uploadToCloudinary(file) {
  if (!file) throw new Error("No file selected.");

  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new Error(`File is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max limit is 10 MB.`);
  }

  if (!ALLOWED_MIME_TYPES.includes(file.type)) {
    throw new Error("Invalid format. Only PDF, Word (.doc/.docx), and PNG/JPG images are allowed.");
  }

  const endpoint = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/auto/upload`;
  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);

  const response = await fetch(endpoint, {
    method: "POST",
    body: formData
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error?.message || "Cloudinary upload failed.");
  }

  const data = await response.json();
  return data.secure_url;
}