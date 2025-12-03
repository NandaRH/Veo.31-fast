"use client";
import { useEffect, useState, useRef } from "react";
import { supabase } from "../../lib/supabaseClient";
import { usePathname } from "next/navigation";

export default function AdminCreditsPage() {
  const [credits, setCredits] = useState({});
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [secret, setSecret] = useState("");
  const [showUserMenu, setShowUserMenu] = useState(false);
  const userMenuRef = useRef(null);
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const pathname = usePathname();

  const [toId, setToId] = useState("");
  const [fromId, setFromId] = useState("");
  const [amount, setAmount] = useState("");

  useEffect(() => {
    try {
      document.title = "Admin Credits | Fokus AI";
    } catch (_) {}
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session) {
          window.location.href = "/login";
          return;
        }
      } catch (_) {}
    })();
    try {
      const s = localStorage.getItem("adminSecret") || "";
      if (s) {
        setSecret(s);
        loadCredits(s);
      }
    } catch (_) {}
  }, []);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target)) {
        setShowUserMenu(false);
      }
    };
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") setShowLogoutModal(false);
    };
    if (showLogoutModal) document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [showLogoutModal]);

  const loadCredits = async (sec) => {
    try {
      setLoading(true);
      setStatus("Memuat saldo...");
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = String(session?.access_token || "");
      const resp = await fetch("/api/admin/credits", {
        headers: {
          "x-admin-secret": sec || secret,
          Authorization: `Bearer ${token}`,
        },
      });
      const data = await resp.json();
      if (!resp.ok) {
        setStatus(String(data?.error || "Gagal memuat kredit"));
        setCredits({});
        return;
      }
      setCredits(data.credits || {});
      setStatus("");
    } catch (e) {
      setStatus(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  };

  const submitTransfer = async () => {
    try {
      setStatus("Memproses...");
      const amt = Number(amount);
      if (!toId || !Number.isFinite(amt)) {
        setStatus("Isi tujuan dan jumlah yang valid");
        return;
      }
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = String(session?.access_token || "");
      const resp = await fetch("/api/admin/credits/transfer", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-secret": secret,
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          to: toId.trim(),
          from: fromId.trim() || undefined,
          amount: amt,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setStatus(String(data?.error || "Gagal transfer/topup"));
        return;
      }
      setStatus("Berhasil.");
      setAmount("");
      loadCredits(secret);
    } catch (e) {
      setStatus(String(e?.message || e));
    }
  };

  const rows = Object.entries(credits || {}).map(([uid, val]) => ({
    uid,
    balance: Number(val?.balance || 0),
  }));

  const totalCredits = rows.reduce((sum, r) => sum + (Number.isFinite(r.balance) ? r.balance : 0), 0);

  return (
    <div
      className="app-shell prompt-shell"
      style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}
    >
      <header className="page-header" style={{ position: "relative" }}>
        <div className="page-brand">
          <img src="/images/fokusAI.png" alt="FokusAI" className="brand-logo" />
          <div className="brand-text">
            <span className="page-badge">FokusAI Studio</span>
            <h1 className="page-title">Admin Credits</h1>
            <p className="page-subtitle">Kelola saldo kredit internal.</p>
          </div>
        </div>
        <div
          style={{ display: "flex", gap: 8, alignItems: "center" }}
          ref={userMenuRef}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "10px 12px",
              borderRadius: 12,
              background:
                "linear-gradient(135deg, rgba(255,215,0,0.16), rgba(255,215,0,0.08))",
              border: "1px solid rgba(255,215,0,0.25)",
              boxShadow: "0 0 16px rgba(255,215,0,0.12)",
              minWidth: 120,
              justifyContent: "center",
            }}
            title="Total kredit tercatat"
          >
            <span aria-hidden="true" style={{ fontSize: 18 }}>
              💳
            </span>
            <span style={{ color: "#f8fafc", fontWeight: 700, fontSize: 14 }}>
              {loading
                ? "—"
                : Number.isFinite(totalCredits)
                ? totalCredits.toLocaleString("id-ID")
                : "N/A"}
            </span>
          </div>
          <a
            href="/prompt-tunggal"
            className="settings-btn"
            title="Video Generator"
          >
            <span aria-hidden="true">🎬</span>
            <span className="sr-only">Video Generator</span>
          </a>
          <a
            href="/image-generator"
            className="settings-btn"
            title="Image Generator"
          >
            <span aria-hidden="true">🖼️</span>
            <span className="sr-only">Image Generator</span>
          </a>
          <a href="/sora2" className="settings-btn" title="Sora 2">
            <span aria-hidden="true">🎞️</span>
            <span className="sr-only">Sora 2</span>
          </a>
          <div className="user-menu">
            <button
              className="settings-btn user-btn"
              aria-haspopup="true"
              aria-expanded={showUserMenu ? "true" : "false"}
              title="Admin menu"
              onClick={(e) => {
                e.preventDefault();
                setShowUserMenu((v) => !v);
              }}
            >
              <span aria-hidden="true">👤</span>
              <span className="sr-only">Admin menu</span>
            </button>
            <div
              className={`user-menu-dropdown ${showUserMenu ? "show" : ""}`}
              hidden={!showUserMenu}
            >
              {pathname !== "/admin/dashboard" ? (
                <button
                  className="user-menu-item"
                  type="button"
                  onClick={() => {
                    window.location.href = "/admin/dashboard";
                    setShowUserMenu(false);
                  }}
                >
                  <span aria-hidden="true">🏛️</span>
                  <span>Admin Dashboard</span>
                </button>
              ) : null}
              {pathname !== "/admin/users" ? (
                <button
                  className="user-menu-item"
                  type="button"
                  onClick={() => {
                    window.location.href = "/admin/users";
                    setShowUserMenu(false);
                  }}
                >
                  <span aria-hidden="true">👥</span>
                  <span>Manage Users</span>
                </button>
              ) : null}
              {pathname !== "/admin/credits" ? (
                <button
                  className="user-menu-item"
                  type="button"
                  onClick={() => {
                    window.location.href = "/admin/credits";
                    setShowUserMenu(false);
                  }}
                >
                  <span aria-hidden="true">💳</span>
                  <span>Credits</span>
                </button>
              ) : null}
              <div className="user-menu-divider"></div>
              <button
                className="user-menu-item"
                type="button"
                onClick={() => {
                  setShowLogoutModal(true);
                  setShowUserMenu(false);
                }}
              >
                <span aria-hidden="true">🚪</span>
                <span>Logout</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      <main style={{ flex: 1, padding: 24, display: "flex", gap: 16, flexDirection: "column" }}>
        <div
          style={{
            display: "flex",
            gap: 12,
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <input
            className="dropdown"
            type="password"
            placeholder="Admin Secret"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            style={{ maxWidth: 260 }}
          />
          <button
            className="btn primary"
            type="button"
            onClick={async () => {
              localStorage.setItem("adminSecret", secret);
              await loadCredits(secret);
            }}
          >
            Refresh Credits
          </button>
          {status ? (
            <div className="feature-sub" style={{ marginLeft: 8 }}>
              {status}
            </div>
          ) : null}
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: 16,
          }}
        >
          <div
            className="card"
            style={{
              padding: 18,
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <div style={{ fontWeight: 700, color: "#f4d03f" }}>
              Transfer / Topup
            </div>
            <div className="feature-sub" style={{ fontSize: 13 }}>
              Isi <strong>To User ID</strong>, jumlah, dan opsional <strong>From User ID</strong> untuk memotong saldo sumber.
            </div>
            <input
              className="dropdown"
              placeholder="To User ID (target)"
              value={toId}
              onChange={(e) => setToId(e.target.value)}
            />
            <input
              className="dropdown"
              placeholder="From User ID (opsional)"
              value={fromId}
              onChange={(e) => setFromId(e.target.value)}
            />
            <input
              className="dropdown"
              type="number"
              placeholder="Amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <button className="btn primary" type="button" onClick={submitTransfer}>
              Kirim
            </button>
          </div>

          <div
            className="card"
            style={{
              padding: 18,
              display: "flex",
              flexDirection: "column",
              gap: 8,
              minHeight: 200,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontWeight: 700, color: "#f4d03f" }}>Saldo User</div>
              <div className="feature-sub" style={{ fontSize: 12 }}>
                Total:{" "}
                {loading
                  ? "—"
                  : Number.isFinite(totalCredits)
                  ? totalCredits.toLocaleString("id-ID")
                  : "N/A"}
              </div>
            </div>
            <div
              style={{
                maxHeight: 360,
                overflowY: "auto",
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              {loading ? (
                <div className="feature-sub">Memuat...</div>
              ) : rows.length === 0 ? (
                <div className="feature-sub">Belum ada saldo tersimpan.</div>
              ) : (
                rows.map((r) => (
                  <div
                    key={r.uid}
                    style={{
                      padding: 12,
                      borderRadius: 12,
                      background: "rgba(255,255,255,0.02)",
                      border: "1px solid rgba(255,255,255,0.06)",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    <div style={{ color: "#e2e8f0", wordBreak: "break-all", flex: 1 }}>
                      {r.uid}
                    </div>
                    <div
                      style={{
                        color: "#f8fafc",
                        fontWeight: 700,
                        minWidth: 80,
                        textAlign: "right",
                      }}
                    >
                      {Number.isFinite(r.balance)
                        ? r.balance.toLocaleString("id-ID")
                        : "0"}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </main>

      {showLogoutModal && (
        <div
          className="modal show"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowLogoutModal(false);
          }}
          style={{ backdropFilter: "blur(10px)" }}
        >
          <div className="modal-content" style={{ maxWidth: 420 }}>
            <div className="modal-header">
              <div style={{ fontWeight: 700, color: "#f4d03f" }}>
                Konfirmasi Logout
              </div>
              <button
                className="btn ghost"
                onClick={() => setShowLogoutModal(false)}
              >
                Tutup
              </button>
            </div>
            <div
              className="modal-body"
              style={{ flexDirection: "column", gap: 10 }}
            >
              <div style={{ color: "#e2e8f0", fontWeight: 600 }}>
                Apakah Anda yakin ingin logout?
              </div>
              <div style={{ color: "#94a3b8", fontSize: 14 }}>
                Sesi Anda akan diakhiri dan Anda akan kembali ke halaman login.
              </div>
            </div>
            <div
              className="modal-footer"
              style={{ justifyContent: "flex-end", gap: 10 }}
            >
              <button
                className="btn ghost"
                onClick={() => setShowLogoutModal(false)}
              >
                Batal
              </button>
              <button
                className="btn primary"
                onClick={() => {
                  (async () => {
                    try {
                      if (supabase) await supabase.auth.signOut();
                    } catch {}
                    try {
                      await fetch("/api/session/logout", { method: "POST" });
                    } catch (_) {}
                    try {
                      document.cookie = "plan=; path=/; max-age=0";
                      document.cookie = "uid=; path=/; max-age=0";
                      document.cookie = "email=; path=/; max-age=0";
                      document.cookie = "name=; path=/; max-age=0";
                      document.cookie = "username=; path=/; max-age=0";
                    } catch (_) {}
                    window.location.href = "/login";
                  })();
                }}
              >
                Ya, Logout
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
