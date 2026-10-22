// js/app.js

document.addEventListener('DOMContentLoaded', () => {
  const roleToggle = document.getElementById('role-toggle-checkbox');
  const labelFaculty = document.getElementById('label-faculty');
  const labelStudent = document.getElementById('label-student');
  const greeting = document.getElementById('dynamic-greeting');
  
  // Dashboard Text Elements
  const moduleSubtitle = document.getElementById('module-subtitle');

  // Listen for Role Toggle changes
  roleToggle.addEventListener('change', (e) => {
    const isStudent = e.target.checked;
    
    // Update Body Attribute (Useful for CSS styling later)
    document.body.setAttribute('data-role', isStudent ? 'student' : 'faculty');

    // Update Label Colors
    if (isStudent) {
      labelFaculty.classList.remove('active-faculty');
      labelStudent.classList.add('active-student');
      greeting.textContent = "Welcome, HR Student";
      
      // Update Dashboard Text for Student (From your image)
      moduleSubtitle.textContent = "View assignments, deadlines, scores, and feedback.";
    } else {
      labelFaculty.classList.add('active-faculty');
      labelStudent.classList.remove('active-student');
      greeting.textContent = "Welcome, Instructor";
      
      // Update Dashboard Text for Faculty (From your image)
      moduleSubtitle.textContent = "View classes, submissions, grades, and activity reports.";
    }
  });

});