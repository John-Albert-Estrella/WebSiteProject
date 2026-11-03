import { auth, db } from "./firebase-init.js";
import { enforceAuth } from "./auth-guard.js";
import { 
  collection, 
  addDoc, 
  getDoc, 
  doc, 
  updateDoc, 
  onSnapshot, 
  serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

enforceAuth(["faculty", "student", "admin"]);

const jobOrdersContainer = document.getElementById("job-orders-container");
const candidatesContainer = document.getElementById("candidates-container");

document.addEventListener("DOMContentLoaded", () => {
  auth.onAuthStateChanged(async (user) => {
    if (!user) return;

    try {
      const userSnap = await getDoc(doc(db, "users", user.uid));
      if (!userSnap.exists()) return;

      const userData = userSnap.data();
      const isFaculty = userData.role === "faculty" || userData.role === "admin";

      // If Faculty, render "+ Post Requisition" and "+ Add Candidate" actions
      if (isFaculty && jobOrdersContainer) {
        renderFacultyActionControls(user.uid, `${userData.firstName} ${userData.lastName}`);
      }

      // 1. Live Job Requisitions Synchronization
      onSnapshot(collection(db, "job_orders"), (snapshot) => {
        jobOrdersContainer.innerHTML = "";

        if (snapshot.empty) {
          jobOrdersContainer.innerHTML = `<p style="color: var(--text-secondary); font-size: 13px;">No active requisitions published. Faculty can create job orders above.</p>`;
          return;
        }

        snapshot.forEach((docSnap) => {
          const job = docSnap.data();
          const card = document.createElement("div");
          card.className = "applicant-card";
          card.style.borderLeftColor = "var(--brand-ocean)";
          card.innerHTML = `
            <div class="applicant-header">
              <span class="applicant-name">${job.title}</span>
              <span class="applicant-role">${job.department}</span>
            </div>
            <p style="font-size: 13px; color: var(--text-primary); margin-bottom: 8px;">${job.description || ""}</p>
            <div style="font-size: 12px; color: var(--text-secondary);">
              <strong>Evaluation Rubric:</strong> ${job.rubric || "Standard"}
            </div>
            <div style="margin-top: 8px; font-size: 11px; color: var(--text-tertiary);">
              Posted by: ${job.facultyName || "Faculty"} • ${job.createdAt ? new Date(job.createdAt.toDate()).toLocaleDateString() : "Active"}
            </div>
          `;
          jobOrdersContainer.appendChild(card);
        });
      });

      // 2. Live Candidates Screening Queue Synchronization
      onSnapshot(collection(db, "candidates"), (snapshot) => {
        candidatesContainer.innerHTML = "";

        if (snapshot.empty) {
          candidatesContainer.innerHTML = `<p style="color: var(--text-secondary); font-size: 13px;">No applicants in the evaluation queue.</p>`;
          return;
        }

        snapshot.forEach((candDoc) => {
          const cand = candDoc.data();
          const cid = candDoc.id;

          let statusClass = "status-pending";
          if (cand.status === "Approved") statusClass = "status-graded";
          if (cand.status === "Rejected") statusClass = "status-pending"; // Styled as warning/danger

          const card = document.createElement("div");
          card.className = "applicant-card";
          card.innerHTML = `
            <div class="applicant-header">
              <div>
                <span class="applicant-name">${cand.name}</span>
                <span class="applicant-role" style="margin-left: 8px;">${cand.roleApplied}</span>
              </div>
              <span class="status-badge ${statusClass}">${cand.status || "Pending"}</span>
            </div>
            <p style="font-size: 13px; color: var(--text-secondary); margin-bottom: 8px;"><strong>Qualifications:</strong> ${cand.qualifications}</p>
            ${cand.reviewNotes ? `<p style="font-size: 12.5px; background: var(--bg-app); padding: 8px; border-radius: 4px; margin-bottom: 8px;"><em>Decision Note:</em> ${cand.reviewNotes}</p>` : ''}
            <div class="applicant-actions">
              <button class="btn btn-approve" id="approve-${cid}">Approve</button>
              <button class="btn btn-interview" id="interview-${cid}">Interview</button>
              <button class="btn btn-reject" id="reject-${cid}">Reject</button>
            </div>
          `;

          card.querySelector(`#approve-${cid}`).addEventListener("click", () => updatePipelineStatus(cid, "Approved", `${userData.firstName} ${userData.lastName}`));
          card.querySelector(`#interview-${cid}`).addEventListener("click", () => updatePipelineStatus(cid, "Interview Scheduled", `${userData.firstName} ${userData.lastName}`));
          card.querySelector(`#reject-${cid}`).addEventListener("click", () => updatePipelineStatus(cid, "Rejected", `${userData.firstName} ${userData.lastName}`));

          candidatesContainer.appendChild(card);
        });
      });

    } catch (err) {
      console.error("Recruitment engine initialization error:", err);
    }
  });
});

function renderFacultyActionControls(facultyUid, facultyName) {
  const controlsDiv = document.createElement("div");
  controlsDiv.style.display = "flex";
  controlsDiv.style.gap = "10px";
  controlsDiv.style.marginBottom = "16px";

  const btnPostJob = document.createElement("button");
  btnPostJob.className = "btn btn-primary";
  btnPostJob.style.flex = "1";
  btnPostJob.textContent = "+ Post Job Requisition";
  btnPostJob.addEventListener("click", async () => {
    const title = prompt("Target Job Title (e.g., Talent Acquisition Specialist):");
    if (!title || !title.trim()) return;
    const dept = prompt("Department:", "Human Resources") || "Human Resources";
    const desc = prompt("Role Requirements & Duties:");
    const rubric = prompt("Evaluation Rubric Competencies (e.g., Screening, Behavioral Interviewing, Compliance):");

    await addDoc(collection(db, "job_orders"), {
      title: title.trim(),
      department: dept.trim(),
      description: desc ? desc.trim() : "",
      rubric: rubric ? rubric.trim() : "Communication, Experience, Cultural Fit",
      facultyUid,
      facultyName,
      createdAt: serverTimestamp()
    });
  });

  const btnAddCandidate = document.createElement("button");
  btnAddCandidate.className = "btn btn-outline";
  btnAddCandidate.style.flex = "1";
  btnAddCandidate.textContent = "+ Inject Simulation Candidate";
  btnAddCandidate.addEventListener("click", async () => {
    const name = prompt("Candidate Full Name:");
    if (!name || !name.trim()) return;
    const roleApplied = prompt("Role Applied For:");
    const qualifications = prompt("Candidate Background (e.g., 4 Yrs HR, Certified Recruiter, BS Psychology):");

    await addDoc(collection(db, "candidates"), {
      name: name.trim(),
      roleApplied: roleApplied ? roleApplied.trim() : "General Application",
      qualifications: qualifications ? qualifications.trim() : "Standard Resume Profile",
      status: "In Review",
      reviewNotes: "",
      createdAt: serverTimestamp()
    });
  });

  controlsDiv.appendChild(btnPostJob);
  controlsDiv.appendChild(btnAddCandidate);
  jobOrdersContainer.parentElement.insertBefore(controlsDiv, jobOrdersContainer);
}

async function updatePipelineStatus(candidateId, newStatus, reviewerName) {
  const notes = prompt(`Enter evaluation note for marked status [${newStatus}]:`);
  try {
    await updateDoc(doc(db, "candidates", candidateId), {
      status: newStatus,
      reviewNotes: notes ? `${notes} (By: ${reviewerName})` : `Updated to ${newStatus}`,
      evaluatedAt: serverTimestamp()
    });
  } catch (err) {
    console.error("Pipeline update error:", err);
    alert("Could not update candidate status.");
  }
}