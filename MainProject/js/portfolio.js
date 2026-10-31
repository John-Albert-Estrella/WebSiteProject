import { auth, db } from "./firebase-init.js";
import { enforceAuth } from "./auth-guard.js";
import { uploadToCloudinary } from "./cloudinary-config.js";
import { 
  collection, 
  addDoc, 
  updateDoc, 
  doc, 
  getDoc, 
  onSnapshot, 
  serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

enforceAuth(["student", "faculty", "admin"]);

const container = document.getElementById("portfolio-container");
const btnOpenUpload = document.getElementById("btn-upload-work");
const uploadModal = document.getElementById("portfolio-modal");
const btnCancel = document.getElementById("btn-cancel-portfolio");
const btnSave = document.getElementById("btn-save-portfolio");

const titleInput = document.getElementById("portfolio-title-input");
const notesInput = document.getElementById("portfolio-notes-input");
const fileInput = document.getElementById("portfolio-file-input");

document.addEventListener("DOMContentLoaded", () => {
  auth.onAuthStateChanged(async (user) => {
    if (!user) return;

    const userSnap = await getDoc(doc(db, "users", user.uid));
    if (!userSnap.exists()) return;

    const userData = userSnap.data();
    const isFaculty = userData.role === "faculty" || userData.role === "admin";

    // Setup student modal controls
    if (!isFaculty && btnOpenUpload) {
      btnOpenUpload.style.display = "inline-flex";

      btnOpenUpload.addEventListener("click", () => {
        uploadModal.style.display = "block";
      });

      if (btnCancel) {
        btnCancel.addEventListener("click", () => {
          uploadModal.style.display = "none";
        });
      }

      if (btnSave) {
        btnSave.addEventListener("click", async () => {
          const title = titleInput.value.trim();
          const notes = notesInput.value.trim();
          const file = fileInput.files[0];

          if (!title) {
            alert("Please provide an assignment title.");
            return;
          }

          btnSave.disabled = true;
          btnSave.textContent = "Uploading to Cloudinary...";

          try {
            let fileUrl = null;
            let fileName = null;

            if (file) {
              fileName = file.name;
              fileUrl = await uploadToCloudinary(file);
            }

            await addDoc(collection(db, "portfolio"), {
              studentUid: user.uid,
              studentName: `${userData.firstName} ${userData.lastName}`,
              title: title,
              notes: notes,
              fileUrl: fileUrl,
              fileName: fileName,
              status: "pending",
              score: null,
              feedback: "",
              createdAt: serverTimestamp()
            });

            uploadModal.style.display = "none";
            titleInput.value = "";
            notesInput.value = "";
            fileInput.value = "";
            alert("Deliverable uploaded successfully!");
          } catch (err) {
            console.error("Deliverable upload error:", err);
            alert("Upload failed: " + err.message);
          } finally {
            btnSave.disabled = false;
            btnSave.textContent = "Submit for Grading";
          }
        });
      }
    }

    // Real-time synchronization for Portfolio Deliverables
    onSnapshot(collection(db, "portfolio"), (snapshot) => {
      if (!container) return;
      container.innerHTML = "";

      if (snapshot.empty) {
        container.innerHTML = `<p style="color: var(--text-secondary);">No portfolio deliverables found.</p>`;
        return;
      }

      snapshot.forEach((itemSnap) => {
        const item = itemSnap.data();
        const id = itemSnap.id;

        // Filter: Students view their own work; Faculty view all submissions
        if (!isFaculty && item.studentUid !== user.uid) return;

        const card = document.createElement("div");
        card.className = "portfolio-card";

        if (isFaculty && item.status === "pending") {
          card.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <h4 style="margin: 0;">${item.title}</h4>
              <span class="status-badge status-pending">Needs Grading</span>
            </div>
            <p style="font-size: 12.5px; color: var(--text-secondary);">Submitted by: <strong>${item.studentName}</strong></p>
            <div style="background: var(--bg-app); padding: 12px; border-radius: 6px; font-size: 13px;">${item.notes || "No notes provided."}</div>
            
            ${item.fileUrl ? `<a href="${item.fileUrl}" target="_blank" class="btn btn-outline" style="font-size: 12px; padding: 6px 12px; margin-top: 8px; width: fit-content;">📄 View Submitted File (${item.fileName || "Download"})</a>` : ''}

            <div class="grade-input-group" style="margin-top: 10px;">
              <input type="number" id="grade-val-${id}" class="form-control" placeholder="0" min="0" max="100">
              <span style="font-weight: 700;">/ 100</span>
            </div>
            <textarea id="grade-feedback-${id}" class="form-control" placeholder="Enter constructive rubric feedback..."></textarea>
            <button class="btn btn-primary" id="btn-submit-grade-${id}">Submit Grade & Rubric Feedback</button>
          `;

          card.querySelector(`#btn-submit-grade-${id}`).addEventListener("click", async () => {
            const score = document.getElementById(`grade-val-${id}`).value;
            const feedback = document.getElementById(`grade-feedback-${id}`).value.trim();

            if (!score) return alert("Please enter a numeric score.");

            await updateDoc(doc(db, "portfolio", id), {
              status: "graded",
              score: parseInt(score, 10),
              feedback: feedback || "Completed satisfactorily.",
              gradedAt: serverTimestamp()
            });
            alert("Appraisal recorded!");
          });
        } else {
          card.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <h4 style="margin: 0;">${item.title}</h4>
              <span class="status-badge ${item.status === 'graded' ? 'status-graded' : 'status-pending'}">
                ${item.status === 'graded' ? `Score: ${item.score}/100` : 'Pending Review'}
              </span>
            </div>
            <p style="font-size: 12.5px; color: var(--text-secondary);">Student: ${item.studentName}</p>
            <div style="background: var(--bg-app); padding: 12px; border-radius: 6px; font-size: 13px;">${item.notes || "No notes provided."}</div>
            
            ${item.fileUrl ? `<a href="${item.fileUrl}" target="_blank" class="btn btn-outline" style="font-size: 12px; padding: 6px 12px; margin-top: 6px; width: fit-content;">Download Submitted Work</a>` : ''}
            
            ${item.status === 'graded' ? `<div class="feedback-box" style="margin-top: 10px;"><strong>Feedback:</strong> "${item.feedback}"</div>` : ''}
          `;
        }

        container.appendChild(card);
      });
    });
  });
});