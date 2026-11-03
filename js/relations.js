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

const studentCard = document.getElementById("student-grievance-card");
const queueContainer = document.getElementById("grievance-queue-container");
const btnSubmit = document.getElementById("btn-submit-grievance");

document.addEventListener("DOMContentLoaded", () => {
  auth.onAuthStateChanged(async (user) => {
    if (!user) return;

    const userSnap = await getDoc(doc(db, "users", user.uid));
    if (!userSnap.exists()) return;

    const userData = userSnap.data();
    const isFaculty = userData.role === "faculty" || userData.role === "admin";

    // Show submission form only for students
    if (!isFaculty && studentCard) {
      studentCard.style.display = "block";
      btnSubmit.addEventListener("click", async () => {
        const cat = document.getElementById("grievance-category").value;
        const title = document.getElementById("grievance-title").value.trim();
        const desc = document.getElementById("grievance-desc").value.trim();

        if (!title || !desc) {
          alert("Please fill in both the title and details.");
          return;
        }

        btnSubmit.disabled = true;
        try {
          await addDoc(collection(db, "relations"), {
            studentUid: user.uid,
            studentName: `${userData.firstName} ${userData.lastName}`,
            category: cat,
            title: title,
            description: desc,
            status: "Pending Investigation",
            resolutionNotes: "",
            createdAt: serverTimestamp()
          });

          document.getElementById("grievance-title").value = "";
          document.getElementById("grievance-desc").value = "";
          alert("Grievance report submitted.");
        } catch (err) {
          console.error("Grievance submission error:", err);
          alert("Error: " + err.message);
        } finally {
          btnSubmit.disabled = false;
        }
      });
    }

    // Real-time synchronization for Grievances
    onSnapshot(collection(db, "relations"), (snapshot) => {
      if (!queueContainer) return;
      queueContainer.innerHTML = "";

      if (snapshot.empty) {
        queueContainer.innerHTML = `<p style="color: var(--text-secondary);">No grievance cases filed.</p>`;
        return;
      }

      snapshot.forEach((docSnap) => {
        const g = docSnap.data();
        const gid = docSnap.id;

        // Students only see their own tickets; instructors see all
        if (!isFaculty && g.studentUid !== user.uid) return;

        const card = document.createElement("div");
        card.className = "card";
        card.style.marginBottom = "14px";
        card.innerHTML = `
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <h4 style="margin: 0;">${g.title}</h4>
            <span class="status-badge ${g.status === 'Resolved' ? 'status-graded' : 'status-pending'}">${g.status}</span>
          </div>
          <p style="font-size: 12px; color: var(--text-secondary); margin: 6px 0;">Category: ${g.category} • Filed by: ${g.studentName}</p>
          <p style="font-size: 13.5px; line-height: 1.5;">${g.description}</p>
          ${g.resolutionNotes ? `<div class="feedback-box" style="margin-top: 10px;"><strong>Resolution:</strong> ${g.resolutionNotes}</div>` : ''}
          ${isFaculty && g.status !== 'Resolved' ? `
            <div style="margin-top: 12px; display: flex; gap: 8px;">
              <input type="text" id="res-note-${gid}" class="form-control" placeholder="Resolution determination notes...">
              <button class="btn btn-primary" id="btn-resolve-${gid}" style="white-space: nowrap;">Resolve</button>
            </div>
          ` : ''}
        `;

        if (isFaculty && g.status !== "Resolved") {
          card.querySelector(`#btn-resolve-${gid}`).addEventListener("click", async () => {
            const notes = document.getElementById(`res-note-${gid}`).value.trim();
            if (!notes) return alert("Please enter resolution notes.");

            await updateDoc(doc(db, "relations", gid), {
              status: "Resolved",
              resolutionNotes: notes
            });
          });
        }

        queueContainer.appendChild(card);
      });
    });
  });
});