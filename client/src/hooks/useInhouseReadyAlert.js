import {useEffect} from 'react';

// Use the existing activity feed: no notification permission or extra connection.
export function useInhouseReadyAlert(readyCheck) {
  const gameId = readyCheck?.gameId, deadline = readyCheck?.deadline;
  useEffect(() => {
    const remaining = deadline - Date.now();
    if (!gameId || !(remaining > 0)) return;
    const title = document.title, originalIcon = document.querySelector('link[rel~="icon"]');
    const icon = document.createElement('link'), canvas = document.createElement('canvas');
    canvas.width = 32; canvas.height = 32;
    const context = canvas.getContext('2d');
    icon.rel = 'icon'; icon.type = 'image/png'; icon.sizes = '32x32';
    icon.dataset.inhouseReady = 'true';
    const image = new Image();
    let active = true, lit = true;
    function paint() {
      if (!active || !context) return;
      context.clearRect(0, 0, 32, 32);
      if (image.complete && image.naturalWidth) context.drawImage(image, 0, 0, 32, 32);
      if (lit) {
        context.beginPath(); context.arc(25, 7, 6, 0, Math.PI * 2);
        context.fillStyle = '#ef4444'; context.fill();
        context.lineWidth = 2; context.strokeStyle = '#ffffff'; context.stroke();
      }
      icon.href = lit || !originalIcon ? canvas.toDataURL('image/png') : originalIcon.href;
    }
    image.onload = paint;
    if (originalIcon) image.src = originalIcon.href;
    paint(); document.head.appendChild(icon);
    document.title = `🔴 Inhouse ready — ${title}`;
    const timer = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? null
      : window.setInterval(() => {lit = !lit; paint();}, 750);
    function clear() {
      active = false; image.onload = null; window.clearInterval(timer);
      icon.remove(); document.title = title;
    }
    const expiry = window.setTimeout(clear, remaining);
    return () => {window.clearTimeout(expiry); clear();};
  }, [gameId, deadline]);
}
