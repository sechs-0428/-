import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import {
  Activity,
  ArrowRight,
  BookOpen,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Download,
  FileText,
  FolderInput,
  HeartHandshake,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  Monitor,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Server,
  Settings2,
  ShieldCheck,
  TriangleAlert,
  Users,
  X,
} from "lucide-react";
import type {
  CarePlan,
  DesktopInfo,
  Preview,
  RestorePreview,
  Resident,
  Settings,
  State,
  User,
} from "./model";
import {
  api,
  downloadBackup,
  previewWorkbook,
  previewBackup,
  setToken,
} from "./api";
import {
  blankPlan,
  blankResident,
  compareRoom,
  dateLabel,
  exceedsCertification,
  localDate,
  localMonth,
  monthLabel,
  periodFor,
  wareki,
} from "./utils";
import Documents from "./documents";

type Page = "dashboard" | "residents" | "plans" | "documents" | "settings";
const pages: { key: Page; label: string; icon: typeof Users }[] = [
  { key: "dashboard", label: "ダッシュボード", icon: LayoutDashboard },
  { key: "residents", label: "利用者台帳", icon: Users },
  { key: "plans", label: "ケアプラン管理", icon: ClipboardCheck },
  { key: "documents", label: "帳票・印刷", icon: FileText },
  { key: "settings", label: "事業所設定", icon: Settings2 },
];
const errors = (error: unknown) =>
  error instanceof Error ? error.message : "操作に失敗しました。";
const isAdmin = (state: State | null) => state?.user.role === "admin";
type Notice = { text: string; error: boolean };
const NoticeContext = createContext<{ notice: Notice | null; dismiss: () => void }>({
  notice: null,
  dismiss: () => {},
});

function Button({
  children,
  onClick,
  kind = "outline",
  disabled = false,
  type = "button",
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  kind?: "outline" | "primary" | "quiet" | "danger";
  disabled?: boolean;
  type?: "button" | "submit";
  className?: string;
}) {
  return (
    <button
      type={type}
      className={`btn btn-${kind} ${className}`}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
function Empty({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <BookOpen size={36} />
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}
function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const { notice, dismiss } = useContext(NoticeContext);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    dismiss();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={onClose}
      className={`modal ${wide ? "modal-wide" : ""}`}
    >
      <div className="modal-heading">
        <div>
          <span className="eyebrow">CARE MANAGER</span>
          <h2>{title}</h2>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="閉じる">
          <X />
        </button>
      </div>
      {notice && (
        <div className={`modal-notice ${notice.error ? "modal-notice-error" : ""}`} role={notice.error ? "alert" : "status"}>
          {notice.error ? <TriangleAlert size={18} /> : <CheckCircle2 size={18} />}
          <span>{notice.text}</span>
          <button type="button" className="icon-button" aria-label="通知を閉じる" onClick={dismiss}><X size={16} /></button>
        </div>
      )}
      {children}
    </dialog>
  );
}

function Connection({
  onConfigured,
  onCancel,
}: {
  onConfigured: (info: DesktopInfo) => void;
  onCancel?: () => void;
}) {
  const [mode, setMode] = useState<"host" | "client">("host");
  const [share, setShare] = useState(true);
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await window.careDesktop!.configure({
        mode,
        share,
        port: 43180,
        serverUrl: mode === "client" ? address : undefined,
      });
      onConfigured(result);
    } catch (err) {
      setError(errors(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="welcome-screen">
      <div className="welcome-intro">
        <Brand />
        <span className="welcome-tag">事業所のケアを、ひとつの場所に。</span>
        <h1>
          Excelの管理表から、
          <br />
          毎日の業務へ。
        </h1>
        <p>
          認定期間、ケアプラン、会議のお知らせ。
          <br />
          必要な情報をつなぎ、事業所で共有します。
        </p>
        <div className="welcome-features">
          <span>
            <CheckCircle2 />
            利用者情報を一元管理
          </span>
          <span>
            <CheckCircle2 />
            帳票作成と同意の進捗管理
          </span>
          <span>
            <CheckCircle2 />
            複数PCで同じデータを共有
          </span>
        </div>
      </div>
      <form className="welcome-form" onSubmit={submit}>
        <span className="eyebrow">はじめに</span>
        <h2>このPCの使い方を選ぶ</h2>
        <p className="muted">事業所で1台を共有元に設定してください。</p>
        <button
          type="button"
          className={`connection-option ${mode === "host" ? "selected" : ""}`}
          onClick={() => setMode("host")}
        >
          <Server />
          <span>
            <strong>このPCを共有元にする</strong>
            <small>利用者データをこのPCに保存します</small>
          </span>
          {mode === "host" && <Check size={18} />}
        </button>
        <button
          type="button"
          className={`connection-option ${mode === "client" ? "selected" : ""}`}
          onClick={() => setMode("client")}
        >
          <Monitor />
          <span>
            <strong>事業所の共有元に接続する</strong>
            <small>ほかのPCに保存されたデータを利用します</small>
          </span>
          {mode === "client" && <Check size={18} />}
        </button>
        {mode === "host" ? (
          <div className="connection-detail">
            <label className="checkbox">
              <input
                type="checkbox"
                checked={share}
                onChange={(e) => setShare(e.target.checked)}
              />
              事業所内のほかのPCから接続を許可する
            </label>
            <p>共有元のアプリを起動している間、ほかのPCから利用できます。</p>
          </div>
        ) : (
          <Field
            label="共有元の接続先"
            hint="共有元の「事業所設定」に表示された接続先を入力"
          >
            <input
              required
              type="url"
              placeholder="http://192.168.1.10:43180"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          </Field>
        )}
        {error && (
          <p className="error-box" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" kind="primary" disabled={busy}>
          {busy ? (
            <LoaderCircle className="spin" size={18} />
          ) : (
            <ArrowRight size={18} />
          )}
          次へ
        </Button>
        {onCancel && <Button onClick={onCancel}>戻る</Button>}
      </form>
    </div>
  );
}
function Brand() {
  return (
    <div className="brand">
      <div className="brand-mark">
        <HeartHandshake size={23} />
      </div>
      <div>
        <strong>CareManager</strong>
        <small>ケアマネ業務管理</small>
      </div>
    </div>
  );
}
function Auth({
  configured,
  onLogin,
  info,
  onConnection,
  message,
}: {
  configured: boolean;
  onLogin: () => Promise<void>;
  info: DesktopInfo | null;
  onConnection: () => void;
  message?: string;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [facilityName, setFacilityName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const canSetup = !configured && info?.mode !== "client";
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const result = await api<{ token: string; user: User }>(
        canSetup ? "/api/setup" : "/api/login",
        "POST",
        {
          username,
          password,
          ...(canSetup ? { displayName, facilityName } : {}),
        },
      );
      setToken(result.token);
      await onLogin();
    } catch (err) {
      setError(errors(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={submit}>
        <Brand />
        <div className="auth-heading">
          <span className="eyebrow">
            {canSetup ? "WELCOME" : "WELCOME BACK"}
          </span>
          <h1>{canSetup ? "事業所を登録する" : "おかえりなさい"}</h1>
          <p className="muted">
            {canSetup
              ? "最初の管理者アカウントを作成します。"
              : "アカウントでログインしてください。"}
          </p>
        </div>
        {message && <p className="notice">{message}</p>}
        {!configured && !canSetup ? (
          <p className="notice">
            共有元PCで事業所の登録を完了してから、ログインしてください。
          </p>
        ) : (
          <>
            {canSetup && (
              <>
                <Field label="事業所名">
                  <input
                    required
                    maxLength={120}
                    value={facilityName}
                    onChange={(e) => setFacilityName(e.target.value)}
                    placeholder="事業所名を入力"
                  />
                </Field>
                <Field label="管理者の表示名">
                  <input
                    required
                    maxLength={80}
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="名前を入力"
                  />
                </Field>
              </>
            )}
            <Field label="ユーザー名">
              <input
                required
                autoComplete="username"
                maxLength={60}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="半角英数字"
              />
            </Field>
            <Field
              label="パスワード"
              hint={canSetup ? "10文字以上で設定してください。" : undefined}
            >
              <input
                required
                type="password"
                autoComplete={canSetup ? "new-password" : "current-password"}
                minLength={canSetup ? 10 : 1}
                maxLength={128}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            {error && (
              <p className="error-box" role="alert">
                {error}
              </p>
            )}
            <Button type="submit" kind="primary" disabled={busy}>
              {busy && <LoaderCircle className="spin" size={17} />}{" "}
              {canSetup ? "登録してはじめる" : "ログイン"}
              <ArrowRight size={17} />
            </Button>
          </>
        )}
        {window.careDesktop && (
          <button type="button" className="text-link" onClick={onConnection}>
            接続先を変更する
          </button>
        )}
        <p className="auth-footer">
          <ShieldCheck size={15} />
          事業所のデータは共有元PCに保存されます
        </p>
      </form>
    </div>
  );
}

export default function App() {
  const [state, setState] = useState<State | null>(null);
  const [info, setInfo] = useState<DesktopInfo | null>(null);
  const [boot, setBoot] = useState(true);
  const [configured, setConfigured] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [bootError, setBootError] = useState("");
  const [loginNotice, setLoginNotice] = useState("");
  const [page, setPage] = useState<Page>("dashboard");
  const [month, setMonth] = useState(localMonth());
  const [query, setQuery] = useState("");
  const [toast, setToast] = useState<{ text: string; error: boolean } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [residentDraft, setResidentDraft] = useState<Resident | null>(null);
  const [planDraft, setPlanDraft] = useState<CarePlan | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [restorePreview, setRestorePreview] = useState<RestorePreview | null>(
    null,
  );
  const restoreInput = useRef<HTMLInputElement>(null);
  const [batch, setBatch] = useState(false);
  const [archive, setArchive] = useState<Resident | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [residentFilter, setResidentFilter] = useState("all");
  const [planFilter, setPlanFilter] = useState("all");
  const importInput = useRef<HTMLInputElement>(null);
  const notify = useCallback((text: string, error = false) => {
    setToast({ text, error });
  }, []);
  const refresh = useCallback(async () => {
    const result = await api<State>("/api/state");
    setState({
      ...result,
      users: result.users || [],
      audit: result.audit || [],
    });
    return result;
  }, []);
  const initialize = useCallback(async () => {
    setBoot(true);
    setBootError("");
    try {
      if (window.careDesktop) {
        const current = await window.careDesktop.info();
        setInfo(current);
        if (current.mode === "unconfigured") {
          setConnecting(true);
          return;
        }
      }
      const health = await api<{ configured: boolean }>("/api/health");
      setConfigured(health.configured);
    } catch (err) {
      setBootError(errors(err));
    } finally {
      setBoot(false);
    }
  }, []);
  useEffect(() => {
    void initialize();
  }, [initialize]);
  useEffect(() => {
    if (!state) return;
    const timer = setInterval(() => {
      if (!document.hidden) void refresh().catch(() => {});
    }, 20000);
    return () => clearInterval(timer);
  }, [!!state, refresh]);
  useEffect(() => {
    if (!toast) return;
    const timeout = setTimeout(
      () => setToast(null),
      toast.error ? 12000 : 6000,
    );
    return () => clearTimeout(timeout);
  }, [toast]);
  const execute = async (
    action: () => Promise<unknown>,
    success: string,
    done?: () => void,
  ) => {
    setBusy(true);
    try {
      await action();
      await refresh();
      notify(success);
      done?.();
      return true;
    } catch (err) {
      notify(errors(err), true);
      if (errors(err).includes("他の職員")) await refresh().catch(() => {});
      return false;
    } finally {
      setBusy(false);
    }
  };
  const login = async () => {
    const result = await refresh();
    setConfigured(true);
    setLoginNotice("");
    setMonth(result.settings.targetMonth || localMonth());
  };
  const logout = async (notifyServer = true) => {
    try {
      if (notifyServer)
      await api("/api/logout", "POST", {});
    } catch {
      /* Clear local session even if connection was lost. */
    }
    setToken("");
    setState(null);
    setResidentDraft(null);
    setPlanDraft(null);
    setPreview(null);
    setPage("dashboard");
  };
  const handleImport = async (file: File) => {
    setBusy(true);
    try {
      setPreview(await previewWorkbook(file));
    } catch (err) {
      notify(errors(err), true);
    } finally {
      setBusy(false);
      if (importInput.current) importInput.current.value = "";
    }
  };
  const handleRestore = async (file: File) => {
    setBusy(true);
    try {
      setRestorePreview(await previewBackup(file));
    } catch (err) {
      notify(errors(err), true);
    } finally {
      setBusy(false);
      if (restoreInput.current) restoreInput.current.value = "";
    }
  };
  const choosePage = (next: Page) => {
    setPage(next);
    setQuery("");
    setResidentFilter("all");
    setPlanFilter("all");
  };
  const handleConfigured = async (current: DesktopInfo) => {
    setInfo(current);
    setConnecting(false);
    await initialize();
  };
  const saveResident = async (e: FormEvent) => {
    e.preventDefault();
    if (!residentDraft) return;
    await execute(
      () =>
        api(
          residentDraft.id
            ? `/api/residents/${residentDraft.id}`
            : "/api/residents",
          residentDraft.id ? "PUT" : "POST",
          {
            resident: residentDraft,
            ...(residentDraft.id ? { revision: residentDraft.revision } : {}),
          },
        ),
      "利用者情報を保存しました。",
      () => setResidentDraft(null),
    );
  };
  const savePlan = async (e: FormEvent) => {
    e.preventDefault();
    if (!planDraft) return;
    await execute(
      () =>
        api(
          planDraft.id ? `/api/plans/${planDraft.id}` : "/api/plans",
          planDraft.id ? "PUT" : "POST",
          {
            plan: planDraft,
            ...(planDraft.id ? { revision: planDraft.revision } : {}),
          },
        ),
      "ケアプランを保存しました。",
      () => setPlanDraft(null),
    );
  };
  const updateConsent = async (
    plan: CarePlan,
    consentStatus: CarePlan["consentStatus"],
  ) =>
    execute(
      () =>
        api(`/api/plans/${plan.id}`, "PUT", {
          plan: { ...plan, consentStatus },
          revision: plan.revision,
        }),
      "同意書の進捗を更新しました。",
    );
  const saveSettings = async (settings: Settings): Promise<Settings | null> => {
    setBusy(true);
    try {
      const result = await api<{ settings: Settings }>("/api/settings", "PUT", {
        settings,
        revision: settings.revision,
      });
      await refresh();
      notify("事業所設定を保存しました。");
      return result.settings;
    } catch (err) {
      notify(errors(err), true);
      if (errors(err).includes("他の職員")) await refresh().catch(() => {});
      return null;
    } finally {
      setBusy(false);
    }
  };
  const handleUserUpdate = async (id: string, body: unknown) => {
    setBusy(true);
    try {
      await api(`/api/users/${id}`, "PUT", body);
      const fields = body as { password?: string; disabled?: boolean };
      if (id === state?.user.id && (fields.password || fields.disabled)) {
        // Password changes already revoke every session on the server.
        await logout(false);
        setLoginNotice(
          "アカウントを更新しました。新しいパスワードで再ログインしてください。",
        );
      } else {
        await refresh();
        notify("職員アカウントを更新しました。");
      }
      return true;
    } catch (err) {
      notify(errors(err), true);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const recordPrinted = async (ids: string[]) => {
    setBusy(true);
    try {
      let saved = 0;
      for (const id of ids) {
        const plan = state?.plans.find((p) => p.id === id);
        if (plan) {
          await api(`/api/plans/${id}`, "PUT", {
            plan: { ...plan, printDate: localDate() },
            revision: plan.revision,
          });
          saved++;
        }
      }
      await refresh();
      notify(`${saved}件の印刷日を記録しました。`);
    } catch (err) {
      await refresh().catch(() => {});
      notify(`一部の記録を更新できませんでした。${errors(err)}`, true);
      throw err;
    } finally {
      setBusy(false);
    }
  };
  if (boot)
    return (
      <div className="loading-screen">
        <Brand />
        <LoaderCircle className="spin" />
        <p>接続を確認しています…</p>
      </div>
    );
  if (connecting && window.careDesktop)
    return (
      <Connection
        onConfigured={(current) => void handleConfigured(current)}
        onCancel={
          info?.mode !== "unconfigured" ? () => setConnecting(false) : undefined
        }
      />
    );
  if (bootError)
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <Brand />
          <h2>共有元に接続できません</h2>
          <p className="error-box">{bootError}</p>
          <p className="muted">
            共有元PCのアプリが起動しているか、接続先とネットワークを確認してください。
          </p>
          <Button kind="primary" onClick={() => void initialize()}>
            <RefreshCw size={17} />
            再接続
          </Button>
          {window.careDesktop && (
            <Button onClick={() => setConnecting(true)}>接続先を変更</Button>
          )}
        </div>
      </div>
    );
  if (!state)
    return (
      <Auth
        configured={configured}
        onLogin={login}
        info={info}
        onConnection={() => setConnecting(true)}
        message={loginNotice}
      />
    );
  const active = state.residents
    .filter((r) => r.status === "active")
    .sort(compareRoom);
  const monthPlans = state.plans.filter((p) => p.targetMonth === month);
  const due = active.filter((r) => r.creationMonth === month);
  const alerts = active.filter(exceedsCertification);
  const pending = monthPlans.filter((p) => p.consentStatus !== "回収済");
  const residentMap = new Map(state.residents.map((r) => [r.id, r]));
  const search = (values: string[]) =>
    !query ||
    values.some((v) =>
      v?.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
    );
  const visibleResidents = state.residents
    .filter(
      (r) =>
        (showArchived || r.status === "active") &&
        (residentFilter === "all" ||
          (residentFilter === "due" && r.creationMonth === month) ||
          (residentFilter === "alert" && exceedsCertification(r))) &&
        search([r.name, r.chartNumber, r.room, r.careManager]),
    )
    .sort(compareRoom);
  const visiblePlans = monthPlans
    .filter(
      (p) =>
        (planFilter === "all" ||
          (planFilter === "pending" && p.consentStatus !== "回収済") ||
          (planFilter === "round1" && p.meetingRound === 1) ||
          (planFilter === "round2" && p.meetingRound === 2)) &&
        search([
          residentMap.get(p.residentId)?.name || "",
          residentMap.get(p.residentId)?.chartNumber || "",
          residentMap.get(p.residentId)?.room || "",
          p.creator,
          p.careManager,
        ]),
    )
    .sort(
      (a, b) =>
        a.meetingRound - b.meetingRound ||
        (residentMap.get(a.residentId) && residentMap.get(b.residentId)
          ? compareRoom(
              residentMap.get(a.residentId)!,
              residentMap.get(b.residentId)!,
            )
          : 0),
    );
  return (
    <NoticeContext.Provider value={{ notice: toast, dismiss: () => setToast(null) }}>
    <div className="app-shell">
      <aside className="sidebar">
        <Brand />
        <div className="office-label">
          <span className="office-avatar">
            {state.settings.facilityName.slice(0, 1) || "事"}
          </span>
          <div>
            <strong>{state.settings.facilityName || "事業所"}</strong>
            <small>
              {state.settings.floor
                ? `${state.settings.floor}フロア`
                : "ケアマネ業務管理"}
            </small>
          </div>
        </div>
        <div className="nav-label">ワークスペース</div>
        <nav>
          {pages.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              className={page === key ? "active" : ""}
              onClick={() => choosePage(key)}
            >
              <Icon size={20} />
              <span>{label}</span>
              {key === "plans" && pending.length > 0 && (
                <span className="nav-count">{pending.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <Activity size={17} />
            <div>
              <strong>
                {info?.mode === "client"
                  ? "共有元に接続中"
                  : info?.share
                    ? "このPCで共有中"
                    : "このPCに保存"}
              </strong>
              <small>データは事業所で管理</small>
            </div>
          </div>
          <div className="user-chip">
            <div className="user-avatar">
              {state.user.displayName.slice(0, 1)}
            </div>
            <div>
              <strong>{state.user.displayName}</strong>
              <small>
                {state.user.role === "admin" ? "管理者" : "スタッフ"}
              </small>
            </div>
            <button
              className="icon-button"
              aria-label="ログアウト"
              onClick={() => void logout()}
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            ワークスペース
            <ChevronRight size={14} />
            <strong>{pages.find((p) => p.key === page)?.label}</strong>
          </div>
          <div className="topbar-right">
            <button
              className="icon-button"
              aria-label="最新データを取得"
              title="最新データを取得"
              onClick={() =>
                void refresh()
                  .then(() => notify("最新のデータを取得しました。"))
                  .catch((err) => notify(errors(err), true))
              }
            >
              <RefreshCw size={16} />
            </button>
            <span className="connection-status">
              <i />
              {info?.mode === "client"
                ? "事業所の共有データ"
                : "保存先に接続済み"}
            </span>
            <span className="today">
              {new Intl.DateTimeFormat("ja-JP", {
                month: "long",
                day: "numeric",
                weekday: "short",
                timeZone: "Asia/Tokyo",
              }).format(new Date())}
            </span>
          </div>
        </header>
        <main className={`main-content page-${page}`}>
          <div className="page-heading">
            <div>
              <span className="eyebrow">
                {page === "dashboard"
                  ? "OVERVIEW"
                  : page === "residents"
                    ? "RESIDENTS"
                    : page === "plans"
                      ? "CARE PLANS"
                      : page === "documents"
                        ? "DOCUMENTS"
                        : "WORKSPACE SETTINGS"}
              </span>
              <h1>{pages.find((p) => p.key === page)?.label}</h1>
              <p>
                {page === "dashboard"
                  ? "今日の業務と、確認が必要な情報をひと目で。"
                  : page === "residents"
                    ? "認定期間とケアプランの期間を、利用者ごとに管理します。"
                    : page === "plans"
                      ? "作成から会議、同意書の回収までをつなぎます。"
                      : page === "documents"
                        ? "会議通知と同意書を確認して、印刷・PDF保存できます。"
                        : "事業所の基本情報、職員、共有とバックアップを管理します。"}
              </p>
            </div>
            <div className="heading-actions">
              {page !== "settings" && (
                <label className="month-picker">
                  <CalendarDays size={17} />
                  <input
                    aria-label="対象年月"
                    type="month"
                    value={month}
                    onChange={(e) => {
                      if (e.target.value) setMonth(e.target.value);
                    }}
                  />
                </label>
              )}
              {page === "residents" && (
                <Button
                  kind="primary"
                  onClick={() => setResidentDraft(blankResident())}
                >
                  <Plus size={17} />
                  利用者を登録
                </Button>
              )}
              {page === "plans" && (
                <Button
                  kind="primary"
                  onClick={() => setPlanDraft(blankPlan("", month))}
                  disabled={!active.length}
                >
                  <Plus size={17} />
                  プランを追加
                </Button>
              )}
            </div>
          </div>
          {page === "dashboard" && (
            <>
              <div className="overview-banner">
                <div>
                  <span className="subtle-tag">{monthLabel(month)}の業務</span>
                  <h2>ケアの準備を、着実に。</h2>
                  <p>
                    今月の作成対象は <strong>{due.length}名</strong>
                    。同意書の未回収は <strong>{pending.length}件</strong>{" "}
                    です。
                  </p>
                  <button
                    className="banner-link"
                    onClick={() => choosePage("plans")}
                  >
                    今月のケアプランを確認
                    <ArrowRight size={16} />
                  </button>
                </div>
                <div className="banner-illustration">
                  <div className="illustration-card">
                    <ClipboardCheck size={32} />
                    <span />
                    <span />
                    <div>
                      <Check size={14} />
                      ケアプラン
                    </div>
                  </div>
                  <div className="illustration-circle">
                    <HeartHandshake size={38} />
                  </div>
                </div>
              </div>
              <div className="metrics">
                <Metric
                  icon={Users}
                  label="登録利用者"
                  value={active.length}
                  unit="名"
                  note="利用中の方"
                  onClick={() => choosePage("residents")}
                />
                <Metric
                  icon={CalendarDays}
                  label="今月の作成対象"
                  value={due.length}
                  unit="名"
                  note={monthLabel(month)}
                  onClick={() => {
                    choosePage("residents");
                    setResidentFilter("due");
                  }}
                />
                <Metric
                  icon={ClipboardCheck}
                  label="同意書の未回収"
                  value={pending.length}
                  unit="件"
                  note={`回収済み ${monthPlans.length - pending.length}件`}
                  onClick={() => {
                    choosePage("plans");
                    setPlanFilter("pending");
                  }}
                />
                <Metric
                  icon={TriangleAlert}
                  label="認定期間の確認"
                  value={alerts.length}
                  unit="名"
                  note="プラン満了が認定期限以上"
                  warning
                  onClick={() => {
                    choosePage("residents");
                    setResidentFilter("alert");
                  }}
                />
              </div>
              <div className="dashboard-columns">
                <section className="card">
                  <div className="section-heading">
                    <div>
                      <h2>確認が必要な利用者</h2>
                      <p>ケアプランの満了と認定期限を照合</p>
                    </div>
                    <button
                      className="text-link"
                      onClick={() => {
                        choosePage("residents");
                        setResidentFilter("alert");
                      }}
                    >
                      すべて見る
                      <ArrowRight size={14} />
                    </button>
                  </div>
                  {alerts.length ? (
                    <div className="attention-list">
                      {alerts.slice(0, 5).map((r) => (
                        <button
                          className="attention-row"
                          key={r.id}
                          onClick={() => setResidentDraft(r)}
                        >
                          <div className="resident-initial">
                            {r.name.slice(0, 1)}
                          </div>
                          <div className="attention-person">
                            <strong>
                              {r.name}
                              <span>{r.room}号室</span>
                            </strong>
                            <small>カルテ {r.chartNumber}</small>
                          </div>
                          <div className="attention-date">
                            <span>認定期限</span>
                            <strong>
                              {monthLabel(r.certificationExpiryMonth)}
                            </strong>
                          </div>
                          <span className="badge badge-warning">期間確認</span>
                          <ChevronRight size={16} />
                        </button>
                      ))}
                    </div>
                  ) : (
                    <Empty title="期間確認が必要な利用者はいません">
                      台帳を登録すると、期限の比較結果が表示されます。
                    </Empty>
                  )}
                </section>
                <section className="card meeting-card">
                  <div className="section-heading">
                    <div>
                      <h2>今月のサービス担当者会議</h2>
                      <p>予定と対象人数</p>
                    </div>
                    <CalendarDays size={20} />
                  </div>
                  {[1, 2].map((round) => {
                    const plans = monthPlans.filter(
                      (p) => p.meetingRound === round,
                    );
                    const configuredDate =
                      round === 1
                        ? state.settings.meeting1Date
                        : state.settings.meeting2Date;
                    const dates = [
                      ...new Set(
                        plans.map((p) => p.meetingDate).filter(Boolean),
                      ),
                    ].sort();
                    const date = dates[0] || configuredDate;
                    return (
                      <div className="meeting-item" key={round}>
                        <div className="meeting-day">
                          <small>
                            {date ? `${Number(date.slice(5, 7))}月` : "予定"}
                          </small>
                          <strong>
                            {date ? Number(date.slice(8, 10)) : "—"}
                          </strong>
                        </div>
                        <div>
                          <span className="meeting-round">
                            {round}回目の会議
                          </span>
                          <strong>
                            {date
                              ? dateLabel(date)
                              : "会議日を設定してください"}
                          </strong>
                          <small>
                            {round === 1
                              ? state.settings.meeting1Time
                              : state.settings.meeting2Time}{" "}
                            · {new Set(plans.map((p) => p.residentId)).size}名
                            {dates.length > 1 ? " · 日程が複数あります" : ""}
                          </small>
                        </div>
                      </div>
                    );
                  })}
                  <button
                    className="meeting-link"
                    onClick={() => choosePage("documents")}
                  >
                    会議のお知らせを作成
                    <ArrowRight size={16} />
                  </button>
                </section>
              </div>
              <section className="card start-guide">
                <div className="section-heading">
                  <div>
                    <h2>業務をはじめる</h2>
                    <p>登録から帳票作成まで、3つのステップ</p>
                  </div>
                  <span className="badge badge-neutral">業務ガイド</span>
                </div>
                <div className="guide-grid">
                  <Guide
                    number="01"
                    title="利用者情報を登録"
                    text="Excelを取り込むか、台帳に直接入力"
                    icon={Users}
                    onClick={() => choosePage("residents")}
                  />
                  <Guide
                    number="02"
                    title="今月のプランを作成"
                    text="担当者と会議日を決めて一括作成"
                    icon={ClipboardCheck}
                    onClick={() => choosePage("plans")}
                  />
                  <Guide
                    number="03"
                    title="帳票と進捗を確認"
                    text="通知を印刷し、同意書の回収を記録"
                    icon={FileText}
                    onClick={() => choosePage("documents")}
                  />
                </div>
              </section>
            </>
          )}
          {page === "residents" && (
            <section className="card table-card">
              <div className="table-toolbar">
                <div className="tabs">
                  <button
                    className={residentFilter === "all" ? "selected" : ""}
                    onClick={() => setResidentFilter("all")}
                  >
                    すべて <b>{active.length}</b>
                  </button>
                  <button
                    className={residentFilter === "due" ? "selected" : ""}
                    onClick={() => setResidentFilter("due")}
                  >
                    今月の対象 <b>{due.length}</b>
                  </button>
                  <button
                    className={residentFilter === "alert" ? "selected" : ""}
                    onClick={() => setResidentFilter("alert")}
                  >
                    期間確認 <b>{alerts.length}</b>
                  </button>
                </div>
                <div className="toolbar-actions">
                  <SearchBox query={query} onChange={setQuery} />
                  {isAdmin(state) && (
                    <Button
                      onClick={() => importInput.current?.click()}
                      disabled={busy}
                    >
                      <FolderInput size={16} />
                      Excelを取り込む
                    </Button>
                  )}
                </div>
              </div>
              <div className="table-caption">
                <span>{visibleResidents.length}件の利用者</span>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={showArchived}
                    onChange={(e) => setShowArchived(e.target.checked)}
                  />
                  退所済みを含む
                </label>
              </div>
              {visibleResidents.length ? (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>居室 / カルテ</th>
                        <th>利用者氏名</th>
                        <th>介護度</th>
                        <th>作成年月</th>
                        <th>ケアプラン期間</th>
                        <th>認定期限</th>
                        <th>担当CM</th>
                        <th>状態</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {visibleResidents.map((r) => (
                        <tr
                          key={r.id}
                          className={
                            r.status === "discharged" ? "archived" : ""
                          }
                        >
                          <td>
                            <strong>{r.room || "—"}</strong>
                            <small className="table-sub">{r.chartNumber}</small>
                          </td>
                          <td>
                            <button
                              className="resident-name"
                              onClick={() => setResidentDraft(r)}
                            >
                              {r.name}
                            </button>
                            <small className="table-sub">
                              {r.insurer || "保険者未登録"}
                            </small>
                          </td>
                          <td>
                            {r.careLevel ? (
                              <span className="care-level">
                                要介護 {r.careLevel}
                              </span>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td>{wareki(r.creationMonth)}</td>
                          <td>
                            <div className="period-cell">
                              {wareki(r.planStartMonth)}
                              <small>～ {wareki(r.planEndMonth)}</small>
                            </div>
                          </td>
                          <td
                            className={
                              exceedsCertification(r) ? "warning-text" : ""
                            }
                          >
                            {wareki(r.certificationExpiryMonth)}
                          </td>
                          <td>{r.careManager || "—"}</td>
                          <td>
                            {r.status === "discharged" ? (
                              <span className="badge badge-neutral">
                                退所済み
                              </span>
                            ) : exceedsCertification(r) ? (
                              <span className="badge badge-warning">
                                期間確認
                              </span>
                            ) : (
                              <span className="badge badge-success">
                                利用中
                              </span>
                            )}
                            {r.restraint && (
                              <small className="table-sub">
                                拘束説明書対象
                              </small>
                            )}
                          </td>
                          <td>
                            <button
                              className="icon-button"
                              aria-label={`${r.name}を編集`}
                              onClick={() => setResidentDraft(r)}
                            >
                              <Pencil size={16} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty
                  title={
                    state.residents.length
                      ? "条件に一致する利用者はいません"
                      : "利用者台帳をつくりましょう"
                  }
                >
                  {state.residents.length
                    ? "検索条件や対象年月を変更してください。"
                    : "元の業務管理表を取り込むと、利用者情報を引き継げます。"}
                </Empty>
              )}
              <div className="table-footnote">
                <TriangleAlert size={14} />
                期間確認は、ケアプランの満了年月が認定期限と同月か、それ以降の利用者です。
              </div>
            </section>
          )}
          {page === "plans" && (
            <>
              <section className="card plan-summary">
                <div>
                  <ClipboardCheck size={22} />
                  <div>
                    <strong>{monthLabel(month)}の作成・回収状況</strong>
                    <small>
                      作成対象 {due.length}名 · 登録プラン {monthPlans.length}件
                      · 回収済み {monthPlans.length - pending.length}件
                    </small>
                  </div>
                </div>
                <Button
                  onClick={() => setBatch(true)}
                  disabled={!due.length || busy}
                >
                  <Plus size={16} />
                  対象者から一括作成
                </Button>
              </section>
              <section className="card table-card">
                <div className="table-toolbar">
                  <div className="tabs">
                    <button
                      className={planFilter === "all" ? "selected" : ""}
                      onClick={() => setPlanFilter("all")}
                    >
                      すべて <b>{monthPlans.length}</b>
                    </button>
                    <button
                      className={planFilter === "round1" ? "selected" : ""}
                      onClick={() => setPlanFilter("round1")}
                    >
                      1回目
                    </button>
                    <button
                      className={planFilter === "round2" ? "selected" : ""}
                      onClick={() => setPlanFilter("round2")}
                    >
                      2回目
                    </button>
                    <button
                      className={planFilter === "pending" ? "selected" : ""}
                      onClick={() => setPlanFilter("pending")}
                    >
                      未回収
                    </button>
                  </div>
                  <SearchBox query={query} onChange={setQuery} />
                </div>
                {visiblePlans.length ? (
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>利用者 / 居室</th>
                          <th>作成者</th>
                          <th>作成日</th>
                          <th>印刷日</th>
                          <th>会議日</th>
                          <th>担当CM</th>
                          <th>有効期間</th>
                          <th>同意書</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {visiblePlans.map((p) => {
                          const r = residentMap.get(p.residentId);
                          return (
                            <tr key={p.id}>
                              <td>
                                <button
                                  className="resident-name"
                                  onClick={() => setPlanDraft(p)}
                                >
                                  {r?.name || "利用者不明"}
                                </button>
                                <small className="table-sub">
                                  {r?.room || "—"}号室 · {p.meetingRound}回目
                                </small>
                              </td>
                              <td>
                                {p.creator || (
                                  <span className="muted">未設定</span>
                                )}
                              </td>
                              <td>{dateLabel(p.creationDate)}</td>
                              <td>{dateLabel(p.printDate)}</td>
                              <td>{dateLabel(p.meetingDate)}</td>
                              <td>{p.careManager || "—"}</td>
                              <td>
                                <div className="plan-period">
                                  {p.periodStartDate && p.periodEndDate ? (
                                    <>
                                      {dateLabel(p.periodStartDate)}
                                      <small>
                                        ～ {dateLabel(p.periodEndDate)}
                                      </small>
                                    </>
                                  ) : (
                                    <>
                                      {p.effectivePeriodText || "未登録"}
                                      <small className="warning-text">
                                        年月日を要確認
                                      </small>
                                    </>
                                  )}
                                </div>
                              </td>
                              <td>
                                <select
                                  aria-label={`${r?.name}の同意書の進捗`}
                                  className={`status-select status-${p.consentStatus === "回収済" ? "done" : p.consentStatus === "送付済" ? "sent" : "pending"}`}
                                  value={p.consentStatus}
                                  disabled={busy}
                                  onChange={(e) =>
                                    void updateConsent(
                                      p,
                                      e.target
                                        .value as CarePlan["consentStatus"],
                                    )
                                  }
                                >
                                  <option>未送付</option>
                                  <option>送付済</option>
                                  <option>回収済</option>
                                </select>
                              </td>
                              <td>
                                <button
                                  className="icon-button"
                                  aria-label="プランを編集"
                                  onClick={() => setPlanDraft(p)}
                                >
                                  <MoreHorizontal size={18} />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <Empty
                    title="この月のプランはまだありません"
                    action={
                      <Button
                        onClick={() => setBatch(true)}
                        disabled={!due.length}
                      >
                        対象者から一括作成
                      </Button>
                    }
                  >
                    利用者台帳の作成年月が対象月と一致する方から作成できます。
                  </Empty>
                )}
              </section>
            </>
          )}
          {page === "documents" && (
            <Documents
              residents={state.residents}
              plans={state.plans}
              settings={state.settings}
              targetMonth={month}
              onEditPlan={setPlanDraft}
              onPrinted={recordPrinted}
            />
          )}
          {page === "settings" && (
            <SettingsView
              state={state}
              info={info}
              busy={busy}
              onSaved={saveSettings}
              onReload={async () => {
                try {
                  return (await refresh()).settings;
                } catch (err) {
                  notify(errors(err), true);
                  throw err;
                }
              }}
              onUser={(user) =>
                execute(
                  () => api("/api/users", "POST", user),
                  "職員アカウントを登録しました。",
                )
              }
              onUserUpdate={handleUserUpdate}
              onBackup={() =>
                void downloadBackup().catch((err) => notify(errors(err), true))
              }
              onConnection={() => {
                void logout().then(() => setConnecting(true));
              }}
              onRestore={() => restoreInput.current?.click()}
            />
          )}
        </main>
        <footer className="workspace-footer">
          <span>
            CareManager <b>0.1</b>
          </span>
          <span>入力した情報は共有元に保存されます</span>
        </footer>
      </div>
      <input
        className="hidden"
        ref={importInput}
        type="file"
        accept=".xlsm,.xlsx"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleImport(file);
        }}
      />
      <input
        className="hidden"
        ref={restoreInput}
        type="file"
        accept=".json"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleRestore(file);
        }}
      />
      {toast && (
        <div
          className={`toast ${toast.error ? "toast-error" : ""}`}
          role={toast.error ? "alert" : "status"}
        >
          {toast.error ? (
            <TriangleAlert size={18} />
          ) : (
            <CheckCircle2 size={18} />
          )}
          <span>{toast.text}</span>
          <button
            className="icon-button"
            aria-label="通知を閉じる"
            onClick={() => setToast(null)}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {busy && (
        <div className="busy-indicator">
          <LoaderCircle className="spin" size={16} />
          処理中…
        </div>
      )}
      {residentDraft && (
        <Modal
          title={residentDraft.id ? "利用者情報を編集" : "利用者を登録"}
          onClose={() => setResidentDraft(null)}
          wide
        >
          <form onSubmit={(e) => void saveResident(e)}>
            <ResidentForm
              value={residentDraft}
              onChange={setResidentDraft}
              settings={state.settings}
            />
            <div className="modal-footer">
              {residentDraft.id && residentDraft.status === "active" && (
                <Button
                  kind="danger"
                  disabled={busy}
                  onClick={() => {
                    setArchive(residentDraft);
                    setResidentDraft(null);
                  }}
                >
                  退所済みにする
                </Button>
              )}
              <div />
              <Button onClick={() => setResidentDraft(null)}>キャンセル</Button>
              <Button kind="primary" type="submit" disabled={busy}>
                <Check size={16} />
                保存する
              </Button>
            </div>
          </form>
        </Modal>
      )}
      {planDraft && (
        <Modal
          title={planDraft.id ? "ケアプランを編集" : "ケアプランを追加"}
          onClose={() => setPlanDraft(null)}
          wide
        >
          <form onSubmit={(e) => void savePlan(e)}>
            <PlanForm
              value={planDraft}
              onChange={setPlanDraft}
              residents={state.residents}
              settings={state.settings}
            />
            <div className="modal-footer">
              <div />
              <Button onClick={() => setPlanDraft(null)}>キャンセル</Button>
              <Button kind="primary" type="submit" disabled={busy}>
                <Check size={16} />
                保存する
              </Button>
            </div>
          </form>
        </Modal>
      )}
      {preview && (
        <Modal
          title="Excelの取り込み内容を確認"
          onClose={() => setPreview(null)}
          wide
        >
          <div className="modal-body">
            <p>
              この内容を確認してから登録してください。元のExcelファイルは変更せず、マクロは実行しません。
            </p>
            <div className="import-metrics">
              <span>
                <strong>{preview.summary.residentCount}</strong>利用者
              </span>
              <span>
                <strong>{preview.summary.planCount}</strong>ケアプラン
              </span>
              <span>
                <strong>{preview.summary.restraintCount}</strong>拘束説明書対象
              </span>
            </div>
            <p className="notice">
              登録済みのカルテ番号に対応する利用者とプランは取り込みをスキップします。利用者が未登録の初回取り込みでは、事業所設定も取り込みます。登録済みの利用者がいる場合は既存設定を保持します。
            </p>
            {preview.warnings.length > 0 && (
              <div className="import-warnings">
                <h3>
                  <TriangleAlert size={17} />
                  確認事項 {preview.warnings.length}件
                </h3>
                <ul>
                  {preview.warnings.map((warning, i) => (
                    <li key={i}>
                      {typeof warning === "string"
                        ? warning
                        : JSON.stringify(warning)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <h3>利用者のプレビュー</h3>
            <div className="table-scroll import-preview">
              <table>
                <thead>
                  <tr>
                    <th>居室</th>
                    <th>カルテ</th>
                    <th>氏名</th>
                    <th>認定期限</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.residents?.slice(0, 10).map((r, i) => (
                    <tr key={i}>
                      <td>{r.room}</td>
                      <td>{r.chartNumber}</td>
                      <td>{r.name}</td>
                      <td>{wareki(r.certificationExpiryMonth)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <small className="muted">
              先頭10件を表示。年がないプラン期間は原文を保存し、同意書作成前に年月日を登録します。
            </small>
          </div>
          <div className="modal-footer">
            <div />
            <Button onClick={() => setPreview(null)}>キャンセル</Button>
            <Button
              kind="primary"
              disabled={busy}
              onClick={() =>
                void execute(
                  async () => {
                    const result = await api<{
                      createdResidents: number;
                      createdPlans: number;
                      skippedResidents: number;
                    }>("/api/import/commit", "POST", {
                      previewId: preview.previewId,
                    });
                    notify(
                      `利用者 ${result.createdResidents}件・プラン ${result.createdPlans}件を取り込みました。`,
                    );
                  },
                  "Excelの取り込みが完了しました。",
                  () => {
                    setPreview(null);
                    void refresh().then((result) =>
                      setMonth(result.settings.targetMonth || month),
                    );
                  },
                )
              }
            >
              <FolderInput size={16} />
              確認して取り込む
            </Button>
          </div>
        </Modal>
      )}
      {restorePreview && (
        <Modal
          title="バックアップの復元内容を確認"
          onClose={() => setRestorePreview(null)}
        >
          <div className="modal-body">
            <p>
              バックアップから、利用者・ケアプラン・事業所設定を復元します。現在のログインアカウントは保持します。
            </p>
            <div className="import-metrics">
              <span>
                <strong>{restorePreview.summary.residentCount}</strong>利用者
              </span>
              <span>
                <strong>{restorePreview.summary.planCount}</strong>ケアプラン
              </span>
            </div>
            <p className="notice">
              復元できるのは、利用者とプランが未登録の場合のみです。職員アカウントと過去の操作履歴は復元しません。
            </p>
            {restorePreview.warnings.map((warning, i) => (
              <p className="notice" key={i}>
                {warning}
              </p>
            ))}
          </div>
          <div className="modal-footer">
            <Button onClick={() => setRestorePreview(null)}>キャンセル</Button>
            <Button
              kind="primary"
              disabled={busy}
              onClick={() =>
                void execute(
                  () =>
                    api("/api/restore/commit", "POST", {
                      previewId: restorePreview.previewId,
                    }),
                  "バックアップから復元しました。",
                  () => {
                    setRestorePreview(null);
                    void refresh().then((result) =>
                      setMonth(result.settings.targetMonth || month),
                    );
                  },
                )
              }
            >
              確認して復元する
            </Button>
          </div>
        </Modal>
      )}
      {batch && (
        <BatchDialog
          month={month}
          residents={due}
          plans={monthPlans}
          settings={state.settings}
          busy={busy}
          onClose={() => setBatch(false)}
          onSubmit={(options) =>
            execute(
              () => api("/api/plans/batch", "POST", options),
              "対象者のケアプランを作成しました。",
              () => setBatch(false),
            )
          }
        />
      )}
      {archive && (
        <Modal title="退所済みとして記録" onClose={() => setArchive(null)}>
          <div className="modal-body">
            <p>
              <strong>{archive.name}</strong>
              さんを退所済みとして記録します。利用者情報とケアプランは保持されます。
            </p>
          </div>
          <div className="modal-footer">
            <Button onClick={() => setArchive(null)}>キャンセル</Button>
            <Button
              kind="danger"
              disabled={busy}
              onClick={() =>
                void execute(
                  () =>
                    api(`/api/residents/${archive.id}`, "DELETE", {
                      revision: archive.revision,
                    }),
                  "退所済みとして記録しました。",
                  () => setArchive(null),
                )
              }
            >
              退所済みにする
            </Button>
          </div>
        </Modal>
      )}
    </div>
    </NoticeContext.Provider>
  );
}

function SearchBox({
  query,
  onChange,
}: {
  query: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="search-box">
      <Search size={16} />
      <input
        aria-label="検索"
        placeholder="氏名・居室・カルテで検索"
        value={query}
        onChange={(e) => onChange(e.target.value)}
      />
      {query && (
        <button
          className="icon-button"
          type="button"
          onClick={() => onChange("")}
          aria-label="検索をクリア"
        >
          <X size={14} />
        </button>
      )}
    </label>
  );
}
function Metric({
  icon: Icon,
  label,
  value,
  unit,
  note,
  warning = false,
  onClick,
}: {
  icon: typeof Users;
  label: string;
  value: number;
  unit: string;
  note: string;
  warning?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`metric-card ${warning ? "metric-warning" : ""}`}
      onClick={onClick}
    >
      <div className="metric-top">
        <span>{label}</span>
        <div className="metric-icon">
          <Icon size={19} />
        </div>
      </div>
      <div className="metric-value">
        {value}
        <span>{unit}</span>
      </div>
      <small>
        {note}
        <ChevronRight size={14} />
      </small>
    </button>
  );
}
function Guide({
  number,
  title,
  text,
  icon: Icon,
  onClick,
}: {
  number: string;
  title: string;
  text: string;
  icon: typeof Users;
  onClick: () => void;
}) {
  return (
    <button className="guide-item" onClick={onClick}>
      <span className="guide-number">{number}</span>
      <div>
        <strong>{title}</strong>
        <small>{text}</small>
      </div>
      <Icon size={22} />
    </button>
  );
}
function ResidentForm({
  value,
  onChange,
  settings,
}: {
  value: Resident;
  onChange: (value: Resident) => void;
  settings: Settings;
}) {
  const set = <K extends keyof Resident>(key: K, v: Resident[K]) =>
    onChange({ ...value, [key]: v });
  return (
    <div className="modal-body">
      <h3 className="form-section">基本情報</h3>
      <div className="form-grid form-grid-3">
        <Field label="カルテ番号 *">
          <input
            required
            value={value.chartNumber}
            maxLength={40}
            onChange={(e) => set("chartNumber", e.target.value)}
          />
        </Field>
        <Field label="利用者氏名 *">
          <input
            required
            value={value.name}
            maxLength={100}
            onChange={(e) => set("name", e.target.value)}
          />
        </Field>
        <Field label="居室">
          <input
            value={value.room}
            maxLength={40}
            onChange={(e) => set("room", e.target.value)}
          />
        </Field>
        <Field label="保険者">
          <input
            value={value.insurer}
            maxLength={100}
            onChange={(e) => set("insurer", e.target.value)}
          />
        </Field>
        <Field label="要介護度">
          <select
            value={value.careLevel}
            onChange={(e) => set("careLevel", e.target.value)}
          >
            <option value="">未登録</option>
            {["1", "2", "3", "4", "5"].map((level) => (
              <option key={level} value={level}>
                要介護 {level}
              </option>
            ))}
          </select>
        </Field>
        <Field label="担当ケアマネ">
          <input
            list="care-managers"
            value={value.careManager}
            maxLength={80}
            onChange={(e) => set("careManager", e.target.value)}
          />
        </Field>
      </div>
      <h3 className="form-section">期間の管理</h3>
      <div className="form-grid form-grid-2">
        <Field label="プラン作成年月">
          <input
            type="month"
            value={value.creationMonth}
            onChange={(e) => set("creationMonth", e.target.value)}
          />
        </Field>
        <Field label="認定期限（年月）">
          <input
            type="month"
            value={value.certificationExpiryMonth}
            onChange={(e) => set("certificationExpiryMonth", e.target.value)}
          />
        </Field>
        <Field label="ケアプラン開始年月">
          <input
            type="month"
            value={value.planStartMonth}
            onChange={(e) => set("planStartMonth", e.target.value)}
          />
        </Field>
        <Field label="ケアプラン満了年月">
          <input
            type="month"
            value={value.planEndMonth}
            onChange={(e) => set("planEndMonth", e.target.value)}
          />
        </Field>
      </div>
      {exceedsCertification(value) && (
        <p className="notice warning">
          <TriangleAlert size={16} />
          ケアプランの満了が認定期限と同月か、それ以降です。認定状況を確認してください。
        </p>
      )}
      <h3 className="form-section">入所・自立度・帳票</h3>
      <div className="form-grid form-grid-2">
        <Field label="入所日">
          <input
            type="date"
            value={value.admissionDate}
            onChange={(e) => set("admissionDate", e.target.value)}
          />
        </Field>
        <Field
          label="入所日の補足"
          hint="元データに年・月・日の欠損がある場合はここに保持"
        >
          <input
            value={value.admissionNote}
            maxLength={300}
            onChange={(e) => set("admissionNote", e.target.value)}
          />
        </Field>
        <Field label="障害高齢者の日常生活自立度">
          <select
            value={value.physicalIndependence}
            onChange={(e) => set("physicalIndependence", e.target.value)}
          >
            <option value="">未登録</option>
            {["J1", "J2", "A1", "A2", "B1", "B2", "C1", "C2"].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </Field>
        <Field label="認知症高齢者の日常生活自立度">
          <select
            value={value.cognitiveIndependence}
            onChange={(e) => set("cognitiveIndependence", e.target.value)}
          >
            <option value="">未登録</option>
            {["自立", "I", "Ⅱa", "Ⅱb", "Ⅲa", "Ⅲb", "Ⅳ", "M"].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </Field>
      </div>
      <label className="checkbox restraint-field">
        <input
          type="checkbox"
          checked={value.restraint}
          onChange={(e) => set("restraint", e.target.checked)}
        />
        身体拘束説明書の作成対象
      </label>
      <Field label="備考">
        <textarea
          rows={3}
          maxLength={4000}
          value={value.notes}
          onChange={(e) => set("notes", e.target.value)}
        />
      </Field>
      {value.status === "discharged" && (
        <label className="checkbox">
          <input
            type="checkbox"
            checked={value.status === "discharged"}
            onChange={(e) =>
              set("status", e.target.checked ? "discharged" : "active")
            }
          />
          退所済み（外すと利用中に戻ります）
        </label>
      )}
      <datalist id="care-managers">
        {settings.careManagers.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
    </div>
  );
}
function PlanForm({
  value,
  onChange,
  residents,
  settings,
}: {
  value: CarePlan;
  onChange: (value: CarePlan) => void;
  residents: Resident[];
  settings: Settings;
}) {
  const set = <K extends keyof CarePlan>(key: K, v: CarePlan[K]) =>
    onChange({ ...value, [key]: v });
  const chooseResident = (id: string) => {
    const r = residents.find((r) => r.id === id);
    const end = r?.planEndMonth;
    if (!r) return;
    onChange({
      ...value,
      residentId: id,
      careManager: r.careManager,
      restraint: r.restraint,
      periodStartDate: r.planStartMonth ? `${r.planStartMonth}-01` : "",
      periodEndDate: end
        ? `${end}-${String(new Date(Number(end.slice(0, 4)), Number(end.slice(5, 7)), 0).getDate()).padStart(2, "0")}`
        : "",
      effectivePeriodText: periodFor(r),
    });
  };
  return (
    <div className="modal-body">
      <div className="form-grid form-grid-2">
        <Field label="利用者 *">
          <select
            required
            disabled={!!value.id}
            value={value.residentId}
            onChange={(e) => chooseResident(e.target.value)}
          >
            <option value="">選択してください</option>
            {residents
              .filter((r) => r.status === "active" || r.id === value.residentId)
              .sort(compareRoom)
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {r.room} · {r.name}（{r.chartNumber}）
                </option>
              ))}
          </select>
        </Field>
        <Field label="対象年月 *">
          <input
            required
            type="month"
            value={value.targetMonth}
            onChange={(e) => set("targetMonth", e.target.value)}
          />
        </Field>
        <Field label="作成者">
          <input
            list="plan-authors"
            value={value.creator}
            maxLength={80}
            onChange={(e) => set("creator", e.target.value)}
          />
        </Field>
        <Field label="作成日">
          <input
            type="date"
            value={value.creationDate}
            onChange={(e) => set("creationDate", e.target.value)}
          />
        </Field>
        <Field label="会議グループ">
          <select
            value={value.meetingRound}
            onChange={(e) => {
              const round = Number(e.target.value) as 1 | 2;
              onChange({
                ...value,
                meetingRound: round,
                meetingDate:
                  round === 1 ? settings.meeting1Date : settings.meeting2Date,
              });
            }}
          >
            <option value={1}>1回目</option>
            <option value={2}>2回目</option>
          </select>
        </Field>
        <Field label="会議日">
          <input
            type="date"
            value={value.meetingDate}
            onChange={(e) => set("meetingDate", e.target.value)}
          />
        </Field>
        <Field label="担当ケアマネ">
          <input
            value={value.careManager}
            maxLength={80}
            onChange={(e) => set("careManager", e.target.value)}
          />
        </Field>
        <Field label="印刷日">
          <input
            type="date"
            value={value.printDate}
            onChange={(e) => set("printDate", e.target.value)}
          />
        </Field>
      </div>
      <h3 className="form-section">同意書に使う有効期間</h3>
      <p className="muted small">
        年のないExcelの期間は自動補完しません。年月日を確認して登録してください。
      </p>
      <div className="form-grid form-grid-2">
        <Field label="開始日">
          <input
            type="date"
            value={value.periodStartDate}
            onChange={(e) => set("periodStartDate", e.target.value)}
          />
        </Field>
        <Field label="終了日">
          <input
            type="date"
            value={value.periodEndDate}
            onChange={(e) => set("periodEndDate", e.target.value)}
          />
        </Field>
      </div>
      <Field label="元データの有効期間 / 補足">
        <input
          value={value.effectivePeriodText}
          maxLength={300}
          onChange={(e) => set("effectivePeriodText", e.target.value)}
        />
      </Field>
      <div className="form-grid form-grid-2">
        <Field label="同意書の進捗">
          <select
            value={value.consentStatus}
            onChange={(e) =>
              set("consentStatus", e.target.value as CarePlan["consentStatus"])
            }
          >
            <option>未送付</option>
            <option>送付済</option>
            <option>回収済</option>
          </select>
        </Field>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={value.restraint}
            onChange={(e) => set("restraint", e.target.checked)}
          />
          身体拘束説明書の作成対象
        </label>
      </div>
      <Field label="備考">
        <textarea
          rows={3}
          maxLength={4000}
          value={value.notes}
          onChange={(e) => set("notes", e.target.value)}
        />
      </Field>
      <datalist id="plan-authors">
        {settings.authors.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
    </div>
  );
}
function BatchDialog({
  month,
  residents,
  plans,
  settings,
  busy,
  onClose,
  onSubmit,
}: {
  month: string;
  residents: Resident[];
  plans: CarePlan[];
  settings: Settings;
  busy: boolean;
  onClose: () => void;
  onSubmit: (value: unknown) => Promise<boolean>;
}) {
  const [authors, setAuthors] = useState(settings.authors.join("\n"));
  const [assignment, setAssignment] = useState("balanced");
  const existing = new Set(plans.map((p) => p.residentId));
  const targets = residents.filter((r) => !existing.has(r.id));
  return (
    <Modal title="対象者からプランを一括作成" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void onSubmit({
            targetMonth: month,
            authorNames: authors
              .split("\n")
              .map((v) => v.trim())
              .filter(Boolean),
            assignment,
            periodMode: "certification",
          });
        }}
      >
        <div className="modal-body">
          <p>
            <strong>{monthLabel(month)}</strong>が作成年月になっている利用者{" "}
            <strong>{targets.length}名</strong>{" "}
            のプランを作成します。登録済みの方は追加しません。
          </p>
          <Field
            label="作成者（1行につき1名）"
            hint="居室順に並べ、各会議グループ内で入力した順に割り当てます。"
          >
            <textarea
              rows={4}
              value={authors}
              onChange={(e) => setAuthors(e.target.value)}
              maxLength={2000}
            />
          </Field>
          <Field label="会議グループへの振り分け">
            <select
              value={assignment}
              onChange={(e) => setAssignment(e.target.value)}
            >
              <option value="balanced">人数を均等に2回へ振り分ける</option>
              <option value="round1">全員を1回目へ</option>
              <option value="round2">全員を2回目へ</option>
              <option value="roomAB">居室番号でA・Bへ振り分ける</option>
            </select>
          </Field>
          <p className="small muted">
            1回目: {dateLabel(settings.meeting1Date)} / 2回目:{" "}
            {dateLabel(settings.meeting2Date)}
            <br />
            居室による振り分け: 末尾01〜10は1回目、11〜19は2回目。
          </p>
          <p className="notice">
            台帳の現在の期間と拘束説明書対象を、プランに保存します。認定満了後の追加3か月分や、期間の自動更新はこの初版では作成しません。
          </p>
        </div>
        <div className="modal-footer">
          <Button onClick={onClose}>キャンセル</Button>
          <Button
            type="submit"
            kind="primary"
            disabled={busy || !targets.length}
          >
            確認して{targets.length}件を作成
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function SettingsView({
  state,
  info,
  busy,
  onSaved,
  onReload,
  onUser,
  onUserUpdate,
  onBackup,
  onConnection,
  onRestore,
}: {
  state: State;
  info: DesktopInfo | null;
  busy: boolean;
  onSaved: (settings: Settings) => Promise<Settings | null>;
  onReload: () => Promise<Settings>;
  onUser: (user: unknown) => Promise<boolean>;
  onUserUpdate: (id: string, user: unknown) => Promise<boolean>;
  onBackup: () => void;
  onConnection: () => void;
  onRestore: () => void;
}) {
  const [draft, setDraft] = useState<Settings>(state.settings);
  const [authors, setAuthors] = useState(state.settings.authors.join("\n"));
  const [managers, setManagers] = useState(
    state.settings.careManagers.join("\n"),
  );
  const [userForm, setUserForm] = useState(false);
  const [user, setUser] = useState({
    username: "",
    displayName: "",
    password: "",
    role: "staff",
  });
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editPassword, setEditPassword] = useState("");
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setDraft({ ...draft, [key]: value });
  const admin = isAdmin(state);
  return (
    <div className="settings-layout">
      <form
        className="card settings-form"
        onSubmit={(e) => {
          e.preventDefault();
          void onSaved({
            ...draft,
            authors: authors
              .split("\n")
              .map((v) => v.trim())
              .filter(Boolean),
            careManagers: managers
              .split("\n")
              .map((v) => v.trim())
              .filter(Boolean),
          }).then((saved) => {
            if (saved) {
              setDraft(saved);
              setAuthors(saved.authors.join("\n"));
              setManagers(saved.careManagers.join("\n"));
            }
          });
        }}
      >
        <div className="section-heading">
          <div>
            <h2>事業所の基本情報</h2>
            <p>帳票に表示する事業所情報と業務設定</p>
          </div>
          <ShieldCheck size={20} />
        </div>
        <fieldset disabled={!admin || busy}>
          <div className="form-grid form-grid-2">
            <Field label="事業所名">
              <input
                required
                value={draft.facilityName}
                maxLength={120}
                onChange={(e) => set("facilityName", e.target.value)}
              />
            </Field>
            <Field label="フロア">
              <input
                value={draft.floor}
                maxLength={40}
                onChange={(e) => set("floor", e.target.value)}
              />
            </Field>
            <Field label="既定の対象年月">
              <input
                type="month"
                value={draft.targetMonth}
                onChange={(e) => set("targetMonth", e.target.value)}
              />
            </Field>
            <Field label="会議の場所">
              <input
                value={draft.meetingLocation}
                maxLength={200}
                onChange={(e) => set("meetingLocation", e.target.value)}
              />
            </Field>
            <Field label="連絡担当">
              <input
                value={draft.contactName}
                maxLength={80}
                onChange={(e) => set("contactName", e.target.value)}
              />
            </Field>
            <Field label="連絡先電話番号">
              <input
                value={draft.contactPhone}
                maxLength={50}
                onChange={(e) => set("contactPhone", e.target.value)}
              />
            </Field>
          </div>
          <h3 className="form-section">職員と会議日</h3>
          <div className="form-grid form-grid-2">
            <Field label="作成者一覧（1行につき1名）">
              <textarea
                rows={4}
                value={authors}
                onChange={(e) => setAuthors(e.target.value)}
              />
            </Field>
            <Field label="担当CM一覧（1行につき1名）">
              <textarea
                rows={4}
                value={managers}
                onChange={(e) => setManagers(e.target.value)}
              />
            </Field>
            <Field label="1回目の会議日">
              <input
                type="date"
                value={draft.meeting1Date}
                onChange={(e) => set("meeting1Date", e.target.value)}
              />
            </Field>
            <Field label="開始時刻">
              <input
                type="time"
                value={draft.meeting1Time}
                onChange={(e) => set("meeting1Time", e.target.value)}
              />
            </Field>
            <Field label="2回目の会議日">
              <input
                type="date"
                value={draft.meeting2Date}
                onChange={(e) => set("meeting2Date", e.target.value)}
              />
            </Field>
            <Field label="開始時刻">
              <input
                type="time"
                value={draft.meeting2Time}
                onChange={(e) => set("meeting2Time", e.target.value)}
              />
            </Field>
          </div>
          <p className="small muted">
            会議日変更は既存プランには反映しません。各プランの会議日を編集してください。
          </p>
          <h3 className="form-section">帳票の文面</h3>
          <p className="small muted">
            元ファイルを取り込むと、同意書・説明書の本文を引き継ぎます。空欄の場合は帳票の既定文面を使います。
          </p>
          <Field
            label="包括同意書の本文"
            hint="差込: {利用者氏名} {事業所名} {開始日} {終了日}"
          >
            <textarea
              rows={6}
              maxLength={10000}
              value={draft.consentBody || ""}
              onChange={(e) => set("consentBody", e.target.value)}
            />
          </Field>
          <Field label="身体拘束説明書の本文">
            <textarea
              rows={4}
              maxLength={10000}
              value={draft.restraintBody || ""}
              onChange={(e) => set("restraintBody", e.target.value)}
            />
          </Field>
        </fieldset>
        {admin ? (
          <div className="settings-footer">
            <Button
              onClick={() =>
                void onReload()
                  .then((settings) => {
                    setDraft(settings);
                    setAuthors(settings.authors.join("\n"));
                    setManagers(settings.careManagers.join("\n"));
                  })
                  .catch(() => {})
              }
              disabled={busy}
            >
              編集を破棄して再読込
            </Button>
            <Button kind="primary" type="submit" disabled={busy}>
              <Check size={16} />
              設定を保存
            </Button>
          </div>
        ) : (
          <p className="notice">設定の変更は管理者に依頼してください。</p>
        )}
      </form>
      <div className="settings-side">
        <section className="card">
          <div className="section-heading">
            <div>
              <h2>共有と保存先</h2>
              <p>このPCの接続情報</p>
            </div>
            <Server size={19} />
          </div>
          <div className="settings-card-body">
            <span className="badge badge-success">
              {info?.mode === "client"
                ? "共有元に接続"
                : info?.share
                  ? "共有元として稼働"
                  : "このPCで利用"}
            </span>
            {info?.mode === "host" && info.share && (
              <>
                <h4>ほかのPCからの接続先</h4>
                {info.addresses?.length ? (
                  info.addresses.map((address) => (
                    <code className="connection-code" key={address}>
                      {address.startsWith("http")
                        ? address
                        : `http://${address}:${info.port || 43180}`}
                    </code>
                  ))
                ) : (
                  <p className="muted">事業所のLANに接続すると表示されます。</p>
                )}
              </>
            )}
            {info?.mode === "client" && (
              <code className="connection-code">{info.serverUrl}</code>
            )}
            {info?.dataDir && (
              <>
                <h4>データの保存先</h4>
                <code className="data-path">{info.dataDir}</code>
              </>
            )}
            <p className="small muted">
              共有元のアプリを終了すると、ほかのPCから接続できなくなります。
            </p>
            {window.careDesktop && (
              <Button onClick={onConnection}>接続方法を変更</Button>
            )}
          </div>
        </section>
        <section className="card">
          <div className="section-heading">
            <div>
              <h2>バックアップ</h2>
              <p>利用者・プラン・設定をJSONに保存</p>
            </div>
            <Download size={19} />
          </div>
          <div className="settings-card-body">
            <p className="small muted">
              ログイン情報・過去の操作履歴は含みません。復元は利用者・プランが未登録の共有元に限ります。
            </p>
            <Button onClick={onBackup} disabled={!admin || busy}>
              <Download size={16} />
              バックアップを保存
            </Button>
            <Button
              onClick={onRestore}
              disabled={!admin || busy || state.residents.length > 0}
            >
              バックアップから復元
            </Button>
            {state.residents.length > 0 && (
              <p className="small muted">
                復元時は新しい共有元で事業所を登録し、この画面からバックアップを読み込んでください。
              </p>
            )}
          </div>
        </section>
        <section className="card">
          <div className="section-heading">
            <div>
              <h2>職員アカウント</h2>
              <p>
                {admin
                  ? `${state.users.length}名が登録済み`
                  : "管理者が登録・管理します"}
              </p>
            </div>
            {admin && (
              <button
                className="icon-button"
                aria-label="職員を追加"
                onClick={() => setUserForm(true)}
              >
                <Plus size={19} />
              </button>
            )}
          </div>
          <div className="settings-card-body user-list">
            {admin ? (
              state.users.map((u) => (
                <div className="account-row" key={u.id}>
                  <span className="user-avatar">
                    {u.displayName.slice(0, 1)}
                  </span>
                  <div>
                    <strong>{u.displayName}</strong>
                    <small>
                      {u.username} ·{" "}
                      {u.role === "admin" ? "管理者" : "スタッフ"}
                      {u.disabled ? " · 無効" : ""}
                    </small>
                  </div>
                  <button
                    className="icon-button"
                    aria-label={`${u.displayName}のアカウントを編集`}
                    onClick={() => {
                      setEditingUser(u);
                      setEditPassword("");
                    }}
                  >
                    <Pencil size={15} />
                  </button>
                </div>
              ))
            ) : (
              <span className="muted">
                現在のアカウント: {state.user.displayName}
              </span>
            )}
          </div>
        </section>
        {admin && (
          <section className="card">
            <div className="section-heading">
              <div>
                <h2>最近の操作</h2>
                <p>事業所の操作履歴</p>
              </div>
              <Activity size={18} />
            </div>
            <div className="settings-card-body audit-list">
              {state.audit.slice(0, 8).map((entry, i) => (
                <div key={entry.id || i}>
                  <strong>{auditLabel(entry.action)}</strong>
                  <small>
                    {entry.actorName || entry.actor || "職員"} ·{" "}
                    {auditTime(entry.createdAt || entry.timestamp || "")}
                  </small>
                </div>
              ))}
              {!state.audit.length && (
                <span className="muted">操作履歴はまだありません。</span>
              )}
            </div>
          </section>
        )}
      </div>
      {userForm && (
        <Modal title="職員アカウントを追加" onClose={() => setUserForm(false)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void onUser(user).then((success) => {
                if (!success) return;
                setUserForm(false);
                setUser({
                  username: "",
                  displayName: "",
                  password: "",
                  role: "staff",
                });
              });
            }}
          >
            <div className="modal-body">
              <Field label="表示名">
                <input
                  required
                  maxLength={80}
                  value={user.displayName}
                  onChange={(e) =>
                    setUser({ ...user, displayName: e.target.value })
                  }
                />
              </Field>
              <Field label="ユーザー名">
                <input
                  required
                  maxLength={60}
                  value={user.username}
                  onChange={(e) =>
                    setUser({ ...user, username: e.target.value })
                  }
                />
              </Field>
              <Field label="初期パスワード（10文字以上）">
                <input
                  required
                  type="password"
                  autoComplete="new-password"
                  minLength={10}
                  maxLength={128}
                  value={user.password}
                  onChange={(e) =>
                    setUser({ ...user, password: e.target.value })
                  }
                />
              </Field>
              <Field label="権限">
                <select
                  value={user.role}
                  onChange={(e) => setUser({ ...user, role: e.target.value })}
                >
                  <option value="staff">スタッフ</option>
                  <option value="admin">管理者</option>
                </select>
              </Field>
            </div>
            <div className="modal-footer">
              <Button onClick={() => setUserForm(false)}>キャンセル</Button>
              <Button type="submit" kind="primary" disabled={busy}>
                登録する
              </Button>
            </div>
          </form>
        </Modal>
      )}
      {editingUser && (
        <Modal
          title="職員アカウントを編集"
          onClose={() => setEditingUser(null)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void onUserUpdate(editingUser.id, {
                displayName: editingUser.displayName,
                role: editingUser.role,
                disabled: editingUser.disabled || false,
                ...(editPassword ? { password: editPassword } : {}),
              }).then((success) => {
                if (!success) return;
                setEditingUser(null);
                setEditPassword("");
              });
            }}
          >
            <div className="modal-body">
              <p className="muted">ユーザー名: {editingUser.username}</p>
              <Field label="表示名">
                <input
                  required
                  maxLength={80}
                  value={editingUser.displayName}
                  onChange={(e) =>
                    setEditingUser({
                      ...editingUser,
                      displayName: e.target.value,
                    })
                  }
                />
              </Field>
              <Field label="権限">
                <select
                  value={editingUser.role}
                  onChange={(e) =>
                    setEditingUser({
                      ...editingUser,
                      role: e.target.value as User["role"],
                    })
                  }
                >
                  <option value="staff">スタッフ</option>
                  <option value="admin">管理者</option>
                </select>
              </Field>
              <Field
                label="新しいパスワード"
                hint="変更する場合のみ入力（10文字以上）"
              >
                <input
                  type="password"
                  autoComplete="new-password"
                  minLength={10}
                  maxLength={128}
                  value={editPassword}
                  onChange={(e) => setEditPassword(e.target.value)}
                />
              </Field>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={editingUser.disabled || false}
                  onChange={(e) =>
                    setEditingUser({
                      ...editingUser,
                      disabled: e.target.checked,
                    })
                  }
                />
                このアカウントを無効にする
              </label>
            </div>
            <div className="modal-footer">
              <Button onClick={() => setEditingUser(null)}>キャンセル</Button>
              <Button type="submit" kind="primary" disabled={busy}>
                保存する
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
function auditLabel(action: string) {
  const labels: Record<string, string> = {
    "resident.create": "利用者登録",
    "resident.update": "利用者情報更新",
    "resident.archive": "退所を記録",
    "plan.create": "プラン作成",
    "plan.update": "プラン更新",
    "plan.delete": "プラン削除",
    "plan.batch": "プラン一括作成",
    "settings.update": "事業所設定更新",
    "user.create": "職員登録",
    "user.update": "職員情報更新",
    "workbook.import": "Excel取り込み",
    "backup.export": "バックアップ保存",
    "backup.restore": "バックアップ復元",
    setup: "事業所登録",
    login: "ログイン",
  };
  return labels[action] || action;
}

function auditTime(value: string) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : new Intl.DateTimeFormat("ja-JP", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Asia/Tokyo",
      }).format(date);
}
