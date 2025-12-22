#!/bin/bash

# 1. PENTING: Hapus lock file sisa crash/restart sebelumnya
# Tanpa ini, container akan error "Server is already active for display 99" saat restart
rm -f /tmp/.X99-lock

# 2. Start Xvfb (Virtual Display) di background
echo "📺 Starting Xvfb virtual display on :99..."
Xvfb :99 -screen 0 1280x900x24 -ac &

# 3. Tunggu Xvfb siap
sleep 2
echo "✅ Xvfb started. DISPLAY=$DISPLAY"

# 4. Start VNC Server (untuk remote access ke virtual display)
# -forever: jangan exit setelah disconnect
# -shared: allow multiple connections
# -nopw: tanpa password (set VNC_PASSWORD env untuk enable password)
echo "🖥️ Starting VNC server on port 5900..."
if [ -n "$VNC_PASSWORD" ]; then
    mkdir -p ~/.vnc
    x11vnc -storepasswd "$VNC_PASSWORD" ~/.vnc/passwd
    x11vnc -display :99 -forever -shared -rfbport 5900 -rfbauth ~/.vnc/passwd &
else
    x11vnc -display :99 -forever -shared -nopw -rfbport 5900 &
fi
sleep 1
echo "✅ VNC server started on port 5900"

# 5. Start noVNC (web-based VNC viewer)
# Akses via browser: http://your-domain:6080/vnc.html
echo "🌐 Starting noVNC web viewer on port 6080..."
/usr/share/novnc/utils/launch.sh --listen 6080 --vnc localhost:5900 &
sleep 1
echo "✅ noVNC started on port 6080"

# 6. Print access info
echo ""
echo "═══════════════════════════════════════════════════════════"
echo "🖥️  VNC ACCESS (untuk lihat browser):"
echo "    noVNC (Browser): http://YOUR_DOMAIN:6080/vnc.html"
echo "    VNC Client:      YOUR_DOMAIN:5900"
echo "═══════════════════════════════════════════════════════════"
echo ""

# 7. Start aplikasi
# Gunakan exec agar process node menggantikan shell (bagus untuk handling shutdown signal)
echo "🚀 Starting Node.js application..."
exec node server/index.js
