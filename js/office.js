// js/office.js - Core Classroom Workspace & Activity Management Engine
import { db, auth } from "./firebase-init.js";
import {
  collection,
  doc,
  addDoc,
  getDoc,
  getDocs,
  updateDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  serverTimestamp,
  arrayUnion
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { uploadToCloudinary } from "./cloudinary-config.js";

let currentClassId = null;
let currentUser = null;
let userRole = "student";
let activitiesUnsubscribe = null;

onAuthStateChanged(auth, async (user) => {
  if (!user) return;
  currentUser = user;

  // Retrieve user role from /users profile
  try {
    const userSnap = await getDoc(doc(db, "users", user.uid));
    if (userSnap.exists()) {
      userRole = userSnap.data().role || "student";
    }
  } catch (e) {
    console.warn("Could not read user profile role, defaulting to student:", e);
  }

  applyRoleVisibility();
  await loadUserClassrooms();
  setupOfficeEventListeners();
});

// Show/hide controls based on role
function applyRoleVisibility() {
  const isFaculty = userRole === "faculty" || userRole === "admin";
  document.querySelectorAll(".faculty-only").forEach((el) => {
    el.style.display = isFaculty ? "" : "none";
  });
  document.querySelectorAll(".student-only").forEach((el) => {
    el.style.display = isFaculty ? "none" : "";
  });
}

// Load classrooms user belongs to
async function loadUserClassrooms() {
  const selector = document.getElementById("classroom-selector");
  if (!selector) return;

  try {
    let q;
    if (userRole === "faculty" || userRole === "admin") {
      q = query(collection(db, "classrooms"), where("facultyUid", "==", currentUser.uid));
    } else {
      q = query(collection(db, "classrooms"), where("students", "array-contains", currentUser.uid));
    }

    const snap = await getDocs(q);
    selector.innerHTML = '<option value="">Select a Section...</option>';

    snap.forEach((docSnap) => {
      const cls = docSnap.data();
      const opt = document.createElement("option");
      opt.value = docSnap.id;
      opt.textContent = `${cls.name} (${cls.code || "No code"})`;
      selector.appendChild(opt);
    });

    if (snap.docs.length > 0) {
      selector.value = snap.docs[0].id;
      switchClassroom(snap.docs[0].id);
    } else {
      resetOfficeView();
    }
  } catch (err) {
    console.error("Error loading classrooms:", err);
  }
}

// Switch active classroom section
async function switchClassroom(classId) {
  currentClassId = classId;
  const badge = document.getElementById("active-classroom-badge");
  const codeBox = document.getElementById("section-code-box");
  const codeDisplay = document.getElementById("display-section-code");

  if (!classId) {
    resetOfficeView();
    return;
  }

  try {
    const classDoc = await getDoc(doc(db, "classrooms", classId));
    if (!classDoc.exists()) return;

    const data = classDoc.data();
    if (badge) badge.textContent = data.name;
    if (codeDisplay) codeDisplay.textContent = data.code || "---";
    if (codeBox) codeBox.style.display = "inline-flex";

    listenToActivities(classId);
    loadRoster(data);
    loadAnalytics(classId, data);
    loadPortfolio(classId);
  } catch (err) {
    console.error("Error switching classroom:", err);
  }
}

function resetOfficeView() {
  currentClassId = null;
  const badge = document.getElementById("active-classroom-badge");
  const codeBox = document.getElementById("section-code-box");
  if (badge) badge.textContent = "Select or Join a Section";
  if (codeBox) codeBox.style.display = "none";

  const list = document.getElementById("activities-list");
  if (list) {
    list.innerHTML = '<div class="empty-state"><i class="fas fa-folder-open"></i><p>Select or join a classroom section above.</p></div>';
  }

  if (activitiesUnsubscribe) activitiesUnsubscribe();
}

// Real-time listener for section activities
function listenToActivities(classId) {
  if (activitiesUnsubscribe) activitiesUnsubscribe();

  const q = query(
    collection(db, "office_activities"),
    where("classId", "==", classId),
    orderBy("createdAt", "desc")
  );

  activitiesUnsubscribe = onSnapshot(q, (snapshot) => {
    const list = document.getElementById("activities-list");
    if (!list) return;

    if (snapshot.empty) {
      list.innerHTML = '<div class="empty-state"><i class="fas fa-folder-open"></i><p>No activities posted yet for this section.</p></div>';
      return;
    }

    list.innerHTML = "";
    snapshot.forEach((docSnap) => {
      const act = docSnap.data();
      list.appendChild(createActivityCard(docSnap.id, act));
    });
  }, (err) => {
    console.error("Error loading activities:", err);
  });
}

function createActivityCard(actId, act) {
  const div = document.createElement("div");
  div.className = "activity-card glass-panel";
  div.style.padding = "1.25rem";
  div.style.display = "flex";
  div.style.flexDirection = "column";
  div.style.justifyContent = "space-between";

  const isFaculty = userRole === "faculty" || userRole === "admin";
  const dueDateStr = act.dueDate ? new Date(act.dueDate).toLocaleString() : "No due date";

  div.innerHTML = `
    <div>
      <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.5rem;">
        <span class="badge-pill" style="font-size: 0.72rem;">${act.points || 100} Points</span>
        <span style="font-size: 0.75rem; color: var(--text-muted);"><i class="far fa-clock"></i> Due: ${dueDateStr}</span>
      </div>
      <h3 style="margin: 0 0 0.5rem 0; font-size: 1.1rem;">${escapeHtml(act.title)}</h3>
      <p style="font-size: 0.85rem; color: var(--text-muted); margin: 0 0 1rem 0; white-space: pre-line;">${escapeHtml(act.instructions)}</p>
      ${act.attachmentUrl ? `<a href="${act.attachmentUrl}" target="_blank" rel="noopener" style="font-size: 0.8rem; color: #38bdf8; display: inline-flex; align-items: center; gap: 0.4rem; margin-bottom: 1rem;"><i class="fas fa-download"></i> Activity File</a>` : ""}
    </div>
    <div style="border-top: 1px solid var(--border-color); padding-top: 0.75rem; margin-top: 0.75rem; display: flex; justify-content: space-between; align-items: center;">
      ${isFaculty ? `
        <span style="font-size: 0.8rem; color: var(--text-muted);"><i class="fas fa-user-check"></i> Submissions Enabled</span>
      ` : `
        <button type="button" class="btn-primary btn-submit-activity" data-id="${actId}" style="padding: 0.45rem 0.85rem; font-size: 0.8rem;">
          <i class="fas fa-upload"></i> Submit Deliverable
        </button>
      `}
    </div>
  `;

  return div;
}

// Load Roster & Pending Requests
async function loadRoster(classData) {
  const enrolledList = document.getElementById("enrolled-roster-list");
  const pendingCard = document.getElementById("pending-requests-card");
  const pendingList = document.getElementById("pending-roster-list");

  if (!enrolledList) return;

  const studentUids = classData.students || [];
  const pendingUids = classData.pendingStudents || [];

  // Enrolled
  if (studentUids.length === 0) {
    enrolledList.innerHTML = '<p class="text-muted" style="font-size: 0.85rem;">No students enrolled yet.</p>';
  } else {
    enrolledList.innerHTML = "";
    for (const uid of studentUids) {
      try {
        const uSnap = await getDoc(doc(db, "users", uid));
        const uData = uSnap.exists() ? uSnap.data() : { fullName: "Student", email: uid };
        const row = document.createElement("div");
        row.style.padding = "0.5rem 0";
        row.style.borderBottom = "1px solid var(--border-color)";
        row.style.fontSize = "0.85rem";
        row.innerHTML = `<strong>${escapeHtml(uData.fullName || "Student")}</strong> <span class="text-muted">(${escapeHtml(uData.email || "")})</span>`;
        enrolledList.appendChild(row);
      } catch (e) {
        console.warn(e);
      }
    }
  }

  // Pending (Faculty view)
  if (pendingCard && pendingList && (userRole === "faculty" || userRole === "admin")) {
    if (pendingUids.length === 0) {
      pendingCard.style.display = "none";
    } else {
      pendingCard.style.display = "block";
      pendingList.innerHTML = "";
      for (const uid of pendingUids) {
        const row = document.createElement("div");
        row.style.display = "flex";
        row.style.justifyContent = "space-between";
        row.style.alignItems = "center";
        row.style.padding = "0.5rem 0";
        row.innerHTML = `
          <span style="font-size: 0.85rem;">UID: ${uid}</span>
          <button type="button" class="btn-primary btn-approve-student" data-uid="${uid}" style="padding: 0.3rem 0.6rem; font-size: 0.75rem;">
            Approve
          </button>
        `;
        row.querySelector(".btn-approve-student").addEventListener("click", async () => {
          await approveStudent(uid);
        });
        pendingList.appendChild(row);
      }
    }
  }
}

async function approveStudent(uid) {
  if (!currentClassId) return;
  try {
    const classRef = doc(db, "classrooms", currentClassId);
    const snap = await getDoc(classRef);
    if (!snap.exists()) return;

    const data = snap.data();
    const currentPending = (data.pendingStudents || []).filter((id) => id !== uid);

    await updateDoc(classRef, {
      students: arrayUnion(uid),
      pendingStudents: currentPending,
      updatedAt: serverTimestamp()
    });

    switchClassroom(currentClassId);
  } catch (err) {
    console.error("Error approving student:", err);
  }
}

// Load section analytics
async function loadAnalytics(classId, classData) {
  const totalActEl = document.getElementById("stat-total-activities");
  const compSubsEl = document.getElementById("stat-completed-subs");
  const enrolledEl = document.getElementById("stat-enrolled-count");

  if (enrolledEl) enrolledEl.textContent = (classData.students || []).length;

  try {
    const actSnap = await getDocs(query(collection(db, "office_activities"), where("classId", "==", classId)));
    if (totalActEl) totalActEl.textContent = actSnap.size;

    const subSnap = await getDocs(query(collection(db, "office_submissions"), where("classId", "==", classId)));
    if (compSubsEl) compSubsEl.textContent = subSnap.size;
  } catch (err) {
    console.warn("Analytics fetch error:", err);
  }
}

// Load portfolio deliverables
async function loadPortfolio(classId) {
  const list = document.getElementById("portfolio-list");
  if (!list) return;

  try {
    const q = query(
      collection(db, "office_submissions"),
      where("classId", "==", classId),
      where("studentUid", "==", currentUser.uid)
    );
    const snap = await getDocs(q);

    if (snap.empty) {
      list.innerHTML = '<div class="empty-state"><i class="fas fa-award"></i><p>No graded deliverables submitted yet.</p></div>';
      return;
    }

    list.innerHTML = "";
    snap.forEach((docSnap) => {
      const sub = docSnap.data();
      const div = document.createElement("div");
      div.className = "portfolio-card glass-panel";
      div.style.padding = "1rem";
      div.innerHTML = `
        <h4 style="margin: 0 0 0.25rem 0;">${escapeHtml(sub.activityTitle || "Deliverable")}</h4>
        <p class="text-muted" style="font-size: 0.8rem; margin: 0 0 0.5rem 0;">Status: <strong>${sub.status || "Submitted"}</strong></p>
        <span class="badge-pill" style="font-size: 0.72rem;">Score: ${sub.grade != null ? sub.grade : "Pending"}</span>
      `;
      list.appendChild(div);
    });
  } catch (err) {
    console.warn("Portfolio fetch error:", err);
  }
}

// Setup Office Event Listeners
function setupOfficeEventListeners() {
  const selector = document.getElementById("classroom-selector");
  if (selector) {
    selector.addEventListener("change", (e) => {
      switchClassroom(e.target.value);
    });
  }

  // 1. Form: Create Section (Faculty)
  const formCreateSection = document.getElementById("form-create-section");
  if (formCreateSection && !formCreateSection.dataset.bound) {
    formCreateSection.dataset.bound = "true";
    formCreateSection.addEventListener("submit", async (e) => {
      e.preventDefault();
      const name = document.getElementById("section-name").value.trim();
      const desc = document.getElementById("section-desc").value.trim();
      const submitBtn = formCreateSection.querySelector("button[type='submit']");

      submitBtn.disabled = true;
      submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creating...';

      try {
        const code = Math.random().toString(36).substring(2, 8).toUpperCase();
        const docRef = await addDoc(collection(db, "classrooms"), {
          name: name,
          description: desc,
          code: code,
          facultyUid: currentUser.uid,
          students: [],
          pendingStudents: [],
          createdAt: serverTimestamp()
        });

        formCreateSection.reset();
        closeModal("modal-create-section");
        await loadUserClassrooms();
        selector.value = docRef.id;
        switchClassroom(docRef.id);
      } catch (err) {
        console.error("Error creating section:", err);
        alert("Failed to create section: " + err.message);
      } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = "Create Section";
      }
    });
  }

  // 2. Form: Join Section (Student)
  const formJoinSection = document.getElementById("form-join-section");
  if (formJoinSection && !formJoinSection.dataset.bound) {
    formJoinSection.dataset.bound = "true";
    formJoinSection.addEventListener("submit", async (e) => {
      e.preventDefault();
      const codeInput = document.getElementById("join-code-input");
      const submitBtn = formJoinSection.querySelector("button[type='submit']");
      const code = codeInput.value.trim().toUpperCase();

      submitBtn.disabled = true;
      submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Requesting...';

      try {
        const q = query(collection(db, "classrooms"), where("code", "==", code));
        const snap = await getDocs(q);

        if (snap.empty) {
          alert("Classroom code not found.");
          return;
        }

        const clsDoc = snap.docs[0];
        const clsData = clsDoc.data();

        if ((clsData.students || []).includes(currentUser.uid)) {
          alert("You are already enrolled in this section.");
          closeModal("modal-join-section");
          return;
        }

        if ((clsData.pendingStudents || []).includes(currentUser.uid)) {
          alert("Your join request is already pending instructor approval.");
          closeModal("modal-join-section");
          return;
        }

        // Add to pending approvals
        await updateDoc(doc(db, "classrooms", clsDoc.id), {
          pendingStudents: arrayUnion(currentUser.uid),
          updatedAt: serverTimestamp()
        });

        alert("Join request sent successfully! Awaiting faculty approval.");
        formJoinSection.reset();
        closeModal("modal-join-section");
      } catch (err) {
        console.error("Error requesting join:", err);
        alert("Failed to join section: " + err.message);
      } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = "Send Join Request";
      }
    });
  }

  // 3. Form: Post Activity (Faculty)
  const formCreateActivity = document.getElementById("form-create-activity");
  if (formCreateActivity && !formCreateActivity.dataset.bound) {
    formCreateActivity.dataset.bound = "true";
    formCreateActivity.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!currentClassId) {
        alert("Please select or create a classroom section first.");
        return;
      }

      const title = document.getElementById("activity-title").value.trim();
      const instructions = document.getElementById("activity-instructions").value.trim();
      const due = document.getElementById("activity-due").value;
      const points = parseInt(document.getElementById("activity-points").value, 10) || 100;
      const fileInput = document.getElementById("activity-attachment");
      const submitBtn = formCreateActivity.querySelector("button[type='submit']");

      submitBtn.disabled = true;
      submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Publishing...';

      try {
        let attachmentUrl = "";
        if (fileInput && fileInput.files.length > 0) {
          submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Uploading Resource...';
          attachmentUrl = await uploadToCloudinary(fileInput.files[0]);
        }

        await addDoc(collection(db, "office_activities"), {
          classId: currentClassId,
          title: title,
          instructions: instructions,
          dueDate: due,
          points: points,
          attachmentUrl: attachmentUrl || null,
          facultyUid: currentUser.uid,
          createdAt: serverTimestamp()
        });

        formCreateActivity.reset();
        closeModal("modal-create-activity");
      } catch (err) {
        console.error("Error creating activity:", err);
        alert("Failed to publish activity: " + err.message);
      } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = "Publish Activity";
      }
    });
  }
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.remove("is-open");
    modal.style.display = "none";
  }
}

function escapeHtml(str) {
  if (!str) return "";
  return str.replace(/[&<>"']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[m]));
}