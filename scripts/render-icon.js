// Renders the live shader once and saves it as the app icon (build/icon.png, 1024x1024).
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1120, height: 1120, show: false, webPreferences: { offscreen: true } });
  await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), { query: { style: 'tilted', px: '1024', icon: '1', bg: 'dark' } });
  await new Promise((r) => setTimeout(r, 2500));
  const dataUrl = await win.webContents.executeJavaScript(`(() => {
    const src = document.getElementById('hole');
    const c = document.createElement('canvas'); c.width = c.height = 1024;
    const x = c.getContext('2d');
    const pad = 100, s = 824, rad = 185;
    x.beginPath(); x.roundRect(pad, pad, s, s, rad); x.closePath();
    const g = x.createRadialGradient(512, 512, 40, 512, 512, 600);
    g.addColorStop(0, '#0b0f24'); g.addColorStop(1, '#020309');
    x.fillStyle = g; x.fill(); x.save(); x.clip();
    const k = 1.25 * s; x.drawImage(src, 512 - k / 2, 512 - k / 2, k, k);
    x.restore();
    x.lineWidth = 3; x.strokeStyle = 'rgba(140,170,255,0.18)'; x.stroke();
    return c.toDataURL('image/png');
  })()`);
  fs.writeFileSync(path.join(__dirname, '..', 'build', 'icon.png'), Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log('icon written');
  app.quit();
});
