// js/class-manager.js — Handles Class Creation & Joining Flow

document.addEventListener('DOMContentLoaded', () => {
  const activeUser = JSON.parse(localStorage.getItem('earist_user'));
  const currentClass = JSON.parse(localStorage.getItem('earist_active_class'));

  // Update UI elements across pages with active class info
  updateClassHeaderDisplay(currentClass);

  // Setup Join/Create Class Modal listeners if elements exist
  const joinBtn = document.getElementById('join-class-btn');
  if (joinBtn) {
    joinBtn.addEventListener('click', promptClassModal);
  }
});

// Prompt Professor to create or Student to join
function promptClassModal() {
  const activeUser = JSON.parse(localStorage.getItem('earist_user'));
  const isProfessor = activeUser && activeUser.role === 'professor';

  if (isProfessor) {
    const className = prompt("Enter Class Name (e.g., BSIT 3-A — Web Systems):");
    if (!className) return;

    // Generate random EARIST code (e.g., EAR-8921)
    const newCode = 'EAR-' + Math.floor(1000 + Math.random() * 9000);
    const classData = {
      code: newCode,
      title: className,
      instructor: activeUser.name || "Prof. Instructor",
      students: [],
      files: [],
      events: []
    };

    localStorage.setItem('earist_active_class', JSON.stringify(classData));
    alert(`Class Created! Shared Code: ${newCode}`);
    location.reload();
  } else {
    const enterCode = prompt("Enter 8-digit Class Code (e.g., EAR-8921):");
    if (!enterCode) return;

    const classData = JSON.parse(localStorage.getItem('earist_active_class')) || {
      code: enterCode.toUpperCase(),
      title: "Joined EARIST Course",
      instructor: "Faculty Instructor",
      students: []
    };

    // Add current user to student roster if not present
    if (activeUser && !classData.students.some(s => s.email === activeUser.email)) {
      classData.students.push({
        name: activeUser.name,
        email: activeUser.email || "student@earist.edu.ph",
        status: "Present"
      });
    }

    localStorage.setItem('earist_active_class', JSON.stringify(classData));
    alert(`Successfully joined class ${classData.code}!`);
    location.reload();
  }
}

function updateClassHeaderDisplay(classData) {
  const codeElements = document.querySelectorAll('.code-value');
  const titleElement = document.getElementById('display-class-title');
  const subtitleElement = document.getElementById('display-class-subtitle');

  if (classData) {
    codeElements.forEach(el => el.textContent = classData.code);
    if (titleElement) titleElement.textContent = classData.title;
    if (subtitleElement) subtitleElement.textContent = `Prof. ${classData.instructor} | First Semester`;
  }
}