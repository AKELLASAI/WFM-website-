let MEMBERS = [];
const CATEGORIES = {
  IT: ['Systems', 'Network', 'VPN', 'Email Issue', 'Internet Issue', 'Biometric Issue', 'System Slowness', 'Access Issue', 'Printer Issue', 'Software Installation', 'Monitor Problem', 'Keyboard/Mouse Issue', 'Others (IT Specific)'],
  HR: ['Salary Issue', 'Payslip Request', 'Loan Request', 'Tax Proof Submission', 'PF/ESI Query', 'Reimbursement Query', 'Leave Query', 'HR Policy Query', 'Others (HR/Finance Specific)']
};
const SLA_HOURS = { 1: 4, 2: 8, 3: 24, 4: 48, 5: 72 };
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
let state = { tickets: [], notifications: [] };
let signedInUser = null;
let roleRecords = [];
let directoryUsers = [];
let functionRecords = [];
let editingRoleId = null;
let activeTicketId = null;
let activeView = 'dashboard';

function applyServerState(result) {
  state = { tickets: result.tickets || [], notifications: result.notifications || [] };
}

async function loadTickets() {
  applyServerState(await apiRequest('/api/tickets'));
}

function currentUser() {
  return signedInUser;
}

function hasPermission(permission) {
  return Boolean(signedInUser?.permissions?.includes(permission));
}

async function apiRequest(endpoint, options = {}) {
  const response = await fetch(endpoint, {
    credentials: 'same-origin',
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers }
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'The request could not be completed.');
  return result;
}

function showAuth() {
  signedInUser = null;
  $('#authScreen').classList.remove('hidden');
  $('#appFrame').classList.add('hidden');
  document.body.style.overflow = '';
}

async function enterWorkspace(user) {
  signedInUser = user;
  try {
    const team = await apiRequest('/api/team');
    MEMBERS = team.members;
    await loadTickets();
  } catch {
    MEMBERS = [];
    state = { tickets: [], notifications: [] };
  }
  $('#authError').textContent = '';
  $('#signupError').textContent = '';
  $('#authScreen').classList.add('hidden');
  $('#appFrame').classList.remove('hidden');
  refreshApp();
  const firstView = ['dashboard', 'queue', 'reports', 'roleMaster', 'userMaster'].find((view) => hasPermission(({ dashboard: 'dashboard', queue: 'requests', reports: 'reports', roleMaster: 'roleMaster', userMaster: 'userMaster' })[view]));
  if (firstView) setView(firstView);
  else {
    showAuth();
    $('#authError').textContent = 'No screens are assigned to this account. Contact your administrator.';
  }
}

async function initializeAuthentication() {
  try {
    const result = await apiRequest('/api/session');
    if (result.user) await enterWorkspace(result.user);
    else showAuth();
  } catch (error) {
    showAuth();
    $('#authError').textContent = 'Unable to connect to the WFM server. Refresh this page to try again.';
  }
}

function switchAuth(mode) {
  const signup = mode === 'signup';
  $('#loginForm').classList.toggle('hidden', signup);
  $('#signupForm').classList.toggle('hidden', !signup);
  $('#authTitle').firstChild.textContent = signup ? 'Create your account' : 'Sign in to WFM';
  $('#authCopy').textContent = signup ? 'Sign up with your work details. New accounts start with the Employee role.' : 'Sign in with your work email and password.';
  $('#authError').textContent = '';
  $('#signupError').textContent = '';
  $(signup ? '#signupName' : '#loginEmail').focus();
}

async function submitAuth(event, endpoint, body, button, errorSelector, welcome) {
  event.preventDefault();
  $(errorSelector).textContent = '';
  $(button).disabled = true;
  try {
    const result = await apiRequest(endpoint, { method: 'POST', body: JSON.stringify(body) });
    await enterWorkspace(result.user);
    toast(`${welcome} ${result.user.name}.`);
  } catch (error) {
    $(errorSelector).textContent = error.message;
  } finally {
    $(button).disabled = false;
  }
}

function login(event) {
  submitAuth(event, '/api/auth/login', { email: $('#loginEmail').value, password: $('#loginPassword').value }, '#loginButton', '#authError', 'Signed in as');
}

function signup(event) {
  if ($('#signupPassword').value !== $('#signupConfirm').value) {
    event.preventDefault();
    $('#signupError').textContent = 'Passwords do not match.';
    return;
  }
  submitAuth(event, '/api/auth/signup', {
    name: $('#signupName').value.trim(), email: $('#signupEmail').value.trim(), mobile: $('#signupMobile').value.trim(),
    dept: $('#signupDept').value, password: $('#signupPassword').value
  }, '#signupButton', '#signupError', 'Welcome,');
}

async function signOut() {
  try {
    await apiRequest('/api/auth/logout', { method: 'POST' });
  } finally {
    signedInUser = null;
    $('#loginForm').reset();
    $('#signupForm').reset();
    switchAuth('login');
    showAuth();
  }
}

function initials(name) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function scopedTickets() {
  const user = currentUser();
  if (!user) return [];
  if (user.roleId === 'role-admin') return state.tickets;
  if (user.roleId === 'role-lead') return state.tickets.filter((ticket) => ticket.dept === user.dept);
  if (user.roleId === 'role-assignee') return state.tickets.filter((ticket) => ticket.assigneeId === user.id || ticket.creatorId === user.id);
  return state.tickets.filter((ticket) => ticket.creatorId === user.id);
}

function ageHours(ticket) {
  return Math.max(0, (Date.now() - new Date(ticket.createdAt).getTime()) / 3600000);
}

function slaState(ticket) {
  if (ticket.status === 'On Hold') return 'Paused';
  if (ticket.status === 'Resolved') return 'Within SLA';
  const limit = SLA_HOURS[ticket.priority] || 24;
  const ratio = ageHours(ticket) / limit;
  if (ratio >= 1) return 'Breached';
  if (ratio >= .7) return 'At risk';
  return 'Within SLA';
}

function statusClass(status) {
  return `status-${status.toLowerCase().replaceAll(' ', '-')}`;
}

function slaClass(ticket) {
  const status = slaState(ticket);
  return status === 'Breached' ? 'sla-breach' : status === 'At risk' ? 'sla-risk' : status === 'Paused' ? 'sla-paused' : 'sla-good';
}

function formatAge(ticket) {
  if (ticket.status === 'Resolved' && ticket.resolvedAt) {
    const hours = Math.max(1, Math.round((new Date(ticket.resolvedAt) - new Date(ticket.createdAt)) / 3600000));
    return hours < 24 ? `${hours}h to resolve` : `${Math.floor(hours / 24)}d to resolve`;
  }
  const hours = Math.floor(ageHours(ticket));
  return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
}

function formatDate(value, options = { month: 'short', day: 'numeric' }) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('en', options).format(new Date(value));
}

function localDateKey(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function addHours(value, amount) {
  const date = new Date(value);
  date.setHours(date.getHours() + amount);
  return date;
}

function personCell(name) {
  if (!name) return '<span class="person-name">Unassigned</span>';
  return `<div class="person-cell"><span class="person-avatar">${escapeHtml(initials(name))}</span><span class="person-name">${escapeHtml(name)}</span></div>`;
}

function requestCell(ticket) {
  return `<div class="request-cell"><div><span class="request-code">${escapeHtml(ticket.id)}</span><strong class="request-title">${escapeHtml(ticket.title)}</strong><span class="request-dept">${escapeHtml(ticket.category)} · ${escapeHtml(ticket.floor)}</span></div></div>`;
}

function ticketRow(ticket, compact = false) {
  const common = `<td>${requestCell(ticket)}</td><td>${personCell(ticket.creatorName)}</td><td>${personCell(ticket.assigneeName)}</td>`;
  const status = `<span class="status-pill ${statusClass(ticket.status)}">${escapeHtml(ticket.status)}</span>`;
  if (compact) {
    return `<tr class="tap-row" data-open-ticket="${escapeHtml(ticket.id)}"><td>${requestCell(ticket)}</td><td>${personCell(ticket.creatorName)}</td><td>${personCell(ticket.assigneeName)}</td><td><span class="priority p${ticket.priority}">P${ticket.priority}</span></td><td>${status}</td><td>${escapeHtml(formatAge(ticket))}</td><td><button class="row-open" data-open-ticket="${escapeHtml(ticket.id)}" title="Open request" aria-label="Open ${escapeHtml(ticket.id)}"><svg><use href="#i-arrow"/></svg></button></td></tr>`;
  }
  return `<tr class="tap-row" data-open-ticket="${escapeHtml(ticket.id)}"><td>${requestCell(ticket)}</td><td>${personCell(ticket.creatorName)}</td><td>${personCell(ticket.assigneeName)}</td><td>${escapeHtml(ticket.dept === 'HR' ? 'HR & Finance' : 'IT')}</td><td><span class="priority p${ticket.priority}">P${ticket.priority}</span></td><td>${status}</td><td><span class="sla-pill ${slaClass(ticket)}">${escapeHtml(slaState(ticket))}</span></td><td><button class="row-open" data-open-ticket="${escapeHtml(ticket.id)}" title="Open request" aria-label="Open ${escapeHtml(ticket.id)}"><svg><use href="#i-arrow"/></svg></button></td></tr>`;
}

function updateProfile() {
  const user = currentUser();
  if (!user) return;
  const firstName = user.name.split(' ')[0];
  const roleName = user.roleName || user.role;
  const isAdmin = user.roleId === 'role-admin';
  const isLead = user.roleId === 'role-lead';
  const assigneeReportOption = $('#reportType option[value="assignees"]');
  assigneeReportOption.disabled = !isLead && !isAdmin;
  if (assigneeReportOption.disabled && $('#reportType').value === 'assignees') $('#reportType').value = 'tickets';
  $('#sideAvatar').textContent = initials(user.name);
  $('#sideName').textContent = user.name;
  $('#sideRole').textContent = `${roleName} · ${user.dept === 'ALL' ? 'All departments' : user.dept === 'HR' ? 'HR & Finance' : user.dept}`;
  $('#pageTitle').innerHTML = `Good morning, ${escapeHtml(firstName)}<span class="heading-period">.</span>`;
  $('#dashboardNote').textContent = isAdmin ? 'Organization-wide service desk overview.' : isLead ? `${user.dept === 'HR' ? 'HR & Finance' : 'IT'} service desk, at a glance.` : 'Your requests and service updates, at a glance.';
  $('#queueSubtitle').textContent = isAdmin ? 'Organization-wide ownership, priority and service levels.' : isLead ? `${user.dept === 'HR' ? 'HR & Finance' : 'IT'} ownership, priority and service levels.` : 'Track your requests and service updates.';
  [['dashboard', 'dashboard'], ['queue', 'requests'], ['reports', 'reports'], ['roleMaster', 'roleMaster'], ['userMaster', 'userMaster']].forEach(([view, permission]) => {
    $(`#nav-${view}`).classList.toggle('hidden', !hasPermission(permission));
  });
  $$('.new-ticket').forEach((button) => button.classList.toggle('hidden', !hasPermission('createRequest')));
  $('.search-box').classList.toggle('hidden', !hasPermission('requests'));
}

function renderMetrics(tickets) {
  const active = tickets.filter((ticket) => ticket.status !== 'Resolved');
  const risk = active.filter((ticket) => ['At risk', 'Breached'].includes(slaState(ticket))).length;
  const resolved = tickets.filter((ticket) => ticket.status === 'Resolved' && new Date(ticket.resolvedAt || ticket.createdAt).getMonth() === new Date().getMonth()).length;
  const within = active.filter((ticket) => slaState(ticket) === 'Within SLA').length;
  const compliance = active.length ? Math.round(within / active.length * 100) : 100;
  const values = [
    { label: 'Active requests', value: active.length, note: `${tickets.filter((ticket) => ticket.status === 'New').length} awaiting assignment`, icon: 'i-ticket' },
    { label: 'SLA attention', value: risk, note: `${active.filter((ticket) => slaState(ticket) === 'Breached').length} past target`, icon: 'i-clock' },
    { label: 'Resolved this month', value: resolved, note: 'Requests completed', icon: 'i-check' },
    { label: 'SLA compliance', value: `${compliance}%`, note: 'Active requests within target', icon: 'i-chart' }
  ];
  $('#metricGrid').innerHTML = values.map((item) => `<article class="metric-card"><div class="metric-top"><span>${item.label}</span><span class="metric-symbol"><svg><use href="#${item.icon}"/></svg></span></div><div class="metric-value"><strong>${item.value}</strong></div><div class="metric-foot">${item.note}</div></article>`).join('');
  $('#navOpenCount').textContent = active.length;
  $('#teamOnlineCount').textContent = `${MEMBERS.length.toString().padStart(2, '0')} online`;
  $('#slaPercent').textContent = `${compliance}%`;
  $('#slaRing').style.setProperty('--sla', `${compliance * 3.6}deg`);
  $('#slaWithinCount').textContent = within;
  $('#slaRiskCount').textContent = active.filter((ticket) => slaState(ticket) === 'At risk').length;
  $('#slaBreachCount').textContent = active.filter((ticket) => slaState(ticket) === 'Breached').length;
}

function renderActivityChart(tickets) {
  const days = Array.from({ length: 7 }, (_, index) => {
    const day = new Date();
    day.setDate(day.getDate() - (6 - index));
    day.setHours(0, 0, 0, 0);
    const end = new Date(day);
    end.setDate(end.getDate() + 1);
    return { date: day, count: 0, resolved: 0, end };
  });
  tickets.forEach((ticket) => {
    const created = new Date(ticket.createdAt);
    const index = days.findIndex((day) => created >= day.date && created < day.end);
    if (index >= 0) days[index].count += 1;
    if (ticket.resolvedAt) {
      const resolvedAt = new Date(ticket.resolvedAt);
      const resolvedIndex = days.findIndex((day) => resolvedAt >= day.date && resolvedAt < day.end);
      if (resolvedIndex >= 0) days[resolvedIndex].resolved += 1;
    }
  });
  const max = Math.max(2, ...days.map((day) => day.count));
  $('#weeklyTotal').textContent = days.reduce((sum, day) => sum + day.count, 0);
  $('#activityChart').innerHTML = days.map((day) => `<div class="chart-column" title="${formatDate(day.date, { weekday: 'long', month: 'long', day: 'numeric' })}: ${day.count} created, ${day.resolved} resolved"><div class="chart-bars"><span class="chart-bar" style="height:${Math.max(6, day.count / max * 100)}%"></span><span class="chart-bar resolved" style="height:${Math.max(5, day.resolved / max * 100)}%"></span></div><span class="chart-day">${formatDate(day.date, { weekday: 'short' })}</span></div>`).join('');
}

function renderDashboard() {
  const tickets = scopedTickets();
  renderMetrics(tickets);
  renderActivityChart(tickets);
  $('#recentRows').innerHTML = [...tickets].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 6).map((ticket) => ticketRow(ticket, true)).join('');
}

function matchesTicket(ticket, search) {
  if (!search) return true;
  const text = [ticket.id, ticket.title, ticket.creatorName, ticket.assigneeName, ticket.category, ticket.dept].join(' ').toLowerCase();
  return text.includes(search.toLowerCase());
}

function renderQueue() {
  const user = currentUser();
  let tickets = scopedTickets();
  const status = $('#statusFilter').value;
  const dept = $('#deptFilter').value;
  const search = $('#queueSearch').value.trim() || $('#globalSearch').value.trim();
  if (status === 'active') tickets = tickets.filter((ticket) => ticket.status !== 'Resolved');
  else if (status === 'breached') tickets = tickets.filter((ticket) => slaState(ticket) === 'Breached');
  else if (status !== 'all') tickets = tickets.filter((ticket) => ticket.status === status);
  if (dept !== 'all') tickets = tickets.filter((ticket) => ticket.dept === dept);
  tickets = tickets.filter((ticket) => matchesTicket(ticket, search)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  $('#ticketRows').innerHTML = tickets.map((ticket) => ticketRow(ticket)).join('');
  $('#emptyQueue').classList.toggle('hidden', tickets.length > 0);
  $('.queue-table').classList.toggle('hidden', tickets.length === 0);
  $('#queueResultCount').textContent = tickets.length;
  $('#queueScopeLabel').textContent = user.roleId === 'role-admin' ? 'Organization-wide request access' : user.roleId === 'role-lead' ? `${user.dept === 'HR' ? 'HR & Finance' : 'IT'} department requests` : user.roleId === 'role-assignee' ? 'Requests assigned to or raised by you' : 'Requests raised by you';
}

function setView(view) {
  const permissions = { dashboard: 'dashboard', queue: 'requests', reports: 'reports', roleMaster: 'roleMaster', userMaster: 'userMaster' };
  if (!permissions[view]) return;
  if (!hasPermission(permissions[view])) {
    toast('Your role does not allow this screen.', true);
    return;
  }
  activeView = view;
  $$('.page-view').forEach((page) => page.classList.toggle('is-visible', page.id === `page-${view}`));
  $$('.nav-item').forEach((button) => button.classList.toggle('is-active', button.dataset.view === view));
  $('#crumbCurrent').textContent = ({ dashboard: 'Overview', queue: 'Requests', reports: 'Reports', roleMaster: 'Role master', userMaster: 'User master' })[view];
  if (view === 'dashboard') renderDashboard();
  if (view === 'queue') renderQueue();
  if (view === 'reports') renderReport();
  if (view === 'roleMaster') loadRoleMaster();
  if (view === 'userMaster') loadUserMaster();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function toast(message, isError = false) {
  const element = document.createElement('div');
  element.className = `toast${isError ? ' error' : ''}`;
  element.textContent = message;
  $('#toastRegion').append(element);
  window.setTimeout(() => element.remove(), 3200);
}

function showBackdrop(id) {
  $(`#${id}`).classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function hideBackdrop(id) {
  $(`#${id}`).classList.add('hidden');
  if ($$('.modal-backdrop:not(.hidden)').length === 0) document.body.style.overflow = '';
}

function openCreate() {
  if (!hasPermission('createRequest')) return toast('Your role does not allow creating requests.', true);
  const form = $('#createForm');
  form.reset();
  $('#createDept').value = currentUser().dept === 'HR' ? 'HR' : 'IT';
  updateCategories();
  $('#createError').textContent = '';
  showBackdrop('createBackdrop');
  $('#createTitle').focus();
}

function updateCategories() {
  const department = $('#createDept').value;
  $('#createCategory').innerHTML = CATEGORIES[department].map((category) => `<option>${escapeHtml(category)}</option>`).join('');
}

function statusOptions(ticket) {
  const user = currentUser();
  if (!hasPermission('updateTickets')) return [ticket.status];
  let allowed;
  if (user.roleId === 'role-employee') allowed = ticket.status === 'Resolved' ? ['Resolved', 'Reopened'] : [ticket.status];
  else if (user.roleId === 'role-assignee') {
    allowed = ['In Progress', 'On Hold', 'Resolved'];
    if (['New', 'Assigned', 'Reopened'].includes(ticket.status)) allowed.unshift(ticket.status);
    if (ticket.status === 'Resolved') allowed = ['Resolved', 'Reopened'];
  } else allowed = ['New', 'Assigned', 'In Progress', 'On Hold', 'Resolved', 'Reopened'];
  return [...new Set(allowed)];
}

function openTicket(id) {
  const ticket = state.tickets.find((item) => item.id === id);
  if (!ticket || !scopedTickets().some((item) => item.id === id)) return;
  activeTicketId = id;
  $('#detailId').textContent = `${ticket.id} · ${ticket.dept === 'HR' ? 'HR & Finance' : 'IT'} / ${ticket.category}`;
  $('#detailTitle').textContent = ticket.title;
  $('#detailDescription').textContent = ticket.description;
  $('#detailBadges').innerHTML = `<span class="status-pill ${statusClass(ticket.status)}">${escapeHtml(ticket.status)}</span><span class="priority p${ticket.priority}">P${ticket.priority} · ${['', 'Critical', 'High', 'Normal', 'Low', 'Planned'][ticket.priority]}</span><span class="sla-pill ${slaClass(ticket)}">${escapeHtml(slaState(ticket))}</span>`;
  const meta = [
    ['REQUESTER', `${ticket.creatorName} · ${ticket.creatorEmpId}`], ['ASSIGNEE', ticket.assigneeName || 'Unassigned'],
    ['FLOOR', ticket.floor], ['CREATED', formatDate(ticket.createdAt, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })],
    ['TARGET DATE', ticket.expectedDate ? formatDate(ticket.expectedDate, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Not specified'],
    ['EXPECTED COMPLETION', ticket.eta ? formatDate(ticket.eta, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Not set']
  ];
  $('#detailMeta').innerHTML = meta.map(([label, value]) => `<div class="meta-item"><small>${label}</small><strong>${escapeHtml(value)}</strong></div>`).join('');
  const canAssign = hasPermission('assignTickets') && ticket.status !== 'Resolved';
  $('#assignmentSection').classList.toggle('hidden', !canAssign);
  const members = MEMBERS.filter((person) => currentUser().roleId === 'role-admin' || person.dept === ticket.dept);
  $('#assigneeSelect').innerHTML = `<option value="">Select an assignee</option>${members.map((person) => `<option value="${person.id}" ${person.id === ticket.assigneeId ? 'selected' : ''}>${escapeHtml(person.name)} · ${person.dept}</option>`).join('')}`;
  const options = statusOptions(ticket);
  $('#statusSelect').innerHTML = options.map((option) => `<option value="${option}" ${option === ticket.status ? 'selected' : ''}>${option === 'On Hold' ? 'On hold · pause SLA' : option}</option>`).join('');
  $('#statusSelect').disabled = !hasPermission('updateTickets');
  $('#etaInput').value = ticket.eta || '';
  $('#etaInput').disabled = !hasPermission('updateTickets');
  $('#remarkInput').value = '';
  $('#detailError').textContent = '';
  $('#historyCount').textContent = `${ticket.history.length} updates`;
  $('#historyList').innerHTML = [...ticket.history].reverse().map((item) => `<li class="history-item"><strong>${escapeHtml(item.actor)}</strong><span>${escapeHtml(item.action)}</span><time>${formatDate(item.time, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</time></li>`).join('');
  showBackdrop('ticketBackdrop');
}

function renderNotifications() {
  const unread = state.notifications.filter((item) => !item.read).length;
  $('#notificationDot').classList.toggle('hidden', unread === 0);
  $('#notificationList').innerHTML = state.notifications.length ? state.notifications.slice(0, 12).map((item) => `<button class="notification-item" data-notification-ticket="${escapeHtml(item.ticketId)}">${escapeHtml(item.text)}<small>${formatDate(item.time, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}${item.read ? '' : ' · New'}</small></button>`).join('') : '<div class="notification-item">No recent activity.</div>';
}

async function saveTicketUpdate(event) {
  event.preventDefault();
  if (!hasPermission('updateTickets')) return toast('Your role does not allow ticket updates.', true);
  const ticket = state.tickets.find((item) => item.id === activeTicketId);
  if (!ticket) return;
  const eta = $('#etaInput').value;
  $('#detailError').textContent = '';
  try {
    applyServerState(await apiRequest(`/api/tickets/${encodeURIComponent(ticket.id)}/update`, {
      method: 'POST',
      body: JSON.stringify({ status: $('#statusSelect').value, remark: $('#remarkInput').value.trim(), eta, etaUtc: eta ? new Date(eta).toISOString() : null })
    }));
    refreshApp();
    openTicket(ticket.id);
    toast('Request updated.');
  } catch (error) {
    $('#detailError').textContent = error.message;
  }
}

async function assignTicket() {
  if (!hasPermission('assignTickets')) return toast('Your role does not allow ticket assignment.', true);
  const ticket = state.tickets.find((item) => item.id === activeTicketId);
  const member = MEMBERS.find((person) => person.id === $('#assigneeSelect').value);
  if (!ticket || !member) {
    $('#detailError').textContent = 'Choose a service team member first.';
    return;
  }
  try {
    applyServerState(await apiRequest(`/api/tickets/${encodeURIComponent(ticket.id)}/assign`, { method: 'POST', body: JSON.stringify({ assigneeId: member.id }) }));
    refreshApp();
    openTicket(ticket.id);
    toast(`Assigned to ${member.name}.`);
  } catch (error) {
    $('#detailError').textContent = error.message;
  }
}

async function createTicket(event) {
  event.preventDefault();
  if (!hasPermission('createRequest')) return toast('Your role does not allow creating requests.', true);
  const error = $('#createError');
  error.textContent = '';
  if (!$('#createFloor').value) {
    error.textContent = 'Choose a floor location.';
    return;
  }
  try {
    const result = await apiRequest('/api/tickets', {
      method: 'POST',
      body: JSON.stringify({
        dept: $('#createDept').value, category: $('#createCategory').value, floor: $('#createFloor').value,
        priority: Number($('#createPriority').value), title: $('#createTitle').value.trim(),
        description: $('#createDescription').value.trim(), expectedDate: $('#createExpected').value
      })
    });
    applyServerState(result);
    $('#createForm').reset();
    updateCategories();
    hideBackdrop('createBackdrop');
    refreshApp();
    $('#statusFilter').value = 'active';
    $('#deptFilter').value = 'all';
    $('#queueSearch').value = '';
    $('#globalSearch').value = '';
    setView('queue');
    toast(`${result.ticket.id} created.`);
  } catch (err) {
    error.textContent = err.message;
  }
}

function reportRange(tickets) {
  const from = $('#reportFrom').value;
  const to = $('#reportTo').value;
  return tickets.filter((ticket) => {
    const day = localDateKey(new Date(ticket.createdAt));
    return (!from || day >= from) && (!to || day <= to);
  });
}

function renderReport() {
  const user = currentUser();
  const assigneeReportOption = $('#reportType option[value="assignees"]');
  if (assigneeReportOption.disabled && $('#reportType').value === 'assignees') $('#reportType').value = 'tickets';
  const tickets = reportRange(scopedTickets());
  const type = $('#reportType').value;
  const from = $('#reportFrom').value;
  const to = $('#reportTo').value;
  $('#reportCaption').textContent = type === 'tickets' ? 'Request detail' : 'Assignee performance';
  $('#reportPeriod').textContent = `${from ? formatDate(`${from}T12:00:00`, { month: 'short', day: 'numeric', year: 'numeric' }) : 'All dates'} — ${to ? formatDate(`${to}T12:00:00`, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Today'}`;
  const resolved = tickets.filter((ticket) => ticket.status === 'Resolved').length;
  const breached = tickets.filter((ticket) => slaState(ticket) === 'Breached').length;
  const compliance = tickets.length ? Math.round((tickets.length - breached) / tickets.length * 100) : 100;
  $('#reportSummary').innerHTML = `<div class="report-stat"><span>Requests in period</span><strong>${tickets.length}</strong></div><div class="report-stat"><span>Resolved</span><strong>${resolved}</strong></div><div class="report-stat"><span>SLA compliance</span><strong>${compliance}%</strong></div>`;
  if (type === 'tickets') {
    $('#reportHead').innerHTML = '<tr><th>REQUEST</th><th>DEPARTMENT</th><th>CREATED</th><th>ASSIGNEE</th><th>PRIORITY</th><th>STATUS</th><th>SLA</th></tr>';
    $('#reportRows').innerHTML = tickets.length ? tickets.map((ticket) => `<tr><td><span class="request-code">${escapeHtml(ticket.id)}</span><strong class="request-title">${escapeHtml(ticket.title)}</strong></td><td>${escapeHtml(ticket.dept === 'HR' ? 'HR & Finance' : 'IT')}</td><td>${formatDate(ticket.createdAt, { month: 'short', day: 'numeric' })}</td><td>${escapeHtml(ticket.assigneeName || 'Unassigned')}</td><td><span class="priority p${ticket.priority}">P${ticket.priority}</span></td><td><span class="status-pill ${statusClass(ticket.status)}">${escapeHtml(ticket.status)}</span></td><td><span class="sla-pill ${slaClass(ticket)}">${escapeHtml(slaState(ticket))}</span></td></tr>`).join('') : '';
  } else {
    $('#reportHead').innerHTML = '<tr><th>ASSIGNEE</th><th>DEPARTMENT</th><th>ASSIGNED</th><th>RESOLVED</th><th>ACTIVE</th><th>SLA BREACHED</th><th>COMPLIANCE</th></tr>';
    const members = MEMBERS.filter((person) => user.roleId === 'role-admin' || person.dept === user.dept);
    $('#reportRows').innerHTML = members.map((member) => {
      const assigned = tickets.filter((ticket) => ticket.assigneeId === member.id);
      const memberResolved = assigned.filter((ticket) => ticket.status === 'Resolved').length;
      const memberBreached = assigned.filter((ticket) => slaState(ticket) === 'Breached').length;
      const memberCompliance = assigned.length ? Math.round((assigned.length - memberBreached) / assigned.length * 100) : 100;
      return `<tr><td>${personCell(member.name)}</td><td>${member.dept === 'HR' ? 'HR & Finance' : 'IT'}</td><td>${assigned.length}</td><td>${memberResolved}</td><td>${assigned.length - memberResolved}</td><td>${memberBreached}</td><td>${memberCompliance}%</td></tr>`;
    }).join('');
  }
  $('#emptyReport').classList.toggle('hidden', type === 'assignees' || tickets.length > 0);
  $('.report-table').classList.toggle('hidden', type === 'tickets' && tickets.length === 0);
  $('#reportCount').textContent = `${tickets.length} records · ${user.roleId === 'role-admin' ? 'all departments' : user.dept === 'HR' ? 'HR & Finance' : user.dept}`;
}

function exportReport() {
  const tickets = reportRange(scopedTickets());
  const type = $('#reportType').value;
  let rows;
  if (type === 'tickets') {
    rows = [['Request ID', 'Title', 'Department', 'Category', 'Floor', 'Priority', 'Status', 'Requester', 'Assignee', 'Created', 'SLA']];
    tickets.forEach((ticket) => rows.push([ticket.id, ticket.title, ticket.dept, ticket.category, ticket.floor, `P${ticket.priority}`, ticket.status, ticket.creatorName, ticket.assigneeName || 'Unassigned', ticket.createdAt, slaState(ticket)]));
  } else {
    rows = [['Assignee', 'Department', 'Assigned', 'Resolved', 'Active', 'SLA Breached', 'Compliance']];
    MEMBERS.filter((person) => currentUser().roleId === 'role-admin' || person.dept === currentUser().dept).forEach((person) => {
      const assigned = tickets.filter((ticket) => ticket.assigneeId === person.id);
      const breached = assigned.filter((ticket) => slaState(ticket) === 'Breached').length;
      rows.push([person.name, person.dept, assigned.length, assigned.filter((ticket) => ticket.status === 'Resolved').length, assigned.filter((ticket) => ticket.status !== 'Resolved').length, breached, `${assigned.length ? Math.round((assigned.length - breached) / assigned.length * 100) : 100}%`]);
    });
  }
  const csv = rows.map((row) => row.map((value) => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `WFM_${type}_${$('#reportFrom').value || 'all'}_${$('#reportTo').value || 'today'}.csv`;
  link.click();
  URL.revokeObjectURL(url);
  toast('Report exported.');
}

function refreshApp() {
  updateProfile();
  renderDashboard();
  renderQueue();
  renderReport();
  renderNotifications();
  $('#lastUpdated').textContent = `Updated ${new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' }).format(new Date())}`;
}

function setDefaultReportDates() {
  const now = new Date();
  $('#reportTo').value = localDateKey(now);
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  $('#reportFrom').value = localDateKey(start);
}

async function loadRoleMaster(selectId = editingRoleId) {
  try {
    const result = await apiRequest('/api/admin/roles');
    roleRecords = result.roles;
    functionRecords = result.functions;
    $('#roleEditorSelect').innerHTML = `<option value="">New role</option>${roleRecords.map((role) => `<option value="${escapeHtml(role.id)}">${escapeHtml(role.name)}</option>`).join('')}`;
    const selectedRole = roleRecords.find((role) => role.id === selectId) || roleRecords[0];
    renderRoleEditor(selectedRole || null);
    $('#roleRows').innerHTML = roleRecords.map((role) => {
      const labels = role.permissions.map((permission) => functionRecords.find((item) => item.id === permission)?.label).filter(Boolean);
      return `<tr><td><strong>${escapeHtml(role.name)}</strong></td><td>${escapeHtml(labels.join(', ') || 'No access')}</td><td>${role.userCount || 0}</td><td><button class="button button-quiet" data-edit-role="${escapeHtml(role.id)}">Edit</button><button class="button button-quiet" data-delete-role="${escapeHtml(role.id)}" ${role.userCount ? 'disabled title="Reassign users before deleting"' : ''}>Delete</button></td></tr>`;
    }).join('');
  } catch (error) {
    toast(error.message, true);
  }
}

function renderRoleEditor(role) {
  editingRoleId = role?.id || null;
  $('#roleEditorSelect').value = editingRoleId || '';
  $('#roleFormTitle').textContent = role ? 'Edit role' : 'Create role';
  $('#roleNameInput').value = role?.name || '';
  const selected = new Set(role?.permissions || []);
  $('#rolePermissionGrid').innerHTML = functionRecords.map((item) => `<label class="permission-item"><input type="checkbox" data-role-permission="${escapeHtml(item.id)}" ${selected.has(item.id) ? 'checked' : ''}><span>${escapeHtml(item.label)}</span><small class="permission-type">${escapeHtml(item.type)}</small></label>`).join('');
}

async function saveRole(event) {
  event.preventDefault();
  const name = $('#roleNameInput').value.trim();
  const permissions = $$('[data-role-permission]:checked').map((input) => input.dataset.rolePermission);
  const screenPermissions = functionRecords.filter((item) => item.type === 'screen' && permissions.includes(item.id));
  $('#roleError').textContent = '';
  if (!screenPermissions.length) {
    $('#roleError').textContent = 'Allow at least one screen for this role.';
    return;
  }
  try {
    const endpoint = editingRoleId ? `/api/admin/roles/${encodeURIComponent(editingRoleId)}` : '/api/admin/roles';
    const result = await apiRequest(endpoint, { method: editingRoleId ? 'PUT' : 'POST', body: JSON.stringify({ name, permissions }) });
    await loadRoleMaster(result.role.id);
    toast('Role permissions saved.');
  } catch (error) {
    $('#roleError').textContent = error.message;
  }
}

async function deleteRole(roleId) {
  const role = roleRecords.find((item) => item.id === roleId);
  if (!role || role.userCount || !window.confirm(`Delete the ${role.name} role?`)) return;
  try {
    await apiRequest(`/api/admin/roles/${encodeURIComponent(roleId)}`, { method: 'DELETE' });
    await loadRoleMaster(null);
    toast('Role deleted.');
  } catch (error) {
    toast(error.message, true);
  }
}

async function loadUserMaster() {
  try {
    const [result, team] = await Promise.all([apiRequest('/api/admin/users'), apiRequest('/api/team')]);
    directoryUsers = result.users;
    roleRecords = result.roles;
    MEMBERS = team.members;
    $('#userRoleInput').innerHTML = roleRecords.map((role) => `<option value="${escapeHtml(role.id)}">${escapeHtml(role.name)}</option>`).join('');
    renderUsers();
  } catch (error) {
    toast(error.message, true);
  }
}

function renderUsers() {
  const search = $('#userSearch').value.trim().toLowerCase();
  const users = directoryUsers.filter((user) => `${user.name} ${user.email} ${user.mobile}`.toLowerCase().includes(search));
  $('#userCount').textContent = users.length;
  $('#userRows').innerHTML = users.map((user) => `<tr><td>${personCell(user.name)}${user.empId ? `<small class="request-dept">${escapeHtml(user.empId)}</small>` : ''}</td><td>${escapeHtml(user.email)}</td><td>${escapeHtml(user.mobile)}</td><td>${escapeHtml(user.dept === 'HR' ? 'HR & Finance' : user.dept === 'ALL' ? 'All departments' : user.dept)}</td><td>${escapeHtml(user.roleName)}</td><td><strong class="${user.active ? 'master-user-active' : 'master-user-inactive'}">${user.active ? 'Active' : 'Inactive'}</strong></td><td><button class="button button-quiet" data-edit-user="${escapeHtml(user.id)}">Edit</button><button class="button button-quiet" data-toggle-user="${escapeHtml(user.id)}">${user.active ? 'Deactivate' : 'Activate'}</button></td></tr>`).join('');
  $('#emptyUsers').classList.toggle('hidden', users.length > 0);
  $('.master-table', $('#page-userMaster')).classList.toggle('hidden', users.length === 0);
}

function openUserEditor(userId = '') {
  const user = directoryUsers.find((item) => item.id === userId);
  $('#userForm').reset();
  $('#userFormError').textContent = '';
  $('#userIdInput').value = user?.id || '';
  $('#userDialogTitle').textContent = user ? 'Edit user' : 'Add user';
  $('#userNameInput').value = user?.name || '';
  $('#userEmpIdInput').value = user?.empId || '';
  $('#userEmailInput').value = user?.email || '';
  $('#userMobileInput').value = user?.mobile || '';
  $('#userDeptInput').value = user?.dept || (currentUser().dept === 'HR' ? 'HR' : 'IT');
  $('#userRoleInput').value = user?.roleId || roleRecords[0]?.id || '';
  $('#userActiveInput').checked = user?.active ?? true;
  $('#userPasswordInput').required = !user;
  showBackdrop('userMasterBackdrop');
}

async function saveUser(event) {
  event.preventDefault();
  const userId = $('#userIdInput').value;
  const body = {
    name: $('#userNameInput').value.trim(), empId: $('#userEmpIdInput').value.trim(),
    email: $('#userEmailInput').value.trim(), mobile: $('#userMobileInput').value.trim(),
    dept: $('#userDeptInput').value, roleId: $('#userRoleInput').value, active: $('#userActiveInput').checked,
    password: $('#userPasswordInput').value
  };
  $('#userFormError').textContent = '';
  try {
    await apiRequest(userId ? `/api/admin/users/${encodeURIComponent(userId)}` : '/api/admin/users', {
      method: userId ? 'PUT' : 'POST', body: JSON.stringify(body)
    });
    hideBackdrop('userMasterBackdrop');
    await loadUserMaster();
    toast(userId ? 'User updated.' : 'User added.');
  } catch (error) {
    $('#userFormError').textContent = error.message;
  }
}

async function toggleUserActive(userId) {
  const user = directoryUsers.find((item) => item.id === userId);
  if (!user) return;
  try {
    await apiRequest(`/api/admin/users/${encodeURIComponent(userId)}`, {
      method: 'PUT',
      body: JSON.stringify({ name: user.name, empId: user.empId, email: user.email, mobile: user.mobile, dept: user.dept, roleId: user.roleId, active: !user.active })
    });
    await loadUserMaster();
    toast(`User ${user.active ? 'deactivated' : 'activated'}.`);
  } catch (error) {
    toast(error.message, true);
  }
}

document.addEventListener('click', (event) => {
  const editRole = event.target.closest('[data-edit-role]');
  if (editRole) renderRoleEditor(roleRecords.find((role) => role.id === editRole.dataset.editRole));
  const removeRole = event.target.closest('[data-delete-role]');
  if (removeRole) deleteRole(removeRole.dataset.deleteRole);
  const editUser = event.target.closest('[data-edit-user]');
  if (editUser) openUserEditor(editUser.dataset.editUser);
  const toggleUser = event.target.closest('[data-toggle-user]');
  if (toggleUser) toggleUserActive(toggleUser.dataset.toggleUser);
  const viewButton = event.target.closest('[data-view]');
  if (viewButton) {
    if (viewButton.dataset.filter === 'active') $('#statusFilter').value = 'active';
    setView(viewButton.dataset.view);
  }
  if (event.target.closest('.new-ticket')) openCreate();
  const openButton = event.target.closest('[data-open-ticket]');
  if (openButton) openTicket(openButton.dataset.openTicket);
  const notification = event.target.closest('[data-notification-ticket]');
  if (notification) {
    $('#notificationPanel').classList.add('hidden');
    apiRequest('/api/notifications/read', { method: 'POST', body: JSON.stringify({ ticketId: notification.dataset.notificationTicket }) })
      .then(applyServerState).then(refreshApp).catch(() => {});
    openTicket(notification.dataset.notificationTicket);
  }
  const close = event.target.closest('[data-close]');
  if (close) hideBackdrop(close.dataset.close);
  if (event.target.classList.contains('modal-backdrop')) hideBackdrop(event.target.id);
});

$('#loginForm').addEventListener('submit', login);
$('#signupForm').addEventListener('submit', signup);
document.querySelectorAll('[data-auth-switch]').forEach((button) => button.addEventListener('click', () => switchAuth(button.dataset.authSwitch)));
$('#logoutButton').addEventListener('click', signOut);
$('#roleEditorSelect').addEventListener('change', () => renderRoleEditor(roleRecords.find((role) => role.id === $('#roleEditorSelect').value) || null));
$('#roleForm').addEventListener('submit', saveRole);
$('#newRoleButton').addEventListener('click', () => renderRoleEditor(null));
$('#newUserButton').addEventListener('click', () => openUserEditor());
$('#userForm').addEventListener('submit', saveUser);
$('#userSearch').addEventListener('input', renderUsers);
$('#createDept').addEventListener('change', updateCategories);
$('#createForm').addEventListener('submit', createTicket);
$('#ticketActionForm').addEventListener('submit', saveTicketUpdate);
$('#assignTicket').addEventListener('click', assignTicket);
$('#queueSearch').addEventListener('input', renderQueue);
$('#statusFilter').addEventListener('change', renderQueue);
$('#deptFilter').addEventListener('change', renderQueue);
$('#resetFilters').addEventListener('click', () => {
  $('#statusFilter').value = 'active';
  $('#deptFilter').value = 'all';
  $('#queueSearch').value = '';
  $('#globalSearch').value = '';
  renderQueue();
});
$('#globalSearch').addEventListener('input', () => {
  if (activeView !== 'queue') setView('queue');
  $('#queueSearch').value = '';
  renderQueue();
});
$('#notificationBtn').addEventListener('click', () => $('#notificationPanel').classList.toggle('hidden'));
$('#markReadBtn').addEventListener('click', () => {
  apiRequest('/api/notifications/read', { method: 'POST', body: '{}' }).then(applyServerState).then(refreshApp).catch(() => {});
  renderNotifications();
});
$('#reportFrom').addEventListener('change', renderReport);
$('#reportTo').addEventListener('change', renderReport);
$('#reportType').addEventListener('change', renderReport);
$('#generateReport').addEventListener('click', () => { renderReport(); toast('Report updated.'); });
$('#exportReport').addEventListener('click', exportReport);
$('#printReport').addEventListener('click', () => window.print());
$('#refreshBtn').addEventListener('click', () => { refreshApp(); toast('Workspace refreshed.'); });

document.addEventListener('click', (event) => {
  if (!event.target.closest('#notificationPanel, #notificationBtn')) $('#notificationPanel').classList.add('hidden');
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    $$('.modal-backdrop:not(.hidden)').forEach((backdrop) => hideBackdrop(backdrop.id));
    $('#notificationPanel').classList.add('hidden');
  }
  if (event.key === 'n' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) openCreate();
  if (event.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) {
    event.preventDefault();
    $('#globalSearch').focus();
  }
});

const today = new Date();
$('#todayDate').textContent = new Intl.DateTimeFormat('en', { weekday: 'short', month: 'short', day: 'numeric' }).format(today);
$('#welcomeEyebrow').textContent = new Intl.DateTimeFormat('en', { weekday: 'long', month: 'long', day: 'numeric' }).format(today).toUpperCase();
const localTimeFormatter = new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
function updateLiveClock() {
  const now = new Date();
  $('#liveClock').dateTime = now.toISOString();
  $('#liveClock').textContent = localTimeFormatter.format(now);
}
updateLiveClock();
window.setInterval(updateLiveClock, 1000);
setDefaultReportDates();
updateCategories();
initializeAuthentication();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
try { localStorage.removeItem('wfm_rebuild_v1'); } catch {}
window.setInterval(() => {
  if (!signedInUser || document.hidden) return;
  loadTickets().then(() => { if ($('#ticketBackdrop').classList.contains('hidden') && $('#createBackdrop').classList.contains('hidden')) refreshApp(); }).catch(() => {});
}, 30000);
