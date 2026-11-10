// js/cloudinary-config.js - Cloudinary Client-Side Upload Engine

const CLOUDINARY_CLOUD_NAME = "zcoo0jvg";
const CLOUDINARY_UPLOAD_PRESET = "Aimser_Avatars";

/**
 * Uploads a file to Cloudinary using an unsigned preset.
 * @param {File} file - The file binary to upload.
 * @param {string} customFolder - Target folder in Cloudinary.
 * @returns {Promise<string>} The secure HTTPS URL returned by Cloudinary.
 */
export async function uploadToCloudinary(file, customFolder = "aimser/avatars") {
  if (!file) {
    throw new Error("No file selected.");
  }

  // Client-side guard: 5MB limit
  const maxBytes = 5 * 1024 * 1024;
  if (file.size > maxBytes) {
    throw new Error("File size exceeds 5MB limit.");
  }

  const endpoint = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/upload`;
  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
  formData.append("folder", customFolder);

  console.log(`[Cloudinary] Uploading ${file.name} to ${endpoint}...`);

  const response = await fetch(endpoint, {
    method: "POST",
    body: formData
  });

  const data = await response.json();

  if (!response.ok) {
    console.error("[Cloudinary Error Payload]", data);
    throw new Error(data.error?.message || "Failed to upload image to Cloudinary.");
  }

  console.log("[Cloudinary Success] Asset URL:", data.secure_url);
  return data.secure_url;
}