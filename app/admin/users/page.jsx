"use client";
import { useEffect, useState, useRef } from "react";
import { supabase } from "../../lib/supabaseClient";
import { usePathname } from "next/navigation";

const PLANS = [
  "free",
  "veo_lifetime",
  "veo_sora_unlimited",
  "monthly",
  "admin",
];

export default function AdminUsersPage() {
  const [items, setItems] = useState([]);
  const [secret, setSecret] = useState("");
  const [status, setStatus] = useState("");
  const [showUserMenu, setShowUserMenu] = useState(false);
  const userMenuRef = useRef(null);
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [detailUser, setDetailUser] = useState(null);
  const [search, setSearch] = useState("");
  const [filterPlan, setFilterPlan] = useState("all");
  const [credits, setCredits] = useState(null);
  const [creditLoading, setCreditLoading] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    try {
      document.title = "Manage Users | Fokus AI";
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
    (async () => {
      try {
        const s = localStorage.getItem("adminSecret") || "";
        if (s) {
          setSecret(s);
          await loadUsers(s);
        }
      } catch (_) {}
    })();
    (async () => {
      try {
        setCreditLoading(true);
        const resp = await fetch("/api/me/credits");
        const data = await resp.json();
        if (resp.ok && data && typeof data.balance !== "undefined") {
          setCredits(Number(data.balance || 0));
        } else {
          setCredits(null);
        }
      } catch (_) {
        setCredits(null);
      } finally {
        setCreditLoading(false);
      }
    })();
  }, []);

  const loadUsers = async (sec) => {
    try {
      setStatus("Memuat...");
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = String(session?.access_token || "");
      const resp = await fetch("/api/admin/users", {
        headers: {
          "x-admin-secret": sec || secret,
          Authorization: `Bearer ${token}`,
        },
      });
      const data = await resp.json();
      if (!resp.ok) {
        setStatus(String(data?.error || "Gagal memuat"));
        return;
      }
      setItems(Array.isArray(data?.users) ? data.users : []);
      setStatus("");
    } catch (e) {
      setStatus(String(e?.message || e));
    }
  };

  const updatePlan = async (id, plan) => {
    try {
      setStatus("Menyimpan...");
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = String(session?.access_token || "");
      const resp = await fetch(`/api/admin/users/${id}/plan`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-secret": secret,
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ plan }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setStatus(String(data?.error || "Gagal menyimpan"));
        return;
      }
      setItems((prev) => prev.map((x) => (x.id === id ? data.user : x)));
      setStatus("Berhasil.");
    } catch (e) {
      setStatus(String(e?.message || e));
    }
  };

  const deleteUser = async (user) => {
    if (!user || !user.id) return;
    if (String(user.plan || "").toLowerCase() === "admin") {
      setStatus("Tidak dapat menghapus akun admin.");
      return;
    }
    const ok = window.confirm(
      `Hapus akun untuk ${user.email || "user"}? Tindakan ini tidak dapat dibatalkan.`
    );
    if (!ok) return;
    try {
      setStatus("Menghapus akun...");
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = String(session?.access_token || "");
      const resp = await fetch(`/api/admin/users/${user.id}`, {
        method: "DELETE",
        headers: {
          "x-admin-secret": secret,
          Authorization: `Bearer ${token}`,
        },
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        setStatus(String(data?.error || "Gagal menghapus akun"));
        return;
      }
      setItems((prev) => prev.filter((x) => x.id !== user.id));
      setDetailUser(null);
      setStatus("Akun dihapus.");
    } catch (e) {
      setStatus(String(e?.message || e));
    }
  };

  const formatExpiry = (u) => {
    const plan = String(u.plan || "").toLowerCase();
    const exp = u.plan_expiry;
    if (plan !== "monthly" || !exp) return "—";
    const now = Date.now();
    const diff = exp - now;
    if (diff <= 0) return "Expired";
    const days = Math.ceil(diff / (24 * 60 * 60 * 1000));
    return `${days} hari lagi`;
  };

  const filteredItems = items.filter((u) => {
    const q = search.trim().toLowerCase();
    if (q) {
      const email = String(u.email || "").toLowerCase();
      const name = String(u.full_name || "").toLowerCase();
      if (!email.includes(q) && !name.includes(q)) return false;
    }
    if (filterPlan !== "all") {
      const p = String(u.plan || "free").toLowerCase();
      if (p !== filterPlan) return false;
    }
    return true;
  });

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
            <h1 className="page-title">Admin Users</h1>
            <p className="page-subtitle">Kelola paket user.</p>
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
            title="Saldo kredit"
          >
            <span aria-hidden="true" style={{ fontSize: 18 }}>
              💳
            </span>
            <span style={{ color: "#f8fafc", fontWeight: 700, fontSize: 14 }}>
              {creditLoading
                ? "—"
                : credits === null
                ? "N/A"
                : credits.toLocaleString("id-ID")}
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
      <main style={{ flex: 1, padding: 24 }}>
        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            marginBottom: 12,
          }}
        >
          <input
            className="dropdown"
            type="password"
            placeholder="Admin Secret"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            style={{ maxWidth: 300 }}
          />
          <button
            className="btn primary"
            type="button"
            onClick={async () => {
              localStorage.setItem("adminSecret", secret);
              await loadUsers(secret);
            }}
          >
            Load Users
          </button>
          {status ? (
            <div className="feature-sub" style={{ marginLeft: 8 }}>
              {status}
            </div>
          ) : null}
        </div>
        <div
          className="admin-filters"
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            marginBottom: 16,
          }}
        >
          <input
            type="text"
            className="dropdown"
            placeholder="Cari email atau nama..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ maxWidth: 320 }}
          />
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              className="settings-help"
              style={{ fontSize: 12, whiteSpace: "nowrap" }}
            >
              Filter plan
            </span>
            <select
              className="dropdown"
              style={{ minWidth: 140 }}
              value={filterPlan}
              onChange={(e) => setFilterPlan(e.target.value)}
            >
              <option value="all">Semua plan</option>
              {PLANS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="admin-table-wrap">
          <table className="admin-table">
          <thead>
            <tr>
              <th
                style={{ textAlign: "left", color: "#f4d03f", fontWeight: 700 }}
              >
                Email
              </th>
              <th
                style={{ textAlign: "left", color: "#f4d03f", fontWeight: 700 }}
              >
                Nama
              </th>
              <th
                style={{ textAlign: "left", color: "#f4d03f", fontWeight: 700 }}
              >
                Plan
              </th>
              <th
                style={{ textAlign: "left", color: "#f4d03f", fontWeight: 700 }}
              >
                Expire
              </th>
              <th
                style={{ textAlign: "left", color: "#f4d03f", fontWeight: 700 }}
              >
                Aksi
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredItems.map((u) => (
              <tr key={u.id} className="admin-row">
                <td className="admin-cell primary">{u.email}</td>
                <td className="admin-cell">{u.full_name || "-"}</td>
                <td className="admin-cell">
                  <select
                    className="dropdown"
                    value={u.plan || "free"}
                    onChange={(e) => updatePlan(u.id, e.target.value)}
                  >
                    {PLANS.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                  <div className="admin-plan-tag">
                    {String(u.plan || "").toLowerCase() === "monthly"
                      ? formatExpiry(u)
                      : String(u.plan || "free")}
                  </div>
                </td>
                <td className="admin-cell">
                  <span className="admin-expiry">{formatExpiry(u)}</span>
                </td>
                <td className="admin-cell actions">
                  <button
                    className="btn ghost"
                    type="button"
                    onClick={() => setDetailUser(u)}
                  >
                    Detail
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
      {detailUser && (
        <div
          className="modal show"
          onClick={(e) => {
            if (e.target === e.currentTarget) setDetailUser(null);
          }}
        >
          <div className="modal-content" style={{ maxWidth: 520 }}>
            <div className="modal-header">
              <div style={{ fontWeight: 700, color: "#f4d03f" }}>
                Detail User
              </div>
              <button className="btn ghost" onClick={() => setDetailUser(null)}>
                Tutup
              </button>
            </div>
            <div
              className="modal-body"
              style={{ flexDirection: "column", gap: 12 }}
            >
              <div>
                <div style={{ fontSize: 12, color: "#9ca3af" }}>Email</div>
                <div style={{ fontWeight: 600 }}>{detailUser.email}</div>
              </div>
              <div style={{ display: "flex", gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, color: "#9ca3af" }}>Nama</div>
                  <div style={{ fontWeight: 600 }}>
                    {detailUser.full_name || "-"}
                  </div>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, color: "#9ca3af" }}>Plan</div>
                  <div style={{ fontWeight: 600 }}>{detailUser.plan}</div>
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: "#9ca3af" }}>
                  Status Expire
                </div>
                <div style={{ fontWeight: 600 }}>{formatExpiry(detailUser)}</div>
              </div>
              {(() => {
                const veo = Number(detailUser.veo_count || 0);
                const sora = Number(detailUser.sora2_count || 0);
                const img = Number(detailUser.image_count || 0);
                const max = Math.max(1, veo, sora, img);
                const pct = (v) => `${(v / max) * 100}%`;
                return (
                  <div style={{ marginTop: 4 }}>
                    <div style={{ fontSize: 12, color: "#9ca3af" }}>
                      Status Pemakaian
                    </div>
                    <div className="admin-usage-row">
                      <span>Veo</span>
                      <div className="admin-usage-bar">
                        <div
                          className="fill veo"
                          style={{ width: pct(veo) }}
                        />
                      </div>
                      <span className="count">{veo}</span>
                    </div>
                    <div className="admin-usage-row">
                      <span>Sora 2</span>
                      <div className="admin-usage-bar">
                        <div
                          className="fill sora"
                          style={{ width: pct(sora) }}
                        />
                      </div>
                      <span className="count">{sora}</span>
                    </div>
                    <div className="admin-usage-row">
                      <span>Image</span>
                      <div className="admin-usage-bar">
                        <div
                          className="fill image"
                          style={{ width: pct(img) }}
                        />
                      </div>
                      <span className="count">{img}</span>
                    </div>
                  </div>
                );
              })()}
            </div>
            <div
              className="modal-footer"
              style={{ justifyContent: "space-between", gap: 10 }}
            >
              <div
                className="settings-help"
                style={{ color: "#f97373", fontSize: 12 }}
              >
                Hapus akun akan menghapus data user dari sistem.
              </div>
              <button
                className="btn danger"
                type="button"
                onClick={() => deleteUser(detailUser)}
                disabled={
                  String(detailUser.plan || "").toLowerCase() === "admin"
                }
              >
                Delete Akun
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
