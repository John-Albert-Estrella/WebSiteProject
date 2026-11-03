import { db } from "./firebase-init.js";
import { initAuthGuard } from "./auth-guard.js";
import { 
  collection, 
  query, 
  where, 
  getDocs 
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

const metricStudents = document.getElementById("metric-students");
const metricSubmissions = document.getElementById("metric-submissions");
const metricTasks = document.getElementById("metric-tasks");
const metricGrievances = document.getElementById("metric-grievances");

async function calculateMetrics(classCode) {
  try {
    // 1. Enrolled Students
    const studentQ = classCode 
      ? query(collection(db, "users"), where("classroomCode", "==", classCode), where("role", "==", "student"))
      : query(collection(db, "users"), where("role", "==", "student"));
    const studentSnap = await getDocs(studentQ);
    if (metricStudents) metricStudents.textContent = studentSnap.size;

    // 2. Submissions
    const subQ = classCode 
      ? query(collection(db, "submissions"), where("classroomCode", "==", classCode))
      : query(collection(db, "submissions"));
    const subSnap = await getDocs(subQ);
    if (metricSubmissions) metricSubmissions.textContent = subSnap.size;

    // 3. Tasks
    const taskQ = classCode 
      ? query(collection(db, "tasks"), where("classroomCode", "==", classCode))
      : query(collection(db, "tasks"));
    const taskSnap = await getDocs(taskQ);
    if (metricTasks) metricTasks.textContent = taskSnap.size;

    // 4. Grievances
    const grQ = classCode 
      ? query(collection(db, "grievances"), where("classroomCode", "==", classCode))
      : query(collection(db, "grievances"));
    const grSnap = await getDocs(grQ);
    if (metricGrievances) metricGrievances.textContent = grSnap.size;

  } catch (err) {
    console.error("Error calculating analytics metrics:", err);
  }
}

// Unified Auth Guard
initAuthGuard({
  onReady: ({ userData }) => {
    const classCode = userData.classroomCode || "";
    calculateMetrics(classCode);
  }
});