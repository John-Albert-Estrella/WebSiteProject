const activeUser = JSON.parse(localStorage.getItem('earist_user'));
const isRegisterPage = window.location.pathname.endsWith('register.html');

if (!activeUser && !isRegisterPage) {
  window.location.href = 'register.html';
}