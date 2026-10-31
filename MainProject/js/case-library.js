import { auth, db } from "./firebase-init.js";
import { enforceAuth } from "./auth-guard.js";
import { uploadToCloudinary } from "./cloudinary-config.js";
import { 
  collection, 
  addDoc, 
  getDoc, 
  doc, 
  onSnapshot, 
  serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

enforceAuth(["student", "faculty", "admin"]);

const facultyUploadCard = document.getElementById("faculty-upload-card");
const casesGrid = document.getElementById("cases-grid-container");
const caseTitle = document.getElementById("case-title-input");
const caseDesc = document.getElementById("case-desc-input");
const caseFileInput = document.getElementById("case-file-input");
const btnPublish = document.getElementById("btn-publish-case");

document.addEventListener("DOMContentLoaded", () => {
  auth.onAuthStateChanged(async (user) => {
    if (!user) return;

    const userDoc = await getDoc(doc(db, "users", user.uid));
    if (!userDoc.exists()) return;

    const userData = userDoc.data();
    const isFaculty = userData.role === "faculty" || userData.role === "admin";

    if (isFaculty && facultyUploadCard) {
      facultyUploadCard.style.display = "block";

      btnPublish.addEventListener("click", async () => {
        const title = caseTitle.value.trim();
        const desc = caseDesc.value.trim();
        const file = caseFileInput.files[0];

        if (!title || !desc) {
          alert("Please fill in both the case title and description.");
          return;
        }

        btnPublish.disabled = true;
        btnPublish.textContent = "Uploading to Cloudinary...";

        try {
          let downloadURL = null;
          let originalFileName = null;

          if (file) {
            originalFileName = file.name;
            downloadURL = await uploadToCloudinary(file);
          }

          await addDoc(collection(db, "cases"), {
            title: title,
            description: desc,
            fileUrl: downloadURL,
            fileName: originalFileName,
            author: `${userData.firstName} ${userData.lastName}`,
            facultyUid: user.uid,
            createdAt: serverTimestamp()
          });

          caseTitle.value = "";
          caseDesc.value = "";
          caseFileInput.value = "";
          alert("Case study published to the library!");
        } catch (err) {
          console.error("Case study upload error:", err);
          alert("Failed to publish case: " + err.message);
        } finally {
          btnPublish.disabled = false;
          btnPublish.textContent = "Upload & Publish Case";
        }
      });
    }

    // Stream available cases in real time
    onSnapshot(collection(db, "cases"), (snapshot) => {
      if (!casesGrid) return;
      casesGrid.innerHTML = "";

      if (snapshot.empty) {
        casesGrid.innerHTML = `<p style="color: var(--text-secondary);">No case studies available in the library yet.</p>`;
        return;
      }

      snapshot.forEach((snap) => {
        const item = snap.data();
        const card = document.createElement("div");
        card.className = "case-card";
        card.innerHTML = `
          <div style="font-size: 28px;">📄</div>
          <div class="case-title">${item.title}</div>
          <p style="font-size: 13.5px; color: var(--text-secondary); line-height: 1.5;">${item.description}</p>
          <div class="case-meta" style="margin: 8px 0;">Instructor: <strong>${item.author || "Faculty"}</strong></div>
          ${item.fileUrl 
            ? `<a href="${item.fileUrl}" target="_blank" class="btn btn-outline" style="text-align: center; margin-top: auto;">Download Material (${item.fileName || "File"})</a>` 
            : `<span style="font-size: 12px; color: var(--text-tertiary); margin-top: auto;">No attached document</span>`}
        `;
        casesGrid.appendChild(card);
      });
    });
  });
});