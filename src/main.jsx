import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ArrowUpRight,
  Bell,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  Clipboard,
  Clock3,
  Copy,
  FileText,
  Filter,
  Home,
  Image as ImageIcon,
  LayoutDashboard,
  Menu,
  MoreHorizontal,
  Plus,
  Printer,
  Search,
  Settings,
  ShieldCheck,
  Upload,
  X,
} from 'lucide-react';
import './styles.css';
import { supabase, supabaseConfigError } from './lib/supabase';
import { createPrintJob, getCurrentAccount, getJobs, getPrinters, signOut, startPrintJob, subscribeToJobs, subscribeToPrinters } from './lib/printCenterApi';

const initialJobs = [
  { id: 1, name: 'research-outline.pdf', pages: 12, copies: 2, color: 'B&W', status: 'Waiting', submitted: '2 min ago', size: '2.4 MB', type: 'PDF' },
  { id: 2, name: 'lab-notes-week-4.pdf', pages: 8, copies: 1, color: 'B&W', status: 'Waiting', submitted: '18 min ago', size: '1.1 MB', type: 'PDF' },
  { id: 3, name: 'presentation-cover.png', pages: 1, copies: 1, color: 'Color', status: 'Completed', submitted: 'Yesterday', size: '840 KB', type: 'PNG' },
];

function App() {
  const [session, setSession] = useState(undefined);
  const [account, setAccount] = useState(null);
  const [accountError, setAccountError] = useState('');
  const [loadingAccount, setLoadingAccount] = useState(true);
  const [studentMode, setStudentMode] = useState('dashboard');
  const [jobs, setJobs] = useState(initialJobs);
  const [printers, setPrinters] = useState([]);
  const [selectedPrinterId, setSelectedPrinterId] = useState('');
  const [search, setSearch] = useState('');
  const [toast, setToast] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [notificationsOpen, setNotificationsOpen] = useState(false);

  useEffect(() => {
    if (supabaseConfigError) {
      setSession(null);
      setLoadingAccount(false);
      return undefined;
    }

    let mounted = true;
    const loadWorkspace = async (activeSession) => {
      if (!activeSession) {
        if (mounted) {
          setAccount(null);
          setJobs([]);
          setPrinters([]);
          setSelectedPrinterId('');
          setLoadingAccount(false);
        }
        return;
      }

      if (mounted) {
        setLoadingAccount(true);
        setAccountError('');
      }
      try {
        const currentAccount = await getCurrentAccount();
        const isStaffAccount = currentAccount?.role === 'operator' || currentAccount?.role === 'admin';
        const requestedPortal = sessionStorage.getItem('print-center-auth-portal');
        if (requestedPortal && ((requestedPortal === 'operator') !== isStaffAccount)) {
          sessionStorage.removeItem('print-center-auth-portal');
          await supabase.auth.signOut();
          if (mounted) {
            setAccount(null);
            setJobs([]);
            setAccountError(requestedPortal === 'operator'
              ? 'This Google account is not an operator account. Promote its profile to operator/admin before using Operator login.'
              : 'This is an operator account. Use Operator login.');
            setLoadingAccount(false);
          }
          return;
        }
        sessionStorage.removeItem('print-center-auth-portal');
        const remoteJobs = await getJobs({ accountId: activeSession.user.id, staff: isStaffAccount });
        if (mounted) {
          setAccount(currentAccount);
          setJobs(remoteJobs.map(mapRemoteJob));
        }
      } catch (error) {
        const missingSchema = error.message.includes("Could not find the table 'public.profiles'") || error.message.includes('relation "public.profiles" does not exist');
        const message = missingSchema
          ? 'Your credentials were accepted, but the database is not initialized. Run supabase/schema.sql in the Supabase SQL Editor, then refresh this page.'
          : `Your credentials were accepted, but the workspace could not load: ${error.message}`;
        if (mounted) setAccountError(message);
      } finally {
        if (mounted) setLoadingAccount(false);
      }
    };

    supabase.auth.getSession().then(({ data: { session: activeSession } }) => {
      if (!mounted) return;
      setSession(activeSession);
      loadWorkspace(activeSession);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, activeSession) => {
      setSession(activeSession);
      loadWorkspace(activeSession);
    });
    return () => { mounted = false; subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!session || !account) return undefined;
    const channel = subscribeToJobs({
      accountId: account.id,
      staff: account.role !== 'student',
      onChange: async () => {
        try {
          const remoteJobs = await getJobs({ accountId: account.id, staff: account.role !== 'student' });
          setJobs(remoteJobs.map(mapRemoteJob));
          notify('Print queue updated.');
        } catch (error) {
          notify(`Live queue update failed: ${error.message}`);
        }
      },
    });
    return () => { supabase.removeChannel(channel); };
  }, [session, account]);

  useEffect(() => {
    if (!session || !account || account.role === 'student') return undefined;
    let mounted = true;
    const loadPrinters = async () => {
      try {
        const remotePrinters = await getPrinters();
        if (mounted) {
          setPrinters(remotePrinters);
          setSelectedPrinterId((current) => remotePrinters.some((printer) => printer.id === current) ? current : remotePrinters.find((printer) => printer.status === 'online')?.id || '');
        }
      } catch (error) {
        if (mounted) notify(`Printer status unavailable: ${error.message}`);
      }
    };
    loadPrinters();
    const channel = subscribeToPrinters({ onChange: loadPrinters });
    return () => { mounted = false; supabase.removeChannel(channel); };
  }, [session, account]);

  const notify = (message) => {
    setToast(message);
    setNotifications((current) => [{ id: crypto.randomUUID(), message, createdAt: new Date() }, ...current].slice(0, 8));
    window.setTimeout(() => setToast(''), 3000);
  };

  const copyCode = async () => {
    try { await navigator.clipboard.writeText('K7M4P2'); } catch { /* clipboard unavailable */ }
    notify('Print Code copied to clipboard');
  };

  const submitJob = async (job) => {
    try {
      const created = await createPrintJob({ accountId: account.id, file: job.file, settings: job });
      setJobs((current) => [mapRemoteJob(created), ...current]);
      setStudentMode('dashboard');
      notify('Print request sent to the center');
    } catch (error) {
      notify(`Upload failed: ${error.message}`);
    }
  };

  const printJob = async (id) => {
    if (!selectedPrinterId) {
      notify('Select an online printer before printing.');
      return;
    }
    try {
      await startPrintJob(id, selectedPrinterId);
      notify('Print request sent to the selected printer.');
    } catch (error) {
      notify(`Could not start printing: ${error.message}`);
    }
  };

  if (loadingAccount || session === undefined) return <div className="loading-screen"><span className="brand-mark"><BookOpen size={18} /></span><strong>Loading Print Center</strong></div>;
  if (supabaseConfigError) return <ConfigurationScreen message={supabaseConfigError} />;
  if (!session || !account) return <AuthScreen notify={notify} initialError={accountError} />;

  const isStaff = account.role === 'operator' || account.role === 'admin';
  if (isStaff) {
    return <>
      <OperatorArea account={account} jobs={jobs} printers={printers} selectedPrinterId={selectedPrinterId} setSelectedPrinterId={setSelectedPrinterId} search={search} setSearch={setSearch} onPrint={printJob} onSignOut={() => signOut().catch((error) => notify(error.message))} notifications={notifications} notificationsOpen={notificationsOpen} setNotificationsOpen={setNotificationsOpen} notify={notify} />
      {toast && <div className="toast"><span className="toast-icon"><Check size={15} /></span>{toast}</div>}
    </>;
  }

  return <div className="app-shell">
    <header className="topbar">
      <button className="brand" onClick={() => setStudentMode('dashboard')} aria-label="Go to home">
        <span className="brand-mark"><BookOpen size={18} strokeWidth={2.4} /></span>
        <span>Library <strong>Print Center</strong></span>
      </button>
      <div className="topbar-right">
        <div className="notification-wrap"><button className="icon-button notification-button" aria-label="Notifications" onClick={() => setNotificationsOpen(!notificationsOpen)}><Bell size={18} />{notifications.length > 0 && <span className="notification-badge">{notifications.length}</span>}</button>{notificationsOpen && <NotificationPanel notifications={notifications} />}</div>
        <button className="avatar" aria-label="Open profile menu" onClick={() => setMenuOpen(!menuOpen)}>PS</button>
        {menuOpen && <div className="profile-menu"><strong>{account.name}</strong><span>{account.role} account</span><button onClick={() => signOut().catch((error) => notify(error.message))}>Sign out</button></div>}
      </div>
    </header>

    <StudentArea mode={studentMode} setMode={setStudentMode} jobs={jobs} account={account} onCopy={copyCode} onSubmit={submitJob} notify={notify} />
    {toast && <div className="toast"><span className="toast-icon"><Check size={15} /></span>{toast}</div>}
  </div>;
}

function ConfigurationScreen({ message }) {
  return <div className="loading-screen configuration-screen"><span className="brand-mark"><Settings size={18} /></span><strong>Print Center needs configuration</strong><p>{message}</p></div>;
}

function mapRemoteJob(job) {
  return {
    id: job.id,
    name: job.file_name,
    pages: job.page_count,
    copies: job.copies,
    color: job.color_mode === 'color' ? 'Color' : 'B&W',
    status: job.status.charAt(0).toUpperCase() + job.status.slice(1),
    submitted: new Date(job.created_at || Date.now()).toLocaleDateString(),
    size: `${(job.file_size / 1024 / 1024).toFixed(1)} MB`,
    type: job.file_type,
    studentName: job.profiles?.name,
    printCode: job.profiles?.print_code,
  };
}

function AuthScreen({ notify, initialError = '' }) {
  const [portal, setPortal] = useState('student');
  const [mode, setMode] = useState('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState(initialError);
  const [successMessage, setSuccessMessage] = useState('');
  const [lastEmail, setLastEmail] = useState('');
  const isOperator = portal === 'operator';

  const changePortal = (nextPortal) => {
    setPortal(nextPortal);
    setMode('login');
    setErrorMessage('');
    setSuccessMessage('');
  };

  const signInWithGoogle = async () => {
    setBusy(true);
    setErrorMessage('');
    sessionStorage.setItem('print-center-auth-portal', portal);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
    if (error) {
      setBusy(false);
      setErrorMessage(error.message);
      notify(error.message);
    }
  };

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setErrorMessage('');
    setSuccessMessage('');
    setLastEmail(email);
    sessionStorage.setItem('print-center-auth-portal', portal);
    try {
      const result = mode === 'login'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password, options: { data: { name } } });
      if (result.error) {
        const lowerMessage = result.error.message.toLowerCase();
        const message = lowerMessage.includes('email not confirmed')
          ? 'Please confirm your email address first, then try signing in again.'
          : lowerMessage.includes('invalid login credentials')
            ? 'Email or password is incorrect. If you just registered, confirm your email first.'
            : result.error.message;
        setErrorMessage(message);
        notify(message);
      } else if (mode === 'login' && result.data.session) {
        const currentAccount = await getCurrentAccount();
        const isStaffAccount = currentAccount?.role === 'operator' || currentAccount?.role === 'admin';
        if (isOperator !== isStaffAccount) {
          await signOut();
          const message = isOperator
            ? 'This account is not an operator account. Use User login instead.'
            : 'This is an operator account. Use Operator login instead.';
          setErrorMessage(message);
          notify(message);
        }
      } else if (mode === 'register') {
        const message = result.data.session ? 'Account created. Your Print Code is ready.' : 'Account created. Check your email to confirm the account.';
        setSuccessMessage(message);
        notify(message);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to contact the authentication service.';
      setErrorMessage(`Sign-in service error: ${message}`);
      notify(message);
    } finally {
      setBusy(false);
    }
  };

  const resendConfirmation = async () => {
    if (!lastEmail) return;
    setBusy(true);
    const { error } = await supabase.auth.resend({ type: 'signup', email: lastEmail });
    setBusy(false);
    if (error) setErrorMessage(error.message);
    else setSuccessMessage(`A new confirmation email was sent to ${lastEmail}.`);
  };

  return <div className="auth-screen"><div className="auth-card">
    <div className="auth-brand"><span className="brand-mark"><BookOpen size={19} /></span><span>Library <strong>Print Center</strong></span></div>
    <div className="auth-role-switch" role="tablist" aria-label="Choose sign-in portal">
      <button className={portal === 'student' ? 'auth-role-button selected' : 'auth-role-button'} onClick={() => changePortal('student')} role="tab" aria-selected={portal === 'student'}><Home size={15} /> User login</button>
      <button className={portal === 'operator' ? 'auth-role-button selected' : 'auth-role-button'} onClick={() => changePortal('operator')} role="tab" aria-selected={portal === 'operator'}><ShieldCheck size={15} /> Operator login</button>
    </div>
    <p className="eyebrow">{isOperator ? 'Staff access' : 'Private printing, made simple'}</p>
    <h1>{isOperator ? 'Operator sign in.' : mode === 'login' ? 'Welcome back.' : 'Create your account.'}</h1>
    <p className="subheading">{isOperator ? 'Sign in to manage the print queue.' : mode === 'login' ? 'Sign in to manage your print requests.' : 'You’ll receive a permanent Print Code after joining.'}</p>
    {errorMessage && <div className="auth-message error">{errorMessage}{errorMessage.includes('confirm') && <button className="auth-inline-button" onClick={resendConfirmation} disabled={busy}>Resend confirmation email</button>}</div>}
    {successMessage && <div className="auth-message success">{successMessage}</div>}
    {mode === 'login' && <><button className="google-button" type="button" onClick={signInWithGoogle} disabled={busy}><span className="google-mark">G</span> Continue with Google</button><div className="auth-divider"><span>or use email</span></div></>}
    <form onSubmit={submit}>
      {mode === 'register' && <label>Name<input required value={name} onChange={(event) => setName(event.target.value)} placeholder="Your name" autoComplete="name" /></label>}
      <label>Email<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" autoComplete="email" /></label>
      <label>Password<input required minLength="8" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 8 characters" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} /></label>
      <button className="primary-button auth-submit" disabled={busy}>{busy ? 'Please wait...' : mode === 'login' ? 'Sign in' : 'Create account'} <ArrowUpRight size={17} /></button>
    </form>
    {!isOperator && <button className="auth-switch" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setErrorMessage(''); setSuccessMessage(''); }}>{mode === 'login' ? 'New here? Create a student account' : 'Already have an account? Sign in'}</button>}
  </div></div>;
}

function LegacyAuthScreen({ notify, initialError = '' }) {
  const [mode, setMode] = useState('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState(initialError);
  const [successMessage, setSuccessMessage] = useState('');
  const [lastEmail, setLastEmail] = useState('');
  const signInWithGoogle = async () => {
    setBusy(true);
    setErrorMessage('');
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
    if (error) {
      const message = error.message.toLowerCase().includes('provider is not enabled')
        ? 'Google sign-in is not enabled yet. Enable the Google provider in Supabase Auth, or continue with email.'
        : error.message;
      setBusy(false);
      setErrorMessage(message);
      notify(message);
    }
  };
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setErrorMessage('');
    setSuccessMessage('');
    setLastEmail(email);
    try {
      const result = mode === 'login'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password, options: { data: { name } } });
      if (result.error) {
        const lowerMessage = result.error.message.toLowerCase();
        const message = lowerMessage.includes('email not confirmed')
          ? 'Please confirm your email address first, then try signing in again.'
          : lowerMessage.includes('invalid login credentials')
            ? 'Email or password is incorrect. If you just registered, confirm your email first.'
            : result.error.message;
        setErrorMessage(message);
        notify(message);
      } else if (mode === 'register') {
        const message = result.data.session ? 'Account created. Your Print Code is ready.' : 'Account created. Check your email to confirm the account.';
        setSuccessMessage(message);
        notify(message);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to contact the authentication service.';
      setErrorMessage(`Sign-in service error: ${message}`);
      notify(message);
    } finally {
      setBusy(false);
    }
  };
  const resendConfirmation = async () => {
    if (!lastEmail) return;
    setBusy(true);
    const { error } = await supabase.auth.resend({ type: 'signup', email: lastEmail });
    setBusy(false);
    if (error) setErrorMessage(error.message);
    else setSuccessMessage(`A new confirmation email was sent to ${lastEmail}.`);
  };
  return <div className="auth-screen"><div className="auth-card"><div className="auth-brand"><span className="brand-mark"><BookOpen size={19} /></span><span>Library <strong>Print Center</strong></span></div><p className="eyebrow">Private printing, made simple</p><h1>{mode === 'login' ? 'Welcome back.' : 'Create your account.'}</h1><p className="subheading">{mode === 'login' ? 'Sign in to manage your print requests.' : 'You’ll receive a permanent Print Code after joining.'}</p>{errorMessage && <div className="auth-message error">{errorMessage}{errorMessage.includes('confirm') && <button className="auth-inline-button" onClick={resendConfirmation} disabled={busy}>Resend confirmation email</button>}</div>}{successMessage && <div className="auth-message success">{successMessage}</div>}{mode === 'login' && <><button className="google-button" type="button" onClick={signInWithGoogle} disabled={busy}><span className="google-mark">G</span> Continue with Google</button><div className="auth-divider"><span>or use email</span></div></>}<form onSubmit={submit}>{mode === 'register' && <label>Name<input required value={name} onChange={(event) => setName(event.target.value)} placeholder="Your name" autoComplete="name" /></label>}<label>Email<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" autoComplete="email" /></label><label>Password<input required minLength="8" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 8 characters" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} /></label><button className="primary-button auth-submit" disabled={busy}>{busy ? 'Please wait...' : mode === 'login' ? 'Sign in' : 'Create account'} <ArrowUpRight size={17} /></button></form><button className="auth-switch" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setErrorMessage(''); setSuccessMessage(''); }}>{mode === 'login' ? 'New here? Create a student account' : 'Already have an account? Sign in'}</button></div></div>;
}

function Sidebar({ mode, setMode }) {
  return <aside className="sidebar">
    <div className="sidebar-label">Workspace</div>
    <button className={mode === 'dashboard' ? 'nav-item active' : 'nav-item'} onClick={() => setMode('dashboard')}><LayoutDashboard size={17} /> Overview</button>
    <button className={mode === 'new-job' ? 'nav-item active' : 'nav-item'} onClick={() => setMode('new-job')}><Plus size={17} /> New print job</button>
    <button className={mode === 'history' ? 'nav-item active' : 'nav-item'} onClick={() => setMode('history')}><Clock3 size={17} /> Print history</button>
    <div className="sidebar-spacer" />
    <button className={mode === 'settings' ? 'nav-item active' : 'nav-item'} onClick={() => setMode('settings')}><Settings size={17} /> Account settings</button>
    <div className="help-card"><div className="help-icon"><ShieldCheck size={17} /></div><strong>Private by design</strong><span>Your files are removed automatically after printing.</span></div>
  </aside>;
}

function StudentArea({ mode, setMode, jobs, account, onCopy, onSubmit, notify }) {
  return <div className="workspace student-workspace">
    <Sidebar mode={mode} setMode={setMode} />
    <main className="main-content">
      {mode === 'dashboard' && <StudentDashboard jobs={jobs} account={account} setMode={setMode} onCopy={onCopy} />}
      {mode === 'new-job' && <NewJob onSubmit={onSubmit} notify={notify} />}
      {mode === 'history' && <History jobs={jobs} />}
      {mode === 'settings' && <AccountSettings account={account} />}
    </main>
  </div>;
}

function AccountSettings({ account }) {
  return <>
    <div className="page-heading compact"><div><p className="eyebrow">Your account</p><h1>Account settings</h1><p className="subheading">Review the details connected to your Print Center account.</p></div><Settings size={19} /></div>
    <section className="form-panel settings-panel">
      <div className="panel-title"><div><h2>Profile details</h2><span>Your account information is managed securely.</span></div><ShieldCheck size={19} /></div>
      <div className="setting-group"><label>Name</label><strong>{account.name}</strong></div>
      <div className="setting-group"><label>Email</label><strong>{account.email}</strong></div>
      {account.phone && <div className="setting-group"><label>Phone</label><strong>{account.phone}</strong></div>}
      <div className="setting-group"><label>Print code</label><strong className="print-code">{account.print_code}</strong></div>
      <div className="setting-group"><label>Account status</label><strong>{account.status}</strong></div>
    </section>
  </>;
}

function StudentDashboard({ jobs, account, setMode, onCopy }) {
  const waiting = jobs.filter((job) => job.status === 'Waiting');
  return <>
    <div className="page-heading"><div><p className="eyebrow">Monday, 17 September 2026</p><h1>Good morning, Pushkar <span className="wave">✦</span></h1><p className="subheading">Your documents, ready when you are.</p></div><button className="primary-button" onClick={() => setMode('new-job')}><Plus size={18} /> New print job</button></div>
    <section className="code-banner">
      <div className="code-copy"><div className="code-label"><span className="live-dot" /> Your permanent Print Code</div><div className="print-code">{account.print_code}</div><p>Tell this code to the operator when you arrive at the copy center.</p></div>
      <button className="copy-button" onClick={onCopy}><Copy size={16} /> Copy code</button>
      <div className="code-stamp">PRIVATE<br /><span>&amp;</span><br />PERSONAL</div>
    </section>
    <div className="section-heading"><div><h2>Pending prints</h2><span>{waiting.length} {waiting.length === 1 ? 'job' : 'jobs'} waiting for you</span></div><button className="text-button" onClick={() => setMode('history')}>View history <ArrowUpRight size={15} /></button></div>
    <div className="job-list">{waiting.length ? waiting.map((job) => <StudentJob key={job.id} job={job} />) : <EmptyState onClick={() => setMode('new-job')} />}</div>
    <div className="quick-stats"><div><span className="stat-icon mint"><FileText size={17} /></span><div><strong>{jobs.length}</strong><span>Total jobs</span></div></div><div><span className="stat-icon yellow"><Printer size={17} /></span><div><strong>{jobs.reduce((total, job) => total + job.pages * job.copies, 0)}</strong><span>Pages requested</span></div></div><div><span className="stat-icon blue"><ShieldCheck size={17} /></span><div><strong>24h</strong><span>File auto-delete</span></div></div></div>
  </>;
}

function StudentJob({ job }) {
  return <article className="job-row"><div className="file-icon"><FileText size={20} /></div><div className="job-info"><strong>{job.name}</strong><span>{job.pages} {job.pages === 1 ? 'page' : 'pages'} <i /> {job.color} <i /> {job.copies} {job.copies === 1 ? 'copy' : 'copies'}</span></div><div className="job-date">{job.submitted}</div><span className="status-pill waiting"><span /> Waiting</span><button className="more-button" aria-label="More actions"><MoreHorizontal size={18} /></button></article>;
}

function EmptyState({ onClick }) { return <div className="empty-state"><div className="empty-icon"><Printer size={22} /></div><strong>Nothing in the queue</strong><span>Upload something and it will appear here.</span><button className="text-button" onClick={onClick}>Start a print job <ChevronRight size={15} /></button></div>; }

function NewJob({ onSubmit, notify }) {
  const [file, setFile] = useState(null);
  const [copies, setCopies] = useState(1);
  const [color, setColor] = useState('B&W');
  const [sides, setSides] = useState('Single-sided');
  const [dragging, setDragging] = useState(false);
  const chooseFile = (selected) => { if (selected) setFile({ file: selected, name: selected.name, size: `${(selected.size / 1024 / 1024).toFixed(1)} MB`, pages: selected.type.startsWith('image/') ? 1 : 12, type: selected.type.startsWith('image/') ? 'PNG' : 'PDF' }); };
  const submit = () => { if (!file) { notify('Choose a document first'); return; } onSubmit({ ...file, copies, color, sides, pageCount: file.pages, paperSize: 'A4', orientation: 'auto' }); };
  return <>
    <div className="page-heading compact"><div><p className="eyebrow">New request</p><h1>Send something to print</h1><p className="subheading">Upload a file, choose your preferences, and you’re done.</p></div><div className="step-count"><span>01</span> of 01</div></div>
    <div className="new-job-grid">
      <section className="form-panel"><div className="panel-title"><div><h2>1. Choose a document</h2><span>PDF, JPG, JPEG or PNG up to 50 MB</span></div><Upload size={19} /></div>
        {!file ? <label className={`drop-zone ${dragging ? 'dragging' : ''}`} onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(e) => { e.preventDefault(); setDragging(false); chooseFile(e.dataTransfer.files[0]); }}><input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => chooseFile(e.target.files[0])} /><span className="upload-circle"><Upload size={20} /></span><strong>Drop your file here</strong><span>or <u>browse from your device</u></span></label> : <div className="selected-file"><div className="file-icon"><FileText size={20} /></div><div><strong>{file.name}</strong><span>{file.pages} pages <i /> {file.size}</span></div><button className="remove-file" onClick={() => setFile(null)}><X size={17} /></button></div>}
      </section>
      <section className="form-panel settings-panel"><div className="panel-title"><div><h2>2. Print preferences</h2><span>These can be changed by the operator if needed</span></div><Settings size={19} /></div>
        <div className="setting-group"><label>Copies</label><div className="stepper"><button onClick={() => setCopies(Math.max(1, copies - 1))}>−</button><strong>{copies}</strong><button onClick={() => setCopies(copies + 1)}>+</button></div></div>
        <div className="setting-group"><label>Color</label><div className="segmented"><button className={color === 'B&W' ? 'selected' : ''} onClick={() => setColor('B&W')}><span className="swatch black" /> Black &amp; white</button><button className={color === 'Color' ? 'selected' : ''} onClick={() => setColor('Color')}><span className="swatch color" /> Color</button></div></div>
        <div className="setting-group"><label>Paper size</label><div className="select-like">A4 <ChevronDown size={16} /></div></div>
        <div className="setting-group"><label>Sides</label><div className="segmented"><button className={sides === 'Single-sided' ? 'selected' : ''} onClick={() => setSides('Single-sided')}>Single-sided</button><button className={sides === 'Double-sided' ? 'selected' : ''} onClick={() => setSides('Double-sided')}>Double-sided</button></div></div>
      </section>
    </div>
    <section className="submit-bar"><div><span className="summary-label">Ready to send</span><strong>{file ? file.name : 'No document selected'}</strong><span>{file ? `${file.pages} pages · ${copies} ${copies === 1 ? 'copy' : 'copies'} · ${color}` : 'Choose a document above to continue'}</span></div><button className="primary-button" onClick={submit}><SendIcon /> Send to print center</button></section>
  </>;
}

function SendIcon() { return <ArrowUpRight size={17} />; }

function History({ jobs }) { return <><div className="page-heading compact"><div><p className="eyebrow">Your activity</p><h1>Print history</h1><p className="subheading">A record of your past requests. Files are removed after printing.</p></div><Filter size={19} /></div><div className="history-table"><div className="history-head"><span>Document</span><span>Details</span><span>Date</span><span>Status</span></div>{jobs.map((job) => <div className="history-row" key={job.id}><div className="history-doc"><div className="file-icon"><FileText size={18} /></div><strong>{job.name}</strong></div><span>{job.pages} pages · {job.color}</span><span>{job.submitted}</span><span className={`status-pill ${job.status === 'Completed' ? 'completed' : 'waiting'}`}><span /> {job.status}</span></div>)}</div></>; }

function OperatorArea({ account, jobs, printers, selectedPrinterId, setSelectedPrinterId, search, setSearch, onPrint, onSignOut, notifications, notificationsOpen, setNotificationsOpen, notify }) {
  const [filterOpen, setFilterOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState('Waiting');
  const [profileOpen, setProfileOpen] = useState(false);
  const filteredJobs = jobs.filter((job) => (statusFilter === 'All' || job.status === statusFilter) && (!search || [job.name, job.studentName, job.printCode].filter(Boolean).some((value) => value.toLowerCase().includes(search.toLowerCase()))));
  const onlinePrinters = printers.filter((printer) => printer.status === 'online');
  const selectedPrinter = printers.find((printer) => printer.id === selectedPrinterId);
  const completedToday = jobs.filter((job) => job.status === 'Completed').length;
  const initials = account.name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase();

  return <div className="operator-page">
    <aside className="operator-sidebar">
      <div className="operator-brand"><span className="brand-mark"><BookOpen size={18} /></span><div><strong>Print desk</strong><span>Operator workspace</span></div></div>
      <div className="operator-nav"><button className={statusFilter === 'Waiting' ? 'operator-nav-active' : ''} onClick={() => { setStatusFilter('Waiting'); document.getElementById('operator-queue')?.scrollIntoView({ behavior: 'smooth' }); }}><LayoutDashboard size={17} /> Queue <b>{jobs.filter((job) => job.status === 'Waiting').length}</b></button><button onClick={() => document.getElementById('operator-printer-select')?.focus()}><Printer size={17} /> Printers <b>{onlinePrinters.length}</b></button><button onClick={() => { setStatusFilter('Completed'); document.getElementById('operator-queue')?.scrollIntoView({ behavior: 'smooth' }); }}><Clipboard size={17} /> Activity</button></div>
      <div className="operator-footer"><span><span className={`online-dot ${onlinePrinters.length ? '' : 'offline-dot'}`} /> {onlinePrinters.length} {onlinePrinters.length === 1 ? 'printer' : 'printers'} connected</span><button onClick={() => notify(`Print agent ${import.meta.env.VITE_PRINT_AGENT_URL ? 'configured' : 'not configured'}. Printer status is live from Supabase.`)}><Settings size={17} /> Settings</button><button onClick={onSignOut}>Sign out</button></div>
    </aside>
    <main className="operator-main">
      <div className="operator-heading"><div><p className="eyebrow">Operator workspace / Today</p><h1>Good morning, {account.name}</h1><p className="subheading">Keep the queue moving.</p></div><div className="operator-actions"><div className="notification-wrap"><button className="icon-button notification-button" aria-label="Notifications" onClick={() => setNotificationsOpen(!notificationsOpen)}><Bell size={18} />{notifications.length > 0 && <span className="notification-badge">{notifications.length}</span>}</button>{notificationsOpen && <NotificationPanel notifications={notifications} />}</div><div className="notification-wrap"><button className="operator-avatar" aria-label="Operator account" onClick={() => setProfileOpen(!profileOpen)}>{initials}</button>{profileOpen && <OperatorProfilePanel account={account} onSignOut={onSignOut} />}</div></div></div>
      <div className="queue-stats"><div><span>Waiting to print</span><strong>{jobs.filter((job) => job.status === 'Waiting').length}</strong></div><div><span>Pages in queue</span><strong>{jobs.filter((job) => job.status === 'Waiting').reduce((total, job) => total + job.pages * job.copies, 0)}</strong></div><div><span>Completed today</span><strong>{completedToday}</strong></div><div><span>Printers online</span><strong className="printer-status"><span className={`online-dot ${onlinePrinters.length ? '' : 'offline-dot'}`} /> {onlinePrinters.length}</strong></div></div>
      <section className="queue-section" id="operator-queue"><div className="queue-toolbar"><div><h2>{statusFilter === 'Completed' ? 'Activity' : 'Print queue'}</h2><span>{statusFilter === 'Completed' ? 'Completed print jobs' : 'Requests are ordered by arrival time'}</span></div><div className="queue-controls"><label className="printer-select"><Printer size={16} /><select id="operator-printer-select" value={selectedPrinterId} onChange={(event) => setSelectedPrinterId(event.target.value)}><option value="">Select online printer</option>{printers.map((printer) => <option key={printer.id} value={printer.id} disabled={printer.status !== 'online'}>{printer.name} ({printer.status})</option>)}</select></label><div className="search-field"><Search size={17} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by student or document" /><kbd>/</kbd></div><button className="filter-button" onClick={() => setFilterOpen(!filterOpen)}><Filter size={16} /> Filter</button>{filterOpen && <div className="filter-menu"><button onClick={() => { setStatusFilter('Waiting'); setFilterOpen(false); }}>Waiting</button><button onClick={() => { setStatusFilter('Printing'); setFilterOpen(false); }}>Printing</button><button onClick={() => { setStatusFilter('Completed'); setFilterOpen(false); }}>Completed</button><button onClick={() => { setStatusFilter('All'); setFilterOpen(false); }}>All jobs</button></div>}</div></div><div className="selected-printer-note">{selectedPrinter ? <><span className="online-dot" /> Printing to <strong>{selectedPrinter.name}</strong></> : <><span className="offline-dot" /> Select an online printer before printing</>}</div><div className="operator-table"><div className="operator-table-head"><span>Student</span><span>Document</span><span>Print settings</span><span>Arrived</span><span /></div>{filteredJobs.length ? filteredJobs.map((job, index) => <div className="operator-row" key={job.id}><div className="student-cell"><div className="operator-avatar small">{job.studentName?.slice(0, 2).toUpperCase() || 'ST'}</div><div><strong>{job.studentName || 'Student'}</strong><span><b>{job.printCode || 'No code'}</b> · {index + 1} of {filteredJobs.length}</span></div></div><div className="operator-file"><FileText size={18} /><strong>{job.name}</strong></div><div><span className="setting-tag">{job.pages} pages</span><span className="setting-tag">{job.color}</span><span className="setting-tag">{job.copies} {job.copies === 1 ? 'copy' : 'copies'}</span></div><span className="arrived">{job.submitted}</span><div className="row-actions"><button className="preview-button" onClick={() => notify(`Previewing ${job.name}`)}>Preview</button>{job.status === 'Waiting' && <button className="print-button" disabled={!selectedPrinterId} onClick={() => onPrint(job.id)}><Printer size={15} /> Print</button>}</div></div>) : <div className="operator-empty"><Search size={22} /><strong>No matching jobs</strong><span>{statusFilter === 'Completed' ? 'No completed jobs found.' : 'Try another student name, Print Code, or document.'}</span></div>}</div></section><div className="operator-note"><ShieldCheck size={16} /><span>Printer availability comes from the Windows print agent. Jobs change to printing and completed only after the agent reports them.</span></div>
    </main>
  </div>;
}

function NotificationPanel({ notifications }) {
  return <div className="notification-panel"><strong>Notifications</strong>{notifications.length ? notifications.map((notification) => <div className="notification-item" key={notification.id}><span className="notification-dot" /><span>{notification.message}</span></div>) : <span className="notification-empty">No new notifications</span>}</div>;
}

function OperatorProfilePanel({ account, onSignOut }) {
  return <div className="notification-panel operator-profile-panel"><strong>{account.name}</strong><span>{account.email}</span><span>{account.role} account</span><button onClick={onSignOut}>Sign out</button></div>;
}

createRoot(document.getElementById('root')).render(<App />);
