// js/file-vault.js

document.addEventListener('DOMContentLoaded', () => {
  const fileInput = document.getElementById('file-upload-input');
  const grid = document.getElementById('file-repository-grid');
  if (!fileInput || !grid) return;

  // Load existing files
  const currentClass = JSON.parse(localStorage.getItem('earist_active_class')) || { files: [] };
  renderFiles(currentClass.files || []);

  fileInput.addEventListener('change', (e) => {
    const uploadedFiles = Array.from(e.target.files);
    
    uploadedFiles.forEach(file => {
      const fileData = {
        name: file.name,
        size: (file.size / (1024 * 1024)).toFixed(2) + ' MB',
        date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        type: file.name.split('.').pop().toUpperCase()
      };
      
      currentClass.files = currentClass.files || [];
      currentClass.files.push(fileData);
    });

    localStorage.setItem('earist_active_class', JSON.stringify(currentClass));
    renderFiles(currentClass.files);
  });
});

function renderFiles(files) {
  const grid = document.getElementById('file-repository-grid');
  if (!files || files.length === 0) {
    grid.innerHTML = '<p class="sub-title" style="text-align: center; grid-column: span 3; padding: 20px;">No files uploaded yet.</p>';
    return;
  }

  grid.innerHTML = files.map(f => `
    <div class="card file-card">
      <span class="file-icon">${f.type}</span>
      <h4>${f.name}</h4>
      <span class="file-size">${f.size} • Uploaded ${f.date}</span>
      <button class="btn btn-maroon btn-sm" onclick="alert('Downloading ${f.name}...')">Download</button>
    </div>
  `).join('');
}