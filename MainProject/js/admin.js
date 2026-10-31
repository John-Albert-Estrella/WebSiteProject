import { db } from "./firebase-init.js";
import { enforceAuth } from "./auth-guard.js";
import { 
  collection, 
  getDocs, 
  doc, 
  deleteDoc 
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// Restrict this page strictly to users with the 'admin' role
enforceAuth(["admin"]);

const tableBody = document.getElementById("users-table-body");
const countTotal = document.getElementById("count-total");
const countStudents = document.getElementById("count-students");
const countFaculty = document.getElementById("count-faculty");

async function loadSystemUsers() {
  try {
    const querySnapshot = await getDocs(collection(db, "users"));
    tableBody.innerHTML = "";

    let total = 0;
    let students = 0;
    let faculty = 0;

    querySnapshot.forEach((documentSnap) => {
      const u = documentSnap.data();
      const uid = documentSnap.id;
      total++;

      if (u.role === "student") students++;
      if (u.role === "faculty") faculty++;

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><strong>${u.firstName || ""} ${u.lastName || ""}</strong></td>
        <td>${u.email}</td>
        <td><span class="status-badge ${u.role === 'faculty' ? 'status-pending' : 'status-graded'}">${u.role}</span></td>
        <td>${u.roomCode || u.activeRoomCode || "None"}</td>
        <td>
          <button class="btn btn-reject" data-uid="${uid}" style="font-size: 11px; padding: 4px 8px;">Delete</button>
        </td>
      `;

      tr.querySelector("button").addEventListener("click", () => deleteUserRecord(uid));
      tableBody.appendChild(tr);
    });

    countTotal.textContent = total;
    countStudents.textContent = students;
    countFaculty.textContent = faculty;

  } catch (error) {
    console.error("Error loading users:", error);
    tableBody.innerHTML = `<tr><td colspan="5" style="color:red; text-align:center;">Permission Denied or Error loading data.</td></tr>`;
  }
}

async function deleteUserRecord(uid) {
  if (!confirm("Are you sure you want to permanently delete this user document?")) return;

  try {
    await deleteDoc(doc(db, "users", uid));
    await loadSystemUsers();
  } catch (error) {
    alert("Could not delete user: " + error.message);
  }
}

document.addEventListener("DOMContentLoaded", loadSystemUsers);