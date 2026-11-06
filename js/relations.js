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

// Add at the beginning of each module JS file:
const urlParams = new URLSearchParams(window.location.search);
let targetCode = urlParams.get("code");

initAuthGuard({
  allowedRoles: ["student", "faculty", "admin"],
  onReady: async ({ user, userData, role }) => {
    // If not supplied in URL, fallback to student's enrolled classroom
    if (!targetCode && userData.classroomCode) {
      targetCode = userData.classroomCode;
    }

    if (!targetCode) {
      alert("No active classroom selected. Returning to dashboard.");
      window.location.replace(role === "faculty" ? "faculty-dashboard.html" : "student-dashboard.html");
      return;
    }

    // Set Scope Label & Breadcrumb Links
    const scopeLabel = document.getElementById("scope-class-code");
    const breadcrumbLink = document.getElementById("breadcrumb-classroom-link");
    const sidebarClassLink = document.getElementById("sidebar-class-hub-link");

    if (scopeLabel) scopeLabel.textContent = targetCode;
    if (breadcrumbLink) breadcrumbLink.href = `classroom.html?code=${targetCode}`;
    if (sidebarClassLink) sidebarClassLink.href = `classroom.html?code=${targetCode}`;

    // Proceed to initialize module scoped to targetCode...
  }
});

const btnOpenGrievance = document.getElementById("btn-open-grievance-modal");
const btnCloseGrievance = document.getElementById("btn-close-grievance-modal");
const grievanceModal = document.getElementById("grievance-modal");
const formFileGrievance = document.getElementById("form-file-grievance");
const grievanceStream = document.getElementById("grievance-stream");

let activeUser = null;
let activeRole = "student";
let activeClassCode = "";

btnOpenGrievance?.addEventListener("click", () => { if (grievanceModal) grievanceModal.style.display = "block"; });
btnCloseGrievance?.addEventListener("click", () => { if (grievanceModal) grievanceModal.style.display = "none"; });

formFileGrievance?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = document.getElementById("gr-title-input")?.value.trim();
  const category = document.getElementById("gr-category-input")?.value;
  const details = document.getElementById("gr-details-input")?.value.trim();

  if (!title || !details) return;

  try {
    await addDoc(collection(db, "grievances"), {
      title,
      category,
      details,
      status: "PENDING INVESTIGATION",
      filedBy: activeUser.displayName || activeUser.email,
      filedByUid: activeUser.uid,
      classroomCode: activeClassCode || "GLOBAL",
      resolutionNotes: "",
      createdAt: serverTimestamp()
    });

    if (grievanceModal) grievanceModal.style.display = "none";
    if (formFileGrievance) formFileGrievance.reset();
  } catch (err) {
    console.error("Grievance submission error:", err);
    alert("Could not submit report: " + err.message);
  }
});

function listenToGrievances() {
  const q = activeClassCode 
    ? query(collection(db, "grievances"), where("classroomCode", "==", activeClassCode))
    : query(collection(db, "grievances"));

  onSnapshot(q, (snapshot) => {
    if (!grievanceStream) return;
    if (snapshot.empty) {
      grievanceStream.innerHTML = `<div class="empty-state"><p>No active grievances in the investigation queue.</p></div>`;
      return;
    }

    grievanceStream.innerHTML = snapshot.docs.map(d => {
      const g = d.data();
      const id = d.id;
      const isResolved = g.status === "RESOLVED";

      return `
        <div class="card" style="padding: 20px; gap: 12px; border-color: ${isResolved ? 'var(--surface-border)' : 'rgba(245, 158, 11, 0.3)'};">
          <div style="display: flex; justify-content: space-between; align-items: flex-start;">
            <div>
              <h3 style="font-size: 16px; font-weight: 700; color: var(--text-primary);">${escapeHtml(g.title)}</h3>
              <span style="font-size: 12px; color: var(--text-tertiary);">
                Category: ${escapeHtml(g.category)} • Filed by: ${escapeHtml(g.filedBy || "Anonymous")}
              </span>
            </div>
            <span class="status-badge" style="${isResolved ? 'background: var(--success-bg); color: var(--success);' : 'background: rgba(245, 158, 11, 0.15); color: #f59e0b;'}">
              ${escapeHtml(g.status || "PENDING INVESTIGATION")}
            </span>
          </div>

          <p style="font-size: 14px; color: var(--text-secondary); line-height: 1.5; background: var(--bg-surface); padding: 12px 14px; border-radius: var(--radius-sm); border: 1px solid var(--surface-border);">
            ${escapeHtml(g.details)}
          </p>

          ${g.resolutionNotes ? `
            <div style="font-size: 13px; color: var(--text-primary); background: rgba(56, 189, 248, 0.08); padding: 10px 14px; border-radius: var(--radius-sm); border: 1px solid rgba(56, 189, 248, 0.2);">
              <strong>Determination:</strong> ${escapeHtml(g.resolutionNotes)}
            </div>
          ` : ""}

          ${!isResolved ? `
            <form class="form-resolve-grievance" data-id="${id}" style="display: flex; gap: 8px; margin-top: 4px;">
              <input type="text" class="form-control input-resolution" placeholder="Resolution determination notes..." required style="padding: 8px 12px; font-size: 13px;">
              <button type="submit" class="btn btn-primary" style="padding: 8px 18px; font-size: 13px;">Resolve</button>
            </form>
          ` : ""}
        </div>
      `;
    }).join("");

    document.querySelectorAll(".form-resolve-grievance").forEach(form => {
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const grievanceId = form.dataset.id;
        const notes = form.querySelector(".input-resolution")?.value.trim();
        if (!notes) return;

        try {
          await updateDoc(doc(db, "grievances", grievanceId), {
            status: "RESOLVED",
            resolutionNotes: notes,
            resolvedAt: serverTimestamp(),
            resolvedBy: activeUser.email
          });
        } catch (err) {
          console.error("Failed to resolve grievance:", err);
          alert("Resolution failed: " + err.message);
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

initAuthGuard({
  onReady: ({ user, userData, role }) => {
    activeUser = user;
    activeRole = role;
    activeClassCode = userData.classroomCode || "";
    listenToGrievances();
  }
});