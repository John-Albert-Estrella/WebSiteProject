import { db } from "./firebase-init.js";
import { initAuthGuard } from "./auth-guard.js";
import { 
  collection, 
  query, 
  where, 
  getDocs, 
  doc, 
  updateDoc, 
  serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

const portfolioTbody = document.getElementById("portfolio-tbody");
const tableCardHeading = document.getElementById("table-card-heading");
const tableCardSubheading = document.getElementById("table-card-subheading");
const gradePanel = document.getElementById("grade-panel");
const gradePanelTitle = document.getElementById("grade-panel-title");
const gradeSubmissionId = document.getElementById("grade-submission-id");
const gradeScore = document.getElementById("grade-score");
const gradeStatus = document.getElementById("grade-status");
const gradeFeedback = document.getElementById("grade-feedback");
const formGrade = document.getElementById("form-grade-submission");
const btnCancelGrade = document.getElementById("btn-cancel-grade");

let activeRole = "student";
let activeUser = null;

btnCancelGrade?.addEventListener("click", () => {
  if (gradePanel) gradePanel.style.display = "none";
  if (formGrade) formGrade.reset();
});

formGrade?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const subId = gradeSubmissionId.value;
  if (!subId) return;

  const btn = document.getElementById("btn-save-grade");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Saving...";
  }

  try {
    await updateDoc(doc(db, "submissions", subId), {
      grade: Number(gradeScore.value),
      status: gradeStatus.value,
      feedback: gradeFeedback.value.trim(),
      gradedAt: serverTimestamp(),
      gradedBy: activeUser.email
    });

    alert("Evaluation submitted successfully!");
    if (gradePanel) gradePanel.style.display = "none";
    if (formGrade) formGrade.reset();
    loadSubmissions();
  } catch (err) {
    console.error("Grading failed:", err);
    alert("Could not save grade: " + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Submit Grade & Feedback";
    }
  }
});

async function loadSubmissions() {
  if (!portfolioTbody) return;

  try {
    let q;
    if (activeRole === "faculty") {
      tableCardHeading.textContent = "Cohort Submissions (Faculty Review)";
      tableCardSubheading.textContent = "Review all case outputs and assign student appraisal grades.";
      q = query(collection(db, "submissions"));
    } else {
      tableCardHeading.textContent = "My Verified Deliverables";
      tableCardSubheading.textContent = "Track grading progress and instructor feedback.";
      q = query(collection(db, "submissions"), where("studentUid", "==", activeUser.uid));
    }

    const snap = await getDocs(q);

    if (snap.empty) {
      portfolioTbody.innerHTML = `
        <tr>
          <td colspan="6" class="empty-state">No deliverable outputs recorded in database.</td>
        </tr>
      `;
      return;
    }

    let rowsHtml = "";
    snap.forEach((docSnap) => {
      const data = docSnap.data();
      const id = docSnap.id;
      const caseTitle = escapeHtml(data.caseTitle || data.caseId || "HR Case");
      const studentName = escapeHtml(data.studentName || data.studentEmail || "Student");
      const fileName = escapeHtml(data.fileName || "Download");
      const submittedDate = data.createdAt ? data.createdAt.toDate().toLocaleDateString() : "Recent";
      
      let statusBadge = `<span class="status-badge">Pending Review</span>`;
      if (data.status === "Approved") {
        statusBadge = `<span class="status-badge" style="background: var(--success-bg); color: var(--success);">Grade: ${data.grade}/100</span>`;
      } else if (data.status) {
        statusBadge = `<span class="status-badge" style="background: rgba(245, 158, 11, 0.15); color: #f59e0b;">${escapeHtml(data.status)}</span>`;
      }

      let actionCell = "";
      if (activeRole === "faculty") {
        actionCell = `
          <button type="button" class="btn btn-primary btn-grade" 
            data-id="${id}" 
            data-title="${caseTitle}" 
            data-student="${studentName}"
            data-grade="${data.grade || ""}"
            data-status="${data.status || "Approved"}"
            data-feedback="${escapeHtml(data.feedback || "")}"
            style="padding: 4px 12px; font-size: 12px;">
            Grade Output
          </button>
        `;
      } else {
        actionCell = data.feedback ? `<span style="font-size: 12px; color: var(--text-secondary);">${escapeHtml(data.feedback)}</span>` : `<span style="font-size: 12px; color: var(--text-tertiary);">Awaiting review</span>`;
      }

      rowsHtml += `
        <tr>
          <td style="font-weight: 600;">${caseTitle}</td>
          <td>${studentName}</td>
          <td>
            <a href="${data.fileUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary" style="padding: 4px 10px; font-size: 12px;">
              📄 ${fileName} ↗
            </a>
          </td>
          <td style="color: var(--text-tertiary);">${submittedDate}</td>
          <td>${statusBadge}</td>
          <td>${actionCell}</td>
        </tr>
      `;
    });

    portfolioTbody.innerHTML = rowsHtml;

    // Attach listeners to Grade buttons
    document.querySelectorAll(".btn-grade").forEach(btn => {
      btn.addEventListener("click", () => {
        gradeSubmissionId.value = btn.dataset.id;
        gradePanelTitle.textContent = `Grade: ${btn.dataset.title} (${btn.dataset.student})`;
        gradeScore.value = btn.dataset.grade || "";
        gradeStatus.value = btn.dataset.status || "Approved";
        gradeFeedback.value = btn.dataset.feedback || "";
        if (gradePanel) {
          gradePanel.style.display = "block";
          gradePanel.scrollIntoView({ behavior: "smooth" });
        }
      });
    });

  } catch (err) {
    console.error("Error loading deliverables:", err);
  }
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, s => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[s]));
}

initAuthGuard({
  onReady: ({ user, userData, role }) => {
    activeRole = role;
    activeUser = user;
    loadSubmissions();
  }
});