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

# 4. Start aplikasi
# Gunakan exec agar process node menggantikan shell (bagus untuk handling shutdown signal)
echo "🚀 Starting Node.js application..."
exec node server/index.js
