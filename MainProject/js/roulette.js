// js/roulette.js — Cleaned Student Roulette

document.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('wheel-canvas');
  const spinBtn = document.getElementById('spin-btn');
  const winnerDisplay = document.getElementById('winner-display');

  if (!canvas || !spinBtn) return;

  const ctx = canvas.getContext('2d');
  
  // Retrieve enrolled students from localStorage (Defaults to EMPTY array)
  const activeClass = JSON.parse(localStorage.getItem('earist_active_class')) || { students: [] };
  let students = activeClass.students.map(s => s.name);

  // If roster is completely empty, display empty state on canvas
  if (students.length === 0) {
    drawEmptyWheel(ctx, canvas);
    winnerDisplay.textContent = "No active students enrolled";
    spinBtn.disabled = true;
    spinBtn.style.opacity = "0.5";
    return;
  }

  spinBtn.disabled = false;
  spinBtn.style.opacity = "1";

  const colors = ['#800000', '#DAA520', '#333333', '#8B0000', '#FFD700', '#555555'];
  let startAngle = 0;
  const arc = Math.PI / (students.length / 2);
  let spinTimeout = null;
  let spinAngleStart = 10;
  let spinTime = 0;
  let spinTimeTotal = 0;

  function drawWheel() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const outsideRadius = 140;
    const textRadius = 100;
    const insideRadius = 30;

    for (let i = 0; i < students.length; i++) {
      const angle = startAngle + i * arc;
      ctx.fillStyle = colors[i % colors.length];

      ctx.beginPath();
      ctx.arc(160, 160, outsideRadius, angle, angle + arc, false);
      ctx.arc(160, 160, insideRadius, angle + arc, angle, true);
      ctx.fill();

      ctx.save();
      ctx.fillStyle = "#ffffff";
      ctx.translate(
        160 + Math.cos(angle + arc / 2) * textRadius,
        160 + Math.sin(angle + arc / 2) * textRadius
      );
      ctx.rotate(angle + arc / 2 + Math.PI / 2);
      const text = students[i];
      ctx.fillText(text, -ctx.measureText(text).width / 2, 0);
      ctx.restore();
    }
  }

  function drawEmptyWheel(ctx, canvas) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#333333';
    ctx.beginPath();
    ctx.arc(160, 160, 140, 0, 2 * Math.PI);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Roster Empty', 160, 165);
  }

  function rotateWheel() {
    spinTime += 30;
    if (spinTime >= spinTimeTotal) {
      stopRotateWheel();
      return;
    }
    const spinAngle = spinAngleStart - easeOut(spinTime, 0, spinAngleStart, spinTimeTotal);
    startAngle += (spinAngle * Math.PI / 180);
    drawWheel();
    spinTimeout = setTimeout(rotateWheel, 30);
  }

  function stopRotateWheel() {
    clearTimeout(spinTimeout);
    const degrees = startAngle * 180 / Math.PI + 90;
    const arcd = arc * 180 / Math.PI;
    const index = Math.floor((360 - degrees % 360) / arcd);
    winnerDisplay.textContent = `Selected: ${students[index]}`;
  }

  function easeOut(t, b, c, d) {
    const ts = (t /= d) * t;
    const tc = ts * t;
    return b + c * (tc + -3 * ts + 3 * t);
  }

  spinBtn.addEventListener('click', () => {
    spinAngleStart = Math.random() * 10 + 10;
    spinTime = 0;
    spinTimeTotal = Math.random() * 3000 + 4000;
    rotateWheel();
  });

  drawWheel();
});