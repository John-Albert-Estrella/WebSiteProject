// js/cloudinary-config.js

// Replace these two strings with your Cloudinary values from Step 1
export const CLOUDINARY_CLOUD_NAME = "YOUR_CLOUD_NAME"; 
export const CLOUDINARY_UPLOAD_PRESET = "aimser_uploads"; 

/**
 * Uploads a file directly to Cloudinary via their REST API
 * @param {File} file - The file selected from an <input type="file">
 * @returns {Promise<string>} - Resolves with the direct HTTPS file URL
 */
export async function uploadToCloudinary(file) {
  if (!file) return null;

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
    throw new Error(errorData.error?.message || "Cloudinary upload failed");
  }

  const data = await response.json();
  return data.secure_url;
}