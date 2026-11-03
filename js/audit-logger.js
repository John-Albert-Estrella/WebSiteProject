// js/audit-logger.js
import { db } from "./firebase-init.js";
import { collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

/**
 * Logs an event to the activity_logs collection for real-time analytics auditing.
 * @param {Object} params
 * @param {string} params.category - "Enrolment", "Deliverable", "Appraisal", "Relations", "System"
 * @param {string} params.details - Brief description of action taken
 * @param {string} params.classroomCode - Section code or "GLOBAL"
 * @param {string} [params.userEmail] - Email of the initiator
 */
export async function logActivity({ category, details, classroomCode = "GLOBAL", userEmail = "" }) {
  try {
    await addDoc(collection(db, "activity_logs"), {
      category,
      details,
      classroomCode: classroomCode || "GLOBAL",
      userEmail,
      timestamp: serverTimestamp()
    });
  } catch (err) {
    console.warn("Could not record activity log:", err);
  }
}