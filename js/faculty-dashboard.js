import { db } from "./firebase-init.js";
import { initAuthGuard } from "./auth-guard.js";
import { 
  doc, 
  setDoc, 
  getDoc, 
  updateDoc, 
  collection, 
  query, 
  where, 
  onSnapshot, 
  serverTimestamp, 
  Timestamp 
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

let timerInterval = null;
let currentFacultyUid = null;
let currentActiveCode = null;
let rosterUnsubscribe = null;

// DOM Elements
const displayCode = document.getElementById("display-class-code");
const countdownEl = document.getElementById("code-countdown");
const badgeStatus = document.getElementById("class-status-badge");
const btnGenerate = document.getElementById("btn-generate-code");
const btnCopy = document.getElementById("btn-copy-code");
const btnExpire = document.getElementById("btn-expire-code");
const enrolledCountEl = document.getElementById("enrolled-count");
const rosterTbody = document.getElementById("roster-tbody");

function generateRandomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let part = "";
  for (let i = 0; i < 4; i++) {
    part += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `AIM-${part}`;
}

function runCountdown(expiryDate) {
  if (timerInterval) clearInterval(timerInterval);

  function tick() {
    const now = new Date().getTime();
    const distance = expiryDate.getTime() - now;

    if (distance <= 0) {
      clearInterval(timerInterval);
      setExpiredState();
      return;
    }

    const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((distance % (1000 * 60)) / 1000);

    if (countdownEl) {
      countdownEl.textContent = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    }
  }

  tick();
  timerInterval = setInterval(tick, 1000);
}

function setActiveState(code, expiryDate) {
  currentActiveCode = code;
  if (displayCode) displayCode.textContent = code;
  if (badgeStatus) {
    badgeStatus.textContent = "Session Active";
    badgeStatus.className = "status-badge active";
  }
  if (btnCopy) btnCopy.disabled = false;
  if (btnExpire) btnExpire.disabled = false;
  if (btnGenerate) btnGenerate.textContent = "Regenerate New Code";
  runCountdown(expiryDate);
  listenToClassRoster(code);
}

function setExpiredState() {
  if (timerInterval) clearInterval(timerInterval);
  currentActiveCode = null;
  if (displayCode) displayCode.textContent = "------";
  if (countdownEl) countdownEl.textContent = "--:--";
  if (badgeStatus) {
    badgeStatus.textContent = "No Active Session";
    badgeStatus.className = "status-badge";
  }
  if (btnCopy) btnCopy.disabled = true;
  if (btnExpire) btnExpire.disabled = true;
  if (btnGenerate) btnGenerate.textContent = "Generate 60-Minute Code";

  if (rosterUnsubscribe) {
    rosterUnsubscribe();
    rosterUnsubscribe = null;
  }
  if (enrolledCountEl) enrolledCountEl.textContent = "0";
  if (rosterTbody) {
    rosterTbody.innerHTML = `
      <tr>
        <td colspan="5" class="empty-state">No active classroom session. Generate a code above to view students.</td>
      </tr>
    `;
  }
}

function listenToClassRoster(classCode) {
  if (rosterUnsubscribe) rosterUnsubscribe();

  const q = query(
    collection(db, "users"),
    where("role", "==", "student"),
    where("classroomCode", "==", classCode)
  );

  rosterUnsubscribe = onSnapshot(q, (snapshot) => {
    if (enrolledCountEl) enrolledCountEl.textContent = snapshot.size;

    if (snapshot.empty) {
      if (rosterTbody) {
        rosterTbody.innerHTML = `
          <tr>
            <td colspan="5" class="empty-state">No students joined with code ${classCode} yet.</td>
          </tr>
        `;
      }
      return;
    }

    let rowsHtml = "";
    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      const studentUid = docSnap.id;
      const studentName = `${data.firstName || ""} ${data.lastName || ""}`.trim() || "Anonymous Student";
      const studentEmail = data.email || "No institutional email";
      const joinedDate = data.createdAt ? data.createdAt.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "Just now";

      rowsHtml += `
        <tr>
          <td style="font-weight: 600;">${escapeHtml(studentName)}</td>
          <td style="color: var(--text-secondary);">${escapeHtml(studentEmail)}</td>
          <td style="color: var(--text-tertiary);">${joinedDate}</td>
          <td><span class="status-badge" style="background: rgba(56, 189, 248, 0.12); color: #38bdf8;">Student</span></td>
          <td>
            <button type="button" class="btn btn-secondary btn-kick-student" data-uid="${studentUid}" data-name="${escapeHtml(studentName)}" style="padding: 4px 10px; font-size: 11px; color: var(--danger); border-color: rgba(239, 68, 68, 0.3);">
              Remove
            </button>
          </td>
        </tr>
      `;
    });

    if (rosterTbody) rosterTbody.innerHTML = rowsHtml;

    // Attach Student Removal Event Listeners
    document.querySelectorAll(".btn-kick-student").forEach(btn => {
      btn.addEventListener("click", async () => {
        const uid = btn.dataset.uid;
        const name = btn.dataset.name;

        if (confirm(`Remove ${name} from this classroom section?`)) {
          try {
            await updateDoc(doc(db, "users", uid), {
              classroomCode: ""
            });
          } catch (err) {
            console.error("Failed to remove student:", err);
            alert("Could not remove student: " + err.message);
          }
        }
      });
    });
  }, (err) => {
    console.error("Error reading class roster:", err);
  });
}

function escapeHtml(string) {
  return String(string).replace(/[&<>"']/g, (s) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[s]));
}

async function checkExistingClassCode(uid) {
  try {
    const classDocRef = doc(db, "classrooms", uid);
    const snap = await getDoc(classDocRef);

    if (snap.exists()) {
      const data = snap.data();
      if (data.active && data.expiresAt) {
        const expiryDate = data.expiresAt.toDate();
        if (expiryDate > new Date()) {
          setActiveState(data.code, expiryDate);
          return;
        }
      }
    }
    setExpiredState();
  } catch (err) {
    console.error("Error reading classroom state:", err);
    setExpiredState();
  }
}

btnGenerate?.addEventListener("click", async () => {
  if (!currentFacultyUid) return;

  btnGenerate.disabled = true;
  btnGenerate.textContent = "Generating...";

  const newCode = generateRandomCode();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

  try {
    await setDoc(doc(db, "classrooms", currentFacultyUid), {
      facultyUid: currentFacultyUid,
      code: newCode,
      active: true,
      createdAt: serverTimestamp(),
      expiresAt: Timestamp.fromDate(expiresAt)
    });

    setActiveState(newCode, expiresAt);
  } catch (error) {
    console.error("Failed to generate code:", error);
    alert(`Could not activate class code: ${error.message}`);
  } finally {
    btnGenerate.disabled = false;
  }
});

btnExpire?.addEventListener("click", async () => {
  if (!currentFacultyUid) return;

  btnExpire.disabled = true;
  try {
    await updateDoc(doc(db, "classrooms", currentFacultyUid), {
      active: false
    });
    setExpiredState();
  } catch (error) {
    console.error("Failed to deactivate code:", error);
  } finally {
    btnExpire.disabled = false;
  }
});

btnCopy?.addEventListener("click", async () => {
  const code = displayCode ? displayCode.textContent : "";
  if (!code || code === "------") return;

  try {
    await navigator.clipboard.writeText(code);
    btnCopy.textContent = "✓";
    setTimeout(() => { btnCopy.textContent = "📋"; }, 1500);
  } catch (err) {
    alert(`Classroom Code: ${code}`);
  }
});

// Guard: Strictly Requires Faculty
initAuthGuard({
  requiredRole: "faculty",
  onReady: ({ user }) => {
    currentFacultyUid = user.uid;
    checkExistingClassCode(user.uid);
  }
});