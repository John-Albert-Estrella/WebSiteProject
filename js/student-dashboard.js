import { auth, db } from "./firebase-init.js";
import { enforceAuth } from "./auth-guard.js";
import { 
  doc, 
  getDoc, 
  updateDoc, 
  arrayUnion 
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// Restrict access strictly to students
enforceAuth(["student"]);

const joinCard = document.getElementById("join-room-card");
const statusCard = document.getElementById("enrollment-status-card");
const inputCode = document.getElementById("input-room-code");
const btnJoin = document.getElementById("btn-join-room");
const enrolledCodeDisplay = document.getElementById("enrolled-code-display");
const enrolledFacultyName = document.getElementById("enrolled-faculty-name");

document.addEventListener("DOMContentLoaded", () => {
  const user = auth.currentUser;
  if (!user) return;

  loadStudentEnrollment(user.uid);

  btnJoin.addEventListener("click", async () => {
    const code = inputCode.value.trim().toUpperCase();
    if (code.length < 7) {
      alert("Please enter a valid room code.");
      return;
    }

    btnJoin.disabled = true;
    btnJoin.textContent = "Joining...";

    try {
      const roomRef = doc(db, "rooms", code);
      const roomSnap = await getDoc(roomRef);

      if (!roomSnap.exists()) {
        throw new Error("Invalid room code. Please check with your instructor.");
      }

      const roomData = roomSnap.data();
      const now = new Date();
      const expiresAt = roomData.expiresAt.toDate();

      if (now > expiresAt) {
        throw new Error("This room code has expired.");
      }

      const currentStudents = roomData.students || [];
      if (currentStudents.length >= 100) {
        throw new Error("This class is already at maximum capacity (100 students).");
      }

      const alreadyJoined = currentStudents.some((s) => s.uid === user.uid);
      if (alreadyJoined) {
        throw new Error("You are already enrolled in this class.");
      }

      const userDocRef = doc(db, "users", user.uid);
      const userSnap = await getDoc(userDocRef);
      const userData = userSnap.data();

      // Enroll student into room
      await updateDoc(roomRef, {
        students: arrayUnion({
          uid: user.uid,
          name: `${userData.firstName} ${userData.lastName}`,
          joinedAt: new Date().toISOString()
        })
      });

      // Update student user profile
      await updateDoc(userDocRef, {
        roomCode: code
      });

      renderEnrolledUI(code, roomData.facultyName);
      alert("Successfully enrolled in class!");

    } catch (error) {
      console.error("Enrollment error:", error);
      alert(error.message);
    } finally {
      btnJoin.disabled = false;
      btnJoin.textContent = "Join Class";
    }
  });
});

async function loadStudentEnrollment(uid) {
  try {
    const userSnap = await getDoc(doc(db, "users", uid));
    if (!userSnap.exists()) return;

    const userData = userSnap.data();
    if (userData.roomCode) {
      const roomSnap = await getDoc(doc(db, "rooms", userData.roomCode));
      const facultyName = roomSnap.exists() ? roomSnap.data().facultyName : "Unknown Instructor";
      renderEnrolledUI(userData.roomCode, facultyName);
    }
  } catch (error) {
    console.error("Error loading enrollment:", error);
  }
}

function renderEnrolledUI(roomCode, facultyName) {
  joinCard.style.display = "none";
  statusCard.style.display = "block";
  enrolledCodeDisplay.textContent = roomCode;
  enrolledFacultyName.textContent = `Instructor: ${facultyName}`;
}