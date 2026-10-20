document.addEventListener('DOMContentLoaded', () => {
  // 1. Navigation Routing Logic
  const currentPage = window.location.pathname.split('/').pop() || 'index.html';
  const navButtons = document.querySelectorAll('.nav-btn');

  navButtons.forEach(button => {
    const pageTarget = button.getAttribute('data-page');
    if (pageTarget === currentPage) {
      button.classList.add('active');
    } else {
      button.classList.remove('active');
    }

    button.addEventListener('click', () => {
      window.location.href = pageTarget;
    });
  });

  // 2. Dark/Light Theme Switching Logic
  const themeToggleBtn = document.getElementById('theme-toggle');
  const currentTheme = localStorage.getItem('theme') || 'light';

  // Apply saved theme on page load
  document.documentElement.setAttribute('data-theme', currentTheme);
  updateToggleBtnText(currentTheme);

  if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', () => {
      let activeTheme = document.documentElement.getAttribute('data-theme');
      let newTheme = activeTheme === 'dark' ? 'light' : 'dark';

      document.documentElement.setAttribute('data-theme', newTheme);
      localStorage.setItem('theme', newTheme);
      updateToggleBtnText(newTheme);
    });
  }

  function updateToggleBtnText(theme) {
    if (themeToggleBtn) {
      themeToggleBtn.innerHTML = theme === 'dark' ? '☀️ Light Mode' : '🌙 Dark Mode';
    }
  }
});

// Display Registered User Profile in Navbar
const savedUser = JSON.parse(localStorage.getItem('earist_user'));
const profileBtn = document.getElementById('user-profile-btn');

if (savedUser && savedUser.isLoggedIn && profileBtn) {
  profileBtn.innerHTML = `👤 ${savedUser.name} (${savedUser.role})`;
  profileBtn.classList.remove('btn-maroon');
  profileBtn.classList.add('btn-gold');
}