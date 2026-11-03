import { auth, db } from "./firebase-init.js";
import { uploadToCloudinary } from "./cloudinary-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { 
  doc, 
  getDoc, 
  collection, 
  addDoc, 
  query, 
  where, 
  getDocs, 
  serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

const studentSidebarName = document.getElementById("student-sidebar-name");
const topbarStudentName = document.getElementById("topbar-student-name");
const uploadPanel = document.getElementById("upload-panel");
const uploadPanelTitle = document.getElementById("upload-panel-title");
const uploadCaseId = document.getElementById("upload-case-id");
const fileInput = document.getElementById("file-input");
const notesInput = document.getElementById("notes-input");
const formUpload = document.getElementById("form-upload-deliverable");
const btnSubmitFile = document.getElementById("btn-submit-file");
const btnCloseUpload = document.getElementById("btn-close-upload");
const submissionsTbody = document.getElementById("submissions-tbody");
const btnLogout = document.getElementById("btn-logout");

let currentStudent = null;

// Logout
btnLogout?.addEventListener("click", async () => {
  try {
    await signOut(auth);
    window.location.replace("login.html");
  } catch (err) {
    console.error("Logout error:", err);
  }
});

// Setup Upload Buttons on Cards
document.querySelectorAll(".btn-open-upload").forEach(btn => {
  btn.addEventListener("click", () => {
    const caseId = btn.dataset.caseId;
    const caseTitle = btn.dataset.caseTitle;
    
    if (uploadCaseId) uploadCaseId.value = caseId;
    if (uploadPanelTitle) uploadPanelTitle.textContent = `Submit Deliverable: ${caseTitle}`;
    if (uploadPanel) {
      uploadPanel.style.display = "block";
      uploadPanel.scrollIntoView({ behavior: "smooth" });
    }
  });
});

// Cancel Upload
btnCloseUpload?.addEventListener("click", () => {
  if (uploadPanel) uploadPanel.style.display = "none";
  if (formUpload) formUpload.reset();
});

// Load Submissions History
async function loadSubmissions(uid) {
  if (!submissionsTbody) return;

  try {
    const q = query(collection(db, "submissions"), where("studentUid", "==", uid));
    const snap = await getDocs(q);

    if (snap.empty) {
      submissionsTbody.innerHTML = `
        <tr>
          <td colspan="4" class="empty-state">No deliverables submitted yet.</td>
        </tr>
      `;
      return;
    }

    let rowsHtml = "";
    snap.forEach(docSnap => {
      const data = docSnap.data();
      const submittedAt = data.createdAt ? data.createdAt.toDate().toLocaleDateString() : "Recent";
      rowsHtml += `
        <tr>
          <td style="font-weight: 600;">${escapeHtml(data.caseTitle || data.caseId)}</td>
          <td style="color: var(--text-secondary);">${escapeHtml(data.fileName || "File")}</td>
          <td style="color: var(--text-tertiary);">${submittedAt}</td>
          <td>
            <a href="${data.fileUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary" style="padding: 4px 10px; font-size: 12px;">
              View File ↗
            </a>
          </td>
        </tr>
      `;
    });

    submissionsTbody.innerHTML = rowsHtml;
  } catch (err) {
    console.error("Error loading submissions:", err);
  }
}

// Upload & Submit Handler
formUpload?.addEventListener("submit", async (e) => {
  e.preventDefault();

  const file = fileInput?.files[0];
  if (!file) {
    alert("Please select a file to upload.");
    return;
  }

  const caseId = uploadCaseId?.value || "UNKNOWN";
  const notes = notesInput?.value.trim() || "";

  if (btnSubmitFile) {
    btnSubmitFile.disabled = true;
    btnSubmitFile.textContent = "Uploading to Cloudinary...";
  }

  try {
    // 1. Upload directly to Cloudinary (using unsigned preset)
    const fileUrl = await uploadToCloudinary(file);

    if (btnSubmitFile) btnSubmitFile.textContent = "Saving submission...";

    // 2. Save submission record in Firestore
    await addDoc(collection(db, "submissions"), {
      studentUid: currentStudent.uid,
      studentName: currentStudent.name,
      studentEmail: currentStudent.email,
      classroomCode: currentStudent.classroomCode || "",
      caseId: caseId,
      caseTitle: uploadPanelTitle?.textContent.replace("Submit Deliverable: ", "") || caseId,
      fileName: file.name,
      fileUrl: fileUrl,
      notes: notes,
      createdAt: serverTimestamp()
    });

    alert("Deliverable uploaded and submitted successfully!");
    if (formUpload) formUpload.reset();
    if (uploadPanel) uploadPanel.style.display = "none";
    loadSubmissions(currentStudent.uid);

  } catch (err) {
    console.error("Submission failed:", err);
    alert("Upload failed: " + err.message);
  } finally {
    if (btnSubmitFile) {
      btnSubmitFile.disabled = false;
      btnSubmitFile.textContent = "Upload to Cloudinary & Submit";
    }
  }
});

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, s => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[s]));
}

// Auth Guard
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.replace("login.html");
    return;
  }

  try {
    const userDocRef = doc(db, "users", user.uid);
    const snap = await getDoc(userDocRef);

    if (snap.exists()) {
      const data = snap.data();
      const fullName = `${data.firstName || ""} ${data.lastName || ""}`.trim() || "Student";
      
      currentStudent = {
        uid: user.uid,
        name: fullName,
        email: data.email || user.email,
        classroomCode: data.classroomCode || ""
      };

      if (studentSidebarName) studentSidebarName.textContent = fullName;
      if (topbarStudentName) topbarStudentName.textContent = fullName;

      loadSubmissions(user.uid);
    }
  } catch (e) {
    console.error("Profile load error:", e);
  }
});