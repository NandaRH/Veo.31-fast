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
echo "🌐 Starting noVNC web viewer on port 6080..."
/usr/share/novnc/utils/launch.sh --listen 6080 --vnc localhost:5900 &
sleep 1
echo "✅ noVNC started on port 6080"

# 6. Auto-download browser session from Google Drive (if SESSION_URL is set and folder empty)
if [ -n "$SESSION_URL" ]; then
    cd /app/browser-data
    # Check if browser-data is empty (no session yet)
    if [ ! -f "Default/Cookies" ] && [ ! -f "SingletonLock" ]; then
        echo "📥 Downloading browser session from Google Drive..."
        # For large files, Google Drive needs confirmation
        wget --no-check-certificate "$SESSION_URL" -O session.zip 2>/dev/null || \
        wget --no-check-certificate "${SESSION_URL}&confirm=yes" -O session.zip 2>/dev/null
        
        if [ -f "session.zip" ] && [ -s "session.zip" ]; then
            echo "📦 Extracting session..."
            unzip -o session.zip
            rm -f session.zip
            echo "✅ Session extracted successfully!"
            ls -la
        else
            echo "⚠️ Failed to download session. Will start fresh."
            rm -f session.zip
        fi
    else
        echo "✅ Browser session already exists, skipping download."
    fi
    cd /app
fi

# 7. Print access info
echo ""
echo "═══════════════════════════════════════════════════════════"
echo "🖥️  VNC ACCESS (untuk lihat browser):"
echo "    noVNC (Browser): http://YOUR_DOMAIN:6080/vnc.html"
echo "    VNC Client:      YOUR_DOMAIN:5900"
echo "═══════════════════════════════════════════════════════════"
echo ""

# 8. Start aplikasi
echo "🚀 Starting Node.js application..."
exec node server/index.js
