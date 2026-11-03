import { db } from "./firebase-init.js";
import { initAuthGuard } from "./auth-guard.js";
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  doc, 
  serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

const facultyActions = document.getElementById("faculty-actions");
const btnOpenJob = document.getElementById("btn-open-job-modal");
const btnCloseJob = document.getElementById("btn-close-job-modal");
const jobModal = document.getElementById("job-modal");
const formCreateJob = document.getElementById("form-create-job");

const btnOpenCandidate = document.getElementById("btn-open-candidate-modal");
const btnCloseCandidate = document.getElementById("btn-close-candidate-modal");
const candidateModal = document.getElementById("candidate-modal");
const formInjectCandidate = document.getElementById("form-inject-candidate");

const jobOrdersContainer = document.getElementById("job-orders-container");
const candidatesTbody = document.getElementById("candidates-tbody");

let activeRole = "student";
let activeClassCode = "";
let currentStudentUid = null;

// Modal Controls
btnOpenJob?.addEventListener("click", () => { if (jobModal) jobModal.style.display = "block"; });
btnCloseJob?.addEventListener("click", () => { if (jobModal) jobModal.style.display = "none"; });

btnOpenCandidate?.addEventListener("click", () => { if (candidateModal) candidateModal.style.display = "block"; });
btnCloseCandidate?.addEventListener("click", () => { if (candidateModal) candidateModal.style.display = "none"; });

// Create Job Order
formCreateJob?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = document.getElementById("job-title-input")?.value.trim();
  const dept = document.getElementById("job-dept-input")?.value.trim();
  const reqs = document.getElementById("job-reqs-input")?.value.trim();

  if (!title) return;

  try {
    await addDoc(collection(db, "job_orders"), {
      title,
      department: dept,
      requirements: reqs,
      classroomCode: activeClassCode || "GLOBAL",
      createdAt: serverTimestamp()
    });

    if (jobModal) jobModal.style.display = "none";
    if (formCreateJob) formCreateJob.reset();
  } catch (err) {
    console.error("Job order creation failed:", err);
    alert("Could not post job order: " + err.message);
  }
});

// Inject Candidate (Faculty Only)
formInjectCandidate?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = document.getElementById("cand-name-input")?.value.trim();
  const exp = document.getElementById("cand-exp-input")?.value.trim();
  const resume = document.getElementById("cand-resume-input")?.value.trim();

  if (!name) return;

  try {
    await addDoc(collection(db, "candidates"), {
      name,
      experienceYears: Number(exp) || 0,
      resumeSummary: resume,
      status: "Under Review",
      classroomCode: activeClassCode || "GLOBAL",
      createdAt: serverTimestamp()
    });

    if (candidateModal) candidateModal.style.display = "none";
    if (formInjectCandidate) formInjectCandidate.reset();
  } catch (err) {
    console.error("Candidate injection failed:", err);
    alert("Could not inject candidate: " + err.message);
  }
});

// Real-Time Listeners
function listenToRecruitment() {
  const jobQ = activeClassCode 
    ? query(collection(db, "job_orders"), where("classroomCode", "==", activeClassCode))
    : query(collection(db, "job_orders"));

  onSnapshot(jobQ, (snapshot) => {
    if (!jobOrdersContainer) return;
    if (snapshot.empty) {
      jobOrdersContainer.innerHTML = `<div class="empty-state"><p>No active requisitions published. Faculty can create job orders above.</p></div>`;
      return;
    }

    jobOrdersContainer.innerHTML = snapshot.docs.map(d => {
      const j = d.data();
      return `
        <div class="card" style="padding: 18px; gap: 8px;">
          <div style="display: flex; justify-content: space-between; align-items: flex-start;">
            <h4 style="font-size: 15px; font-weight: 700; color: var(--text-primary);">${escapeHtml(j.title)}</h4>
            <span class="status-badge active" style="font-size: 10px;">${escapeHtml(j.department || "Operations")}</span>
          </div>
          <p style="font-size: 13px; color: var(--text-secondary); line-height: 1.45;">${escapeHtml(j.requirements || "Standard HR qualifications apply.")}</p>
        </div>
      `;
    }).join("");
  });

  const candQ = activeClassCode 
    ? query(collection(db, "candidates"), where("classroomCode", "==", activeClassCode))
    : query(collection(db, "candidates"));

  onSnapshot(candQ, (snapshot) => {
    if (!candidatesTbody) return;
    if (snapshot.empty) {
      candidatesTbody.innerHTML = `<tr><td colspan="5" class="empty-state">No applicants in the evaluation queue.</td></tr>`;
      return;
    }

    candidatesTbody.innerHTML = snapshot.docs.map(d => {
      const c = d.data();
      const id = d.id;

      let statusColor = "var(--text-tertiary)";
      if (c.status === "Hired") statusColor = "var(--success)";
      if (c.status === "Rejected") statusColor = "var(--danger)";
      if (c.status === "Shortlisted") statusColor = "var(--accent)";

      return `
        <tr>
          <td style="font-weight: 600;">${escapeHtml(c.name)}</td>
          <td>${c.experienceYears} Years</td>
          <td style="font-size: 12.5px; color: var(--text-secondary); max-width: 320px;">${escapeHtml(c.resumeSummary || "Standard candidate profile.")}</td>
          <td><span class="status-badge" style="color: ${statusColor};">${escapeHtml(c.status || "Under Review")}</span></td>
          <td>
            <div style="display: flex; gap: 6px;">
              <button type="button" class="btn btn-secondary btn-status" data-id="${id}" data-status="Shortlisted" style="padding: 4px 8px; font-size: 11px;">Shortlist</button>
              <button type="button" class="btn btn-primary btn-status" data-id="${id}" data-status="Hired" style="padding: 4px 8px; font-size: 11px;">Hire</button>
              <button type="button" class="btn btn-secondary btn-status" data-id="${id}" data-status="Rejected" style="padding: 4px 8px; font-size: 11px; color: var(--danger);">Reject</button>
            </div>
          </td>
        </tr>
      `;
    }).join("");

    // Attach Status Update Listeners
    candidatesTbody.querySelectorAll(".btn-status").forEach(btn => {
      btn.addEventListener("click", async () => {
        const candidateId = btn.dataset.id;
        const newStatus = btn.dataset.status;
        try {
          await updateDoc(doc(db, "candidates", candidateId), {
            status: newStatus,
            decidedBy: currentStudentUid
          });
        } catch (err) {
          console.error("Decision update failed:", err);
        }
      });
    });
  });
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

// Auth Guard Initializer
initAuthGuard({
  onReady: ({ user, userData, role }) => {
    activeRole = role;
    currentStudentUid = user.uid;
    activeClassCode = userData.classroomCode || "";

    // Show injector & post buttons only to Faculty
    if (activeRole === "faculty" && facultyActions) {
      facultyActions.style.display = "flex";
    }

    listenToRecruitment();
  }
});