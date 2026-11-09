export const CLOUDINARY_CLOUD_NAME = "dzx0v4g5n";
export const CLOUDINARY_UPLOAD_PRESET = "aimser_uploads";

export async function uploadToCloudinary(file) {
  if (!file) throw new Error("No file selected.");

  const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
  if (file.size > MAX_FILE_SIZE) {
    throw new Error(`File is too large (${(file.size / (1024 * 1024)).toFixed(1)}MB). Max upload size is 10MB.`);
  }

  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);

  const response = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/auto/upload`, {
    method: "POST",
    body: formData
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error?.message || "Cloudinary upload failed.");
  }

  const result = await response.json();
  return result.secure_url;
}