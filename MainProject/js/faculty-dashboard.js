import { auth, db } from "./firebase-init.js";
import { enforceAuth } from "./auth-guard.js";
import { 
  doc, 
  getDoc, 
  setDoc, 
  updateDoc, 
  onSnapshot, 
  serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

enforceAuth(["faculty", "admin"]);

const roomCodeDisplay = document.getElementById("faculty-room-code");
const btnOpenModal = document.getElementById("btn-open-create-modal");
const modal = document.getElementById("create-class-modal");
const btnCancelModal = document.getElementById("btn-cancel-modal");
const btnSaveCustomClass = document.getElementById("btn-save-custom-class");
const customTitleInput = document.getElementById("custom-class-title");
const customCodeInput = document.getElementById("custom-room-code");

const btnGenerateRandom = document.getElementById("btn-generate-code");
const btnCopy = document.getElementById("btn-copy-code");
const rosterList = document.getElementById("class-roster-list");
const rosterBadge = document.getElementById("roster-count-badge");

let unsubscribeRoomListener = null;

function generateRandomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 7; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `${code.slice(0, 3)}-${code.slice(3)}`;
}

document.addEventListener("DOMContentLoaded", () => {
  auth.onAuthStateChanged((user) => {
    if (!user) return;
    loadFacultyProfile(user.uid);

    // Modal toggles
    if (btnOpenModal) {
      btnOpenModal.addEventListener("click", () => {
        modal.style.display = "block";
        customCodeInput.value = "";
        customTitleInput.value = "";
      });
    }

    if (btnCancelModal) {
      btnCancelModal.addEventListener("click", () => {
        modal.style.display = "none";
      });
    }

    // Save Custom Class
    if (btnSaveCustomClass) {
      btnSaveCustomClass.addEventListener("click", async () => {
        const title = customTitleInput.value.trim() || "HR Management Simulation";
        let code = customCodeInput.value.trim().toUpperCase().replace(/[^A-Z0-9-]/g, "");

        if (!code) {
          code = generateRandomCode();
        } else if (code.length < 4 || code.length > 8) {
          alert("Room code must be between 4 and 8 characters.");
          return;
        }

        btnSaveCustomClass.disabled = true;
        btnSaveCustomClass.textContent = "Creating...";

        try {
          const roomRef = doc(db, "rooms", code);
          const roomSnap = await getDoc(roomRef);

          if (roomSnap.exists()) {
            alert(`Room code "${code}" is already in use. Please choose another code.`);
            btnSaveCustomClass.disabled = false;
            btnSaveCustomClass.textContent = "Confirm & Activate";
            return;
          }

          await createAndActivateRoom(user.uid, code, title);
          modal.style.display = "none";
        } catch (err) {
          console.error("Custom room creation error:", err);
          alert("Error: " + err.message);
        } finally {
          btnSaveCustomClass.disabled = false;
          btnSaveCustomClass.textContent = "Confirm & Activate";
        }
      });
    }

    // Quick Random Generator
    if (btnGenerateRandom) {
      btnGenerateRandom.addEventListener("click", async () => {
        btnGenerateRandom.disabled = true;
        try {
          const randomCode = generateRandomCode();
          await createAndActivateRoom(user.uid, randomCode, "HR Management Course");
        } catch (err) {
          console.error("Random code error:", err);
          alert("Failed to create room.");
        } finally {
          btnGenerateRandom.disabled = false;
        }
      });
    }

    // Copy Button
    if (btnCopy) {
      btnCopy.addEventListener("click", () => {
        const code = roomCodeDisplay.textContent.trim();
        if (!code || code === "---") return;
        navigator.clipboard.writeText(code);
        btnCopy.textContent = "Copied!";
        setTimeout(() => (btnCopy.textContent = "Copy Code"), 2000);
      });
    }
  });
});

async function createAndActivateRoom(facultyUid, code, title) {
  const userDocRef = doc(db, "users", facultyUid);
  const userSnap = await getDoc(userDocRef);
  const facultyData = userSnap.data();

  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + 24);

  // 1. Write Room Document
  await setDoc(doc(db, "rooms", code), {
    facultyUid: facultyUid,
    facultyName: `${facultyData.firstName} ${facultyData.lastName}`,
    classTitle: title,
    createdAt: serverTimestamp(),
    expiresAt: expiresAt,
    students: []
  });

  // 2. Link active room to Faculty Document
  await updateDoc(userDocRef, {
    activeRoomCode: code
  });

  listenToRoomRoster(code);
}

async function loadFacultyProfile(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  if (snap.exists() && snap.data().activeRoomCode) {
    listenToRoomRoster(snap.data().activeRoomCode);
  }
}

function listenToRoomRoster(roomCode) {
  if (roomCodeDisplay) roomCodeDisplay.textContent = roomCode;

  if (unsubscribeRoomListener) unsubscribeRoomListener();

  unsubscribeRoomListener = onSnapshot(doc(db, "rooms", roomCode), (snapshot) => {
    if (!snapshot.exists()) {
      rosterList.innerHTML = `<li class="roster-item" style="color: var(--text-secondary);">Room not found.</li>`;
      return;
    }

    const room = snapshot.data();
    const students = room.students || [];

    if (rosterBadge) rosterBadge.textContent = `${students.length} / 100 Enrolled`;
    if (rosterList) {
      rosterList.innerHTML = "";
      if (students.length === 0) {
        rosterList.innerHTML = `<li class="roster-item" style="color: var(--text-secondary);">No students enrolled yet. Share code <strong>${roomCode}</strong>.</li>`;
        return;
      }

      students.forEach((s, idx) => {
        const item = document.createElement("li");
        item.className = "roster-item";
        item.innerHTML = `
          <span style="font-weight: 600;">${idx + 1}. ${s.name}</span>
          <span class="status-badge status-graded">Enrolled</span>
        `;
        rosterList.appendChild(item);
      });
    }
  });
}