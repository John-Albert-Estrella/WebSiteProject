/**
 * Cloudinary Unsigned Upload Configuration
 * Cloud Name: zcoo0jvg
 * Upload Preset: aimser_uploads
 */

export async function uploadToCloudinary(file) {
  if (!file) {
    throw new Error("No file selected.");
  }

  // 1. File Size Gate: Max 10MB
  const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10,485,760 bytes
  if (file.size > MAX_FILE_SIZE) {
    throw new Error(`File is too large (${(file.size / (1024 * 1024)).toFixed(1)}MB). Maximum allowed upload size is 10MB.`);
  }

  // 2. MIME & Extension Gate: Allowed PDF, Word, and common image formats
  const ALLOWED_MIME_TYPES = [
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/webp"
  ];

  const fileExtension = file.name.split(".").pop().toLowerCase();
  const ALLOWED_EXTENSIONS = ["pdf", "doc", "docx", "png", "jpg", "jpeg", "webp"];

  if (!ALLOWED_MIME_TYPES.includes(file.type) && !ALLOWED_EXTENSIONS.includes(fileExtension)) {
    throw new Error("Invalid file format. Only PDF, Word (.doc, .docx), and Image (.png, .jpg) files are allowed.");
  }

  // 3. Cloudinary Upload Dispatch
  const CLOUD_NAME = "zcoo0jvg";
  const UPLOAD_PRESET = "aimser_uploads";
  const url = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/upload`;

  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", UPLOAD_PRESET);

  const response = await fetch(url, {
    method: "POST",
    body: formData
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error?.message || "Failed to upload file to Cloudinary cloud storage.");
  }

  const result = await response.json();
  return result.secure_url;
}