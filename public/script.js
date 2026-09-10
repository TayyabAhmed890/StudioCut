// Constants
const DAILY_LIMIT = 5;
const STORAGE_KEY_USAGE = 'studiocut_daily_usage';

const LOADING_STEPS = [
  "Analyzing image subject...",
  "Detecting subject edges...",
  "Removing background cleanly...",
  "Refining fine studio details..."
];
let loaderInterval = null;
let currentAbortController = null;

// Application State
let rawOriginalImage = null;
let bgRemovedImageObj = null;
let currentBgColor = 'transparent';
let currentRatio = 'original';

// DOM Elements
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const canvasStage = document.getElementById('canvasStage');
const canvasWrapper = document.getElementById('canvasWrapper');
const shimmerOverlay = document.getElementById('shimmerOverlay');
const bottomLoader = document.getElementById('bottomLoader');
const loaderMessage = document.getElementById('loaderMessage');
const controlPanel = document.getElementById('controlPanel');
const canvas = document.getElementById('outputCanvas');
const ctx = canvas.getContext('2d');
const resetBtn = document.getElementById('resetBtn');
const downloadBtn = document.getElementById('downloadBtn');
const customColorInput = document.getElementById('customColorInput');
const selectedHexLabel = document.getElementById('selectedHexLabel');
const usageText = document.getElementById('usageText');
const themeToggleBtn = document.getElementById('themeToggleBtn');

// Setup App
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  updateUsageDisplay();
});

// Theme Management
function initTheme() {
  const savedTheme = localStorage.getItem('studiocut_theme') || 'light';
  document.documentElement.setAttribute('data-theme', savedTheme);
  toggleThemeIcons(savedTheme);
}

if (themeToggleBtn) {
  themeToggleBtn.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    const nextTheme = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', nextTheme);
    localStorage.setItem('studiocut_theme', nextTheme);
    toggleThemeIcons(nextTheme);
  });
}

function toggleThemeIcons(theme) {
  const sunIcon = document.querySelector('.sun-icon');
  const moonIcon = document.querySelector('.moon-icon');
  if (!sunIcon || !moonIcon) return;
  
  if (theme === 'dark') {
    sunIcon.classList.remove('hidden');
    moonIcon.classList.add('hidden');
  } else {
    sunIcon.classList.add('hidden');
    moonIcon.classList.remove('hidden');
  }
}

// Credits & Usage Management (24h Reset Timer)
function getUsageData() {
  const raw = localStorage.getItem(STORAGE_KEY_USAGE);
  const now = Date.now();

  if (!raw) {
    const newRecord = { count: 0, resetTime: now + 24 * 60 * 60 * 1000 };
    localStorage.setItem(STORAGE_KEY_USAGE, JSON.stringify(newRecord));
    return newRecord;
  }

  const data = JSON.parse(raw);
  if (now > data.resetTime) {
    const resetRecord = { count: 0, resetTime: now + 24 * 60 * 60 * 1000 };
    localStorage.setItem(STORAGE_KEY_USAGE, JSON.stringify(resetRecord));
    return resetRecord;
  }
  return data;
}

function incrementUsage() {
  const data = getUsageData();
  data.count += 1;
  localStorage.setItem(STORAGE_KEY_USAGE, JSON.stringify(data));
  updateUsageDisplay();
}

function getFormattedTimeRemaining(resetTime) {
  const diffMs = resetTime - Date.now();
  if (diffMs <= 0) return "0h 0m";
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  return `${hours}h ${minutes}m`;
}

function updateUsageDisplay() {
  const data = getUsageData();
  const remaining = Math.max(0, DAILY_LIMIT - data.count);

  if (remaining === 0) {
    const timeStr = getFormattedTimeRemaining(data.resetTime);
    usageText.textContent = `0 Credits (Resets in ${timeStr})`;
    dropZone.classList.add('disabled');
  } else {
    usageText.textContent = `${remaining} / ${DAILY_LIMIT} Credits Left`;
    dropZone.classList.remove('disabled');
  }
}

// File Upload Handlers
dropZone.addEventListener('click', (e) => {
  if (e.target === fileInput) return;

  const usage = getUsageData();
  if (usage.count >= DAILY_LIMIT) {
    const timeStr = getFormattedTimeRemaining(usage.resetTime);
    showToast(`Credits exhausted! Please try again in ${timeStr}.`, 'error');
    return;
  }
  
  fileInput.click();
});

['dragenter', 'dragover'].forEach(e => {
  dropZone.addEventListener(e, (evt) => { 
    evt.preventDefault(); 
    dropZone.classList.add('drag-over'); 
  });
});

['dragleave', 'drop'].forEach(e => {
  dropZone.addEventListener(e, (evt) => { 
    evt.preventDefault(); 
    dropZone.classList.remove('drag-over'); 
  });
});

dropZone.addEventListener('drop', (e) => {
  if (e.dataTransfer.files.length > 0) {
    validateAndProcessFile(e.dataTransfer.files[0]);
  }
});

fileInput.addEventListener('change', (e) => {
  if (e.target.files.length > 0) {
    validateAndProcessFile(e.target.files[0]);
  }
});

resetBtn.addEventListener('click', resetWorkspace);
downloadBtn.addEventListener('click', downloadCanvasImage);

// Aspect Ratio Controls
document.querySelectorAll('.aspect-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    document.querySelectorAll('.aspect-btn').forEach(b => b.classList.remove('active'));
    const target = e.currentTarget;
    target.classList.add('active');
    
    currentRatio = target.getAttribute('data-ratio');

    if (currentRatio === 'passport') {
      currentBgColor = '#0055a5';
      updateColorUI('#0055a5');
      showToast('Passport mode enabled (Studio Blue)', 'info');
    }

    renderCanvas();
  });
});

// Color Swatch Handlers
document.querySelectorAll('.swatch').forEach(swatch => {
  swatch.addEventListener('click', (e) => {
    const color = e.currentTarget.getAttribute('data-color');
    updateColorUI(color);
    currentBgColor = color;
    renderCanvas();
  });
});

if (customColorInput) {
  customColorInput.addEventListener('input', (e) => {
    const color = e.target.value;
    updateColorUI(color);
    currentBgColor = color;
    renderCanvas();
  });
}

function updateColorUI(color) {
  if (selectedHexLabel) {
    selectedHexLabel.textContent = color.toUpperCase();
  }
  document.querySelectorAll('.swatch').forEach(s => {
    s.classList.toggle('active', s.getAttribute('data-color') === color);
  });
}

// Processing Workflow
async function validateAndProcessFile(file) {
  const usage = getUsageData();
  if (usage.count >= DAILY_LIMIT) {
    const timeStr = getFormattedTimeRemaining(usage.resetTime);
    showToast(`Daily limit reached. Resets in ${timeStr}.`, 'error');
    return;
  }

  const allowed = ['image/png', 'image/jpeg', 'image/webp'];
  if (!allowed.includes(file.type)) {
    showToast('Unsupported file type. Please upload PNG, JPG, or WEBP.', 'error');
    return;
  }

  if (file.size > 10 * 1024 * 1024) {
    showToast('File size is too big. Please select a photo under 10MB.', 'error');
    return;
  }

  if (currentAbortController) currentAbortController.abort();
  currentAbortController = new AbortController();

  rawOriginalImage = await loadImageFromFile(file);
  dropZone.classList.add('hidden');
  canvasStage.classList.remove('hidden');
  
  renderCanvas();
  processImageWorkflow(file, currentAbortController.signal);
}

// Fast Canvas Image Compressor
function compressImage(file, maxWidth = 1080) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (e) => {
      const img = new Image();
      img.src = e.target.result;
      img.onload = () => {
        const c = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }

        c.width = width;
        c.height = height;
        const ctxCanvas = c.getContext('2d');
        ctxCanvas.drawImage(img, 0, 0, width, height);

        c.toBlob((blob) => {
          resolve(new File([blob], file.name.replace(/\.[^/.]+$/, ".jpg"), { type: 'image/jpeg' }));
        }, 'image/jpeg', 0.75);
      };
    };
  });
}

async function processImageWorkflow(file, signal) {
  startLoadingUI();

  try {
    const compressedFile = await compressImage(file);
    const formData = new FormData();
    formData.append('image_file', compressedFile);

    const response = await fetch('/api/remove-bg', {
      method: 'POST',
      body: formData,
      signal: signal
    });

    if (!response.ok) {
      if (response.status === 402 || response.status === 429) {
        throw new Error('QUOTA_EXHAUSTED_MASKED');
      }
      throw new Error(`Server status: ${response.status}`);
    }

    const imageBlob = await response.blob();
    bgRemovedImageObj = await loadImageFromBlob(imageBlob);

    incrementUsage();

    stopLoadingUI();
    controlPanel.classList.remove('disabled');
    resetBtn.classList.remove('hidden');
    downloadBtn.disabled = false;

    renderCanvas();
    showToast('Background removed successfully!', 'info');
  } catch (err) {
    if (err.name === 'AbortError') return;

    stopLoadingUI();
    
    if (err.message === 'QUOTA_EXHAUSTED_MASKED') {
      showToast('Processing servers busy due to high demand. Try again shortly.', 'error');
    } else {
      showToast('Could not process image background. Please try again.', 'error');
    }

    resetWorkspace();
  }
}

// Canvas Rendering Logic
function renderCanvas() {
  const activeImage = bgRemovedImageObj || rawOriginalImage;
  if (!activeImage) return;

  let imgWidth = activeImage.naturalWidth;
  let imgHeight = activeImage.naturalHeight;
  
  let targetWidth = imgWidth;
  let targetHeight = imgHeight;

  if (currentRatio !== 'original') {
    let numericRatio = 1;
    if (currentRatio === '1:1') numericRatio = 1;
    if (currentRatio === '4:3') numericRatio = 4 / 3;
    if (currentRatio === '16:9') numericRatio = 16 / 9;

    const sourceAspect = imgWidth / imgHeight;
    
    if (sourceAspect > numericRatio) {
      targetWidth = imgWidth;
      targetHeight = imgWidth / numericRatio;
    } else {
      targetHeight = imgHeight;
      targetWidth = imgHeight * numericRatio;
    }
  }

  canvas.width = targetWidth;
  canvas.height = targetHeight;

  ctx.clearRect(0, 0, targetWidth, targetHeight);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  if (currentBgColor !== 'transparent') {
    ctx.fillStyle = currentBgColor;
    ctx.fillRect(0, 0, targetWidth, targetHeight);
  }

  const drawX = (targetWidth - imgWidth) / 2;
  const drawY = (targetHeight - imgHeight) / 2;
  
  ctx.drawImage(activeImage, drawX, drawY, imgWidth, imgHeight);
}

// Loader UI
function startLoadingUI() {
  canvasWrapper.classList.add('is-loading');
  shimmerOverlay.classList.remove('hidden');
  bottomLoader.classList.remove('hidden');
  
  let step = 0;
  loaderMessage.textContent = LOADING_STEPS[0];
  loaderInterval = setInterval(() => {
    step = (step + 1) % LOADING_STEPS.length;
    loaderMessage.textContent = LOADING_STEPS[step];
  }, 1300);
}

function stopLoadingUI() {
  clearInterval(loaderInterval);
  canvasWrapper.classList.remove('is-loading');
  shimmerOverlay.classList.add('hidden');
  bottomLoader.classList.add('hidden');
}

// Updated Download Function with Toast Notification
function downloadCanvasImage() {
  if (!canvas) return;

  showToast('Preparing your image download...', 'info');

  canvas.toBlob((blob) => {
    if (!blob) {
      showToast('Failed to generate image file.', 'error');
      return;
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `studiocut-${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast('Image downloaded successfully!', 'info');
    }, 500);

  }, 'image/png', 1.0);
}

function resetWorkspace() {
  if (currentAbortController) currentAbortController.abort();
  rawOriginalImage = null;
  bgRemovedImageObj = null;
  fileInput.value = '';
  canvasStage.classList.add('hidden');
  controlPanel.classList.add('disabled');
  resetBtn.classList.add('hidden');
  dropZone.classList.remove('hidden');
  downloadBtn.disabled = true;
  stopLoadingUI();
}

// Helpers
function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

function loadImageFromBlob(blob) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(blob);
  });
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}