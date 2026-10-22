// js/portfolio.js — Handles grading and portfolio rendering

document.addEventListener('DOMContentLoaded', () => {
  renderPortfolio();
});

function renderPortfolio() {
  const data = getAimserData();
  const facultyQueue = document.getElementById('faculty-grading-queue');
  const studentVault = document.getElementById('student-portfolio-vault');
  
  if (!facultyQueue || !studentVault) return;

  // Clear current containers
  facultyQueue.innerHTML = '';
  studentVault.innerHTML = '';

  let pendingCount = 0;

  data.grades.forEach(item => {
    // 1. Render Faculty Cards (Only pending submissions)
    if (item.status === 'pending') {
      pendingCount++;
      facultyQueue.innerHTML += `
        <div class="grading-card">
          <div style="display: flex; justify-content: space-between; align-items: flex-start;">
            <div>
              <h4 style="font-size: 16px;">${item.title}</h4>
              <p style="font-size: 13px; color: var(--text-secondary);">Submitted by: ${item.student}</p>
            </div>
            <span class="status-badge status-pending">Pending</span>
          </div>
          
          <button class="btn-outline" style="width: fit-content; font-size: 13px;">📄 View Submission</button>
          
          <div class="grade-input-group">
            <input type="number" id="score-${item.id}" class="form-control" placeholder="0" min="0" max="100">
            <span style="font-weight: 600; color: var(--text-secondary);">/ 100</span>
          </div>
          
          <textarea id="feedback-${item.id}" class="form-control" placeholder="Write constructive feedback here..." style="min-height: 80px;"></textarea>
          <button class="btn-primary" onclick="submitGrade(${item.id})">Submit Grade & Feedback</button>
        </div>
      `;
    }

    // 2. Render Student Cards (Both graded and pending)
    if (item.status === 'graded') {
      studentVault.innerHTML += `
        <div class="portfolio-card" style="border-top: 4px solid var(--student-accent);">
          <div style="display: flex; justify-content: space-between; align-items: flex-start;">
            <div>
              <h4 style="font-size: 16px;">${item.title}</h4>
              <p style="font-size: 13px; color: var(--text-secondary);">Module: HR Simulator</p>
            </div>
            <span class="status-badge status-graded">Graded: ${item.score}/100</span>
          </div>
          <div class="feedback-box">"${item.feedback}"<br><br>- Prof. Instructor</div>
          <button class="btn-outline">Download Original File</button>
        </div>
      `;
    } else {
      studentVault.innerHTML += `
        <div class="portfolio-card">
          <div style="display: flex; justify-content: space-between; align-items: flex-start;">
            <div>
              <h4 style="font-size: 16px;">${item.title}</h4>
              <p style="font-size: 13px; color: var(--text-secondary);">Module: HR Simulator</p>
            </div>
            <span class="status-badge status-pending">Pending Review</span>
          </div>
          <p style="font-size: 14px; color: var(--text-secondary);">Awaiting faculty grading and feedback.</p>
          <button class="btn-outline">Download Original File</button>
        </div>
      `;
    }
  });

  // Handle empty queue state
  document.getElementById('queue-count').textContent = pendingCount;
  if (facultyQueue.innerHTML === '') {
    facultyQueue.innerHTML = '<p style="color: var(--text-secondary);">All caught up! No pending submissions to grade.</p>';
  }
}

// Function attached to the global window object so the HTML button can trigger it
window.submitGrade = function(id) {
  const scoreInput = document.getElementById(`score-${id}`).value;
  const feedbackInput = document.getElementById(`feedback-${id}`).value;

  if (!scoreInput || !feedbackInput) {
    alert("Please enter both a score and feedback before submitting.");
    return;
  }

  const data = getAimserData();
  const submission = data.grades.find(g => g.id === id);
  
  if (submission) {
    // Update the database
    submission.score = parseInt(scoreInput);
    submission.feedback = feedbackInput;
    submission.status = 'graded';
    
    // Save to LocalStorage and instantly refresh the UI
    saveAimserData(data);
    renderPortfolio(); 
  }
};