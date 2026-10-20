// js/attendance.js — Cleaned Attendance Roll Call

document.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('attendance-roster-container');
  if (!container) return;

  // Retrieve enrolled students from localStorage (Defaults to EMPTY array)
  const currentClass = JSON.parse(localStorage.getItem('earist_active_class')) || { students: [] };

  renderRoster(currentClass.students || []);

  const exportBtn = document.getElementById('export-csv-btn');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => exportAttendanceCSV(currentClass.students || []));
  }
});

function renderRoster(students) {
  const container = document.getElementById('attendance-roster-container');
  
  if (!students || students.length === 0) {
    container.innerHTML = '<p class="sub-title" style="text-align: center; padding: 20px;">No students enrolled or joined yet.</p>';
    updateCounts([]);
    return;
  }

  container.innerHTML = students.map((s, index) => `
    <div class="student-row">
      <span>${s.id || '2026-REG'} • ${s.name}</span>
      <div>
        <button class="btn btn-sm ${s.status === 'Present' ? 'btn-gold' : ''}" onclick="updateStatus(${index}, 'Present')">Present</button>
        <button class="btn btn-sm ${s.status === 'Late' ? 'btn-gold' : ''}" onclick="updateStatus(${index}, 'Late')">Late</button>
        <button class="btn btn-sm ${s.status === 'Absent' ? 'btn-maroon' : ''}" onclick="updateStatus(${index}, 'Absent')">Absent</button>
      </div>
    </div>
  `).join('');
  
  updateCounts(students);
}

function updateStatus(index, newStatus) {
  const currentClass = JSON.parse(localStorage.getItem('earist_active_class'));
  if (currentClass && currentClass.students[index]) {
    currentClass.students[index].status = newStatus;
    localStorage.setItem('earist_active_class', JSON.stringify(currentClass));
    renderRoster(currentClass.students);
  }
}

function updateCounts(students) {
  const presentEl = document.getElementById('count-present');
  const lateEl = document.getElementById('count-late');
  const absentEl = document.getElementById('count-absent');

  if (presentEl) presentEl.textContent = students.filter(s => s.status === 'Present').length;
  if (lateEl) lateEl.textContent = students.filter(s => s.status === 'Late').length;
  if (absentEl) absentEl.textContent = students.filter(s => s.status === 'Absent').length;
}

function exportAttendanceCSV(students) {
  if (!students || students.length === 0) {
    alert("No student records available to export!");
    return;
  }

  let csvContent = "data:text/csv;charset=utf-8,Student ID,Name,Status\n";
  students.forEach(s => {
    csvContent += `${s.id || 'N/A'},${s.name},${s.status}\n`;
  });
  
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", "EARIST_Attendance_Report.csv");
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}