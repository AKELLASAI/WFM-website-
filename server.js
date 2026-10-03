const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 8000);
const STATIC_DIR = path.join(__dirname, 'New fsds ');
const DATA_FILE = process.env.WFM_DATA_FILE || path.join(__dirname, 'wfm-data.json');
const SESSION_LIFETIME_SECONDS = 8 * 60 * 60;
const COOKIE_NAME = 'wfm_session';
const DEFAULT_ADMIN_PASSWORD = 'Admin@123';
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.csv': 'text/csv; charset=utf-8'
};

const FUNCTIONS = [
  { id: 'dashboard', label: 'Overview', type: 'screen' },
  { id: 'requests', label: 'Request queue', type: 'screen' },
  { id: 'createRequest', label: 'Create requests', type: 'action' },
  { id: 'updateTickets', label: 'Update request status and ETA', type: 'action' },
  { id: 'assignTickets', label: 'Assign requests', type: 'action' },
  { id: 'reports', label: 'Reports', type: 'screen' },
  { id: 'roleMaster', label: 'Role master', type: 'screen' },
  { id: 'userMaster', label: 'User master', type: 'screen' }
];
const CATEGORIES = {
  IT: ['Systems', 'Network', 'VPN', 'Email Issue', 'Internet Issue', 'Biometric Issue', 'System Slowness', 'Access Issue', 'Printer Issue', 'Software Installation', 'Monitor Problem', 'Keyboard/Mouse Issue', 'Others (IT Specific)'],
  HR: ['Salary Issue', 'Payslip Request', 'Loan Request', 'Tax Proof Submission', 'PF/ESI Query', 'Reimbursement Query', 'Leave Query', 'HR Policy Query', 'Others (HR/Finance Specific)']
};
const FLOORS = ['Ground Floor', '1st Floor', '2nd Floor', '3rd Floor'];
const STATUSES = ['New', 'Assigned', 'In Progress', 'On Hold', 'Resolved', 'Reopened'];
const ALL_FUNCTIONS = FUNCTIONS.map((item) => item.id);
const DEFAULT_ROLES = [
  { id: 'role-employee', name: 'Employee', permissions: ['dashboard', 'requests', 'createRequest', 'updateTickets'] },
  { id: 'role-assignee', name: 'Assignee', permissions: ['dashboard', 'requests', 'updateTickets'] },
  { id: 'role-lead', name: 'Department Lead', permissions: ['dashboard', 'requests', 'createRequest', 'updateTickets', 'assignTickets', 'reports'] },
  { id: 'role-admin', name: 'Super Admin', permissions: ALL_FUNCTIONS }
];
const DEFAULT_USERS = [
  { id: 'EMP001', empId: '22311056', name: 'Vedavyas Sasank Alamuru', email: 'sasank@finsol.com', mobile: '9876543210', roleId: 'role-employee', dept: 'IT', active: true },
  { id: 'LEAD01', empId: '100201', name: 'Shyam Sundar Pakala', email: 'shyam.lead@finsol.com', mobile: '9876543211', roleId: 'role-lead', dept: 'IT', active: true },
  { id: 'LEAD02', empId: '100202', name: 'Anitha Rao', email: 'anitha.hr@finsol.com', mobile: '9876543212', roleId: 'role-lead', dept: 'HR', active: true },
  { id: 'TECH01', empId: '200301', name: 'Ravi Kumar', email: 'ravi.it@finsol.com', mobile: '9876543213', roleId: 'role-assignee', dept: 'IT', active: true },
  { id: 'TECH02', empId: '200302', name: 'Kiran Verma', email: 'kiran.it@finsol.com', mobile: '9876543214', roleId: 'role-assignee', dept: 'IT', active: true },
  { id: 'TECH03', empId: '200303', name: 'Meena Sharma', email: 'meena.hr@finsol.com', mobile: '9876543215', roleId: 'role-assignee', dept: 'HR', active: true },
  { id: 'ADMIN1', empId: '999999', name: 'Executive Super Admin', email: 'cxo@finsol.com', mobile: '9876543299', roleId: 'role-admin', dept: 'ALL', active: true }
];

function initialStore() {
  return { roles: structuredClone(DEFAULT_ROLES), users: structuredClone(DEFAULT_USERS), tickets: [], notifications: [] };
}

function loadStore(dataFile) {
  try {
    const saved = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    if (Array.isArray(saved.roles) && Array.isArray(saved.users)) return { ...saved, tickets: saved.tickets || [], notifications: saved.notifications || [] };
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('WFM data file could not be read:', error.message);
  }
  return initialStore();
}

function saveStore(dataFile, store) {
  const temporaryFile = `${dataFile}.tmp`;
  fs.writeFileSync(temporaryFile, JSON.stringify(store, null, 2));
  fs.renameSync(temporaryFile, dataFile);
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  return `${salt.toString('hex')}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;
}

function verifyPassword(password, stored) {
  if (typeof stored !== 'string' || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const expected = Buffer.from(hash, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(salt, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

function validPassword(value) {
  return typeof value === 'string' && value.length >= 8 && value.length <= 128;
}

function publicUser(user, store) {
  const role = store.roles.find((item) => item.id === user.roleId);
  if (!role) return null;
  return {
    id: user.id, empId: user.empId, name: user.name, email: user.email,
    mobile: user.mobile, dept: user.dept, roleId: role.id, role: role.name,
    roleName: role.name, permissions: [...role.permissions]
  };
}

function sendJson(res, status, value, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(value));
}

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((part) => part.trim().split(/=(.*)/s).slice(0, 2)).filter(([key, value]) => key && value !== undefined));
}

function validEmail(value) {
  return typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function rolePermissions(values) {
  const permissions = [...new Set((Array.isArray(values) ? values : []).filter((item) => ALL_FUNCTIONS.includes(item)))];
  const hasScreen = FUNCTIONS.some((item) => item.type === 'screen' && permissions.includes(item.id));
  return hasScreen ? permissions : null;
}

function validateUserInput(input, store, currentId = null) {
  const name = String(input.name || '').trim();
  const email = String(input.email || '').trim().toLowerCase();
  const mobile = String(input.mobile || '').trim();
  const roleId = String(input.roleId || '');
  const dept = String(input.dept || '');
  if (name.length < 2 || name.length > 100) return { error: 'Name must be between 2 and 100 characters.' };
  if (!validEmail(email)) return { error: 'Enter a valid email address.' };
  if (!/^\+?[0-9 ()-]{7,20}$/.test(mobile)) return { error: 'Enter a valid mobile number.' };
  if (!store.roles.some((role) => role.id === roleId)) return { error: 'Select an existing role.' };
  if (!['IT', 'HR', 'ALL'].includes(dept)) return { error: 'Select a valid department.' };
  if (store.users.some((user) => user.id !== currentId && user.email.toLowerCase() === email)) return { error: 'That email is already registered.' };
  return { value: { name, email, mobile, roleId, dept } };
}

function scopedTickets(user, store) {
  if (user.roleId === 'role-admin') return store.tickets;
  if (user.roleId === 'role-lead') return store.tickets.filter((ticket) => ticket.dept === user.dept);
  if (user.roleId === 'role-assignee') return store.tickets.filter((ticket) => ticket.assigneeId === user.id || ticket.creatorId === user.id);
  return store.tickets.filter((ticket) => ticket.creatorId === user.id);
}

function allowedStatuses(user, ticket) {
  if (user.roleId === 'role-employee') return ticket.status === 'Resolved' ? ['Resolved', 'Reopened'] : [ticket.status];
  if (user.roleId === 'role-assignee') {
    if (ticket.status === 'Resolved') return ['Resolved', 'Reopened'];
    const allowed = ['In Progress', 'On Hold', 'Resolved'];
    if (['New', 'Assigned', 'Reopened'].includes(ticket.status)) allowed.unshift(ticket.status);
    return allowed;
  }
  return STATUSES;
}

function createServer(options = {}) {
  const dataFile = options.dataFile || DATA_FILE;
  const env = options.env || process.env;
  const store = loadStore(dataFile);
  const sessions = new Map();
  const attempts = new Map();
  const maxAttempts = options.maxLoginAttempts || 10;
  const adminPassword = env.WFM_ADMIN_PASSWORD || (env.NODE_ENV === 'production' ? null : DEFAULT_ADMIN_PASSWORD);
  const admin = store.users.find((user) => user.id === 'ADMIN1');
  if (admin && !admin.passwordHash && adminPassword) {
    admin.passwordHash = hashPassword(adminPassword);
    saveStore(dataFile, store);
  }
  if (store.users.some((user) => user.roleId === 'role-admin' && user.active && user.passwordHash) === false) {
    console.warn('No Super Admin has a password. Set WFM_ADMIN_PASSWORD and restart.');
  }
  let lastStatePruneAt = 0;

  function save() {
    saveStore(dataFile, store);
  }

  function pruneExpiredState(now) {
    if (now - lastStatePruneAt < 60 * 1000) return;
    lastStatePruneAt = now;
    for (const [token, session] of sessions) {
      if (session.expiresAt <= now) sessions.delete(token);
    }
    for (const map of [attempts]) {
      for (const [key, history] of map) {
        const recent = history.filter((time) => now - time < 60 * 60 * 1000);
        if (recent.length) map.set(key, recent);
        else map.delete(key);
      }
      while (map.size > 10000) map.delete(map.keys().next().value);
    }
  }

  function sessionFor(req) {
    const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
    const session = token && sessions.get(token);
    if (!session || session.expiresAt <= Date.now()) {
      if (token) sessions.delete(token);
      return null;
    }
    const user = store.users.find((item) => item.id === session.userId && item.active);
    return user ? { token, user, publicUser: publicUser(user, store) } : null;
  }

  async function readBody(req) {
    let raw = '';
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > 32768) throw Object.assign(new Error('Request body is too large.'), { status: 413 });
    }
    if (!raw) return {};
    try {
      return JSON.parse(raw);
    } catch {
      throw Object.assign(new Error('Request body must be valid JSON.'), { status: 400 });
    }
  }

  function requirePermission(req, res, permission) {
    const session = sessionFor(req);
    if (!session) {
      sendJson(res, 401, { error: 'Sign in to continue.' });
      return null;
    }
    if (!session.publicUser.permissions.includes(permission)) {
      sendJson(res, 403, { error: 'Your role does not allow this function.' });
      return null;
    }
    return session;
  }

  async function handleApi(req, res, url) {
    pruneExpiredState(Date.now());
    const { pathname } = url;
    const method = req.method;
    if (method === 'GET' && pathname === '/api/session') {
      const session = sessionFor(req);
      return sendJson(res, 200, { user: session?.publicUser || null, functions: FUNCTIONS });
    }
    if (method === 'GET' && pathname === '/api/team') {
      const session = sessionFor(req);
      if (!session) return sendJson(res, 401, { error: 'Sign in to continue.' });
      const members = store.users.filter((user) => user.active && user.roleId === 'role-assignee').map(({ id, name, dept }) => ({ id, name, dept }));
      return sendJson(res, 200, { members });
    }

    if (method === 'POST' && (pathname === '/api/auth/signup' || pathname === '/api/auth/login')) {
      const body = await readBody(req);
      const now = Date.now();
      const key = req.socket.remoteAddress || 'unknown';
      const recent = (attempts.get(key) || []).filter((time) => now - time < 15 * 60 * 1000);
      if (recent.length >= maxAttempts) return sendJson(res, 429, { error: 'Too many attempts. Please wait a few minutes and try again.' });
      attempts.set(key, [...recent, now]);
      let user;
      if (pathname === '/api/auth/signup') {
        if (!validPassword(body.password)) return sendJson(res, 400, { error: 'Password must be between 8 and 128 characters.' });
        const checked = validateUserInput({ ...body, roleId: 'role-employee' }, store);
        if (checked.error) return sendJson(res, 400, { error: checked.error });
        user = { id: crypto.randomUUID(), empId: String(body.empId || '').trim().slice(0, 40), ...checked.value, passwordHash: hashPassword(body.password), active: true };
        store.users.push(user);
        save();
      } else {
        const email = String(body.email || '').trim().toLowerCase();
        user = store.users.find((item) => item.email.toLowerCase() === email && item.active);
        const ok = verifyPassword(String(body.password || ''), user?.passwordHash || '');
        if (!user || !ok) return sendJson(res, 401, { error: 'Incorrect email or password.' });
      }
      const token = crypto.randomBytes(32).toString('base64url');
      sessions.set(token, { userId: user.id, expiresAt: now + SESSION_LIFETIME_SECONDS * 1000 });
      const secure = env.NODE_ENV === 'production' ? '; Secure' : '';
      const cookie = `${COOKIE_NAME}=${token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${SESSION_LIFETIME_SECONDS}${secure}`;
      return sendJson(res, pathname === '/api/auth/signup' ? 201 : 200, { user: publicUser(user, store) }, { 'Set-Cookie': cookie });
    }

    if (pathname === '/api/tickets' || pathname.startsWith('/api/tickets/') || pathname === '/api/notifications/read') {
      const session = sessionFor(req);
      if (!session) return sendJson(res, 401, { error: 'Sign in to continue.' });
      const { user } = session;
      const permissions = session.publicUser.permissions;
      const view = (extra = {}) => ({
        tickets: scopedTickets(user, store),
        notifications: store.notifications.filter((item) => item.recipients.includes(user.id)).slice(0, 30).map(({ recipients, readBy, ...item }) => ({ ...item, read: readBy.includes(user.id) })),
        ...extra
      });
      const notify = (ticket, text) => {
        const recipients = new Set([ticket.creatorId, ticket.assigneeId]);
        store.users.filter((item) => item.active && (item.roleId === 'role-admin' || (item.roleId === 'role-lead' && item.dept === ticket.dept))).forEach((item) => recipients.add(item.id));
        recipients.delete(user.id);
        recipients.delete(null);
        store.notifications.unshift({ id: `n-${crypto.randomUUID()}`, ticketId: ticket.id, text, time: new Date().toISOString(), recipients: [...recipients], readBy: [] });
        store.notifications = store.notifications.slice(0, 500);
      };
      const history = (ticket, action) => ticket.history.push({ time: new Date().toISOString(), actor: user.name, action });

      if (method === 'GET' && pathname === '/api/tickets') return sendJson(res, 200, view());
      if (method === 'POST' && pathname === '/api/notifications/read') {
        const body = await readBody(req);
        store.notifications.forEach((item) => {
          if (item.recipients.includes(user.id) && (!body.ticketId || item.ticketId === body.ticketId) && !item.readBy.includes(user.id)) item.readBy.push(user.id);
        });
        save();
        return sendJson(res, 200, view());
      }
      if (method === 'POST' && pathname === '/api/tickets') {
        if (!permissions.includes('createRequest')) return sendJson(res, 403, { error: 'Your role does not allow creating requests.' });
        const body = await readBody(req);
        const dept = String(body.dept || '');
        const category = String(body.category || '');
        const floor = String(body.floor || '');
        const priority = Number(body.priority);
        const title = String(body.title || '').trim();
        const description = String(body.description || '').trim();
        const expectedDate = body.expectedDate ? String(body.expectedDate) : null;
        if (!CATEGORIES[dept]?.includes(category)) return sendJson(res, 400, { error: 'Choose a valid department and category.' });
        if (!FLOORS.includes(floor)) return sendJson(res, 400, { error: 'Choose a floor location.' });
        if (![1, 2, 3, 4, 5].includes(priority)) return sendJson(res, 400, { error: 'Choose a valid priority.' });
        if (!title || !description || title.length > 100 || description.length > 1000) return sendJson(res, 400, { error: 'Add a subject (max 100) and description (max 1000 characters).' });
        if (expectedDate) {
          const chosen = new Date(`${expectedDate}T00:00:00`);
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const limit = new Date(today);
          limit.setDate(limit.getDate() + 90);
          if (Number.isNaN(chosen.getTime()) || chosen < today || chosen > limit) return sendJson(res, 400, { error: 'Target date must be within the next 90 days.' });
        }
        const now = new Date();
        const sequence = store.tickets.reduce((max, ticket) => Math.max(max, Number(ticket.id.split('-').at(-1)) || 0), 4820) + 1;
        const ticket = {
          id: `WFM-${String(now.getFullYear()).slice(-2)}-${sequence}`, dept, category, floor, priority, title, description,
          creatorId: user.id, creatorName: user.name, creatorEmpId: user.empId,
          assigneeId: null, assigneeName: null, status: 'New', createdAt: now.toISOString(),
          expectedDate, eta: null, etaEdits: 0, resolvedAt: null, resolvedBy: null, resolution: null, history: []
        };
        history(ticket, `Request created · ${floor} · Priority P${priority}`);
        store.tickets.unshift(ticket);
        notify(ticket, `New ${dept} request: ${title}.`);
        save();
        return sendJson(res, 201, view({ ticket }));
      }
      const match = pathname.match(/^\/api\/tickets\/([^/]+)\/(update|assign)$/);
      if (method === 'POST' && match) {
        const ticket = scopedTickets(user, store).find((item) => item.id === decodeURIComponent(match[1]));
        if (!ticket) return sendJson(res, 404, { error: 'Request not found.' });
        const body = await readBody(req);
        if (match[2] === 'assign') {
          if (!permissions.includes('assignTickets')) return sendJson(res, 403, { error: 'Your role does not allow ticket assignment.' });
          const member = store.users.find((item) => item.id === body.assigneeId && item.active && item.roleId === 'role-assignee');
          if (!member) return sendJson(res, 400, { error: 'Choose a service team member first.' });
          if (member.dept !== ticket.dept && user.roleId !== 'role-admin') return sendJson(res, 400, { error: 'Choose an assignee from this request department.' });
          if (ticket.assigneeId === member.id) return sendJson(res, 400, { error: 'This request is already assigned to that person.' });
          if (ticket.status === 'Resolved') return sendJson(res, 400, { error: 'A resolved request cannot be reassigned.' });
          const previous = ticket.assigneeName || 'Unassigned';
          ticket.assigneeId = member.id;
          ticket.assigneeName = member.name;
          if (ticket.status === 'New') ticket.status = 'Assigned';
          history(ticket, `Assigned from ${previous} to ${member.name}. SLA clock continues.`);
          notify(ticket, `${ticket.id} assigned to ${member.name}.`);
          save();
          return sendJson(res, 200, view({ ticket }));
        }
        if (!permissions.includes('updateTickets')) return sendJson(res, 403, { error: 'Your role does not allow ticket updates.' });
        const newStatus = String(body.status || ticket.status);
        const remark = String(body.remark || '').trim().slice(0, 1000);
        const eta = body.eta ? String(body.eta) : '';
        if (!STATUSES.includes(newStatus)) return sendJson(res, 400, { error: 'Choose a valid status.' });
        if (newStatus !== ticket.status && !allowedStatuses(user, ticket).includes(newStatus)) return sendJson(res, 400, { error: 'Your role cannot make that status change.' });
        if (newStatus !== ticket.status && !remark) return sendJson(res, 400, { error: 'Add a note when changing the request status.' });
        if (newStatus === 'In Progress' && !eta && !ticket.eta) return sendJson(res, 400, { error: 'Set an expected completion time before starting work.' });
        if (newStatus === 'Reopened' && ticket.status !== 'Resolved') return sendJson(res, 400, { error: 'Only a resolved request can be reopened.' });
        if (eta && eta !== ticket.eta && !(new Date(body.etaUtc) > new Date())) return sendJson(res, 400, { error: 'Expected completion must be a future time.' });
        const oldStatus = ticket.status;
        if (eta && eta !== ticket.eta) {
          ticket.eta = eta;
          ticket.etaEdits = (ticket.etaEdits || 0) + 1;
          history(ticket, `Expected completion updated to ${new Date(body.etaUtc).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })}`);
        }
        if (newStatus !== oldStatus) {
          ticket.status = newStatus;
          if (newStatus === 'Resolved') Object.assign(ticket, { resolvedAt: new Date().toISOString(), resolvedBy: user.name, resolution: remark });
          if (newStatus === 'Reopened') Object.assign(ticket, { resolvedAt: null, resolvedBy: null, resolution: null });
          history(ticket, `Status changed from ${oldStatus} to ${newStatus}${remark ? ` · ${remark}` : ''}`);
          notify(ticket, `${ticket.id} moved to ${newStatus} by ${user.name}.`);
        } else if (remark) {
          history(ticket, remark);
          notify(ticket, `A note was added to ${ticket.id}.`);
        }
        save();
        return sendJson(res, 200, view({ ticket }));
      }
      return sendJson(res, 404, { error: 'API route not found.' });
    }

    if (method === 'POST' && pathname === '/api/auth/logout') {
      const session = sessionFor(req);
      if (session) sessions.delete(session.token);
      return sendJson(res, 200, { ok: true }, { 'Set-Cookie': `${COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0` });
    }

    if (pathname === '/api/admin/roles' || pathname.startsWith('/api/admin/roles/')) {
      const session = requirePermission(req, res, 'roleMaster');
      if (!session) return;
      if (method === 'GET' && pathname === '/api/admin/roles') {
        const roles = store.roles.map((role) => ({ ...role, userCount: store.users.filter((user) => user.roleId === role.id).length }));
        return sendJson(res, 200, { roles, functions: FUNCTIONS });
      }
      if (method === 'POST' && pathname === '/api/admin/roles') {
        const body = await readBody(req);
        const name = String(body.name || '').trim();
        if (name.length < 2 || name.length > 60) return sendJson(res, 400, { error: 'Role name must be between 2 and 60 characters.' });
        if (store.roles.some((role) => role.name.toLowerCase() === name.toLowerCase())) return sendJson(res, 409, { error: 'That role name already exists.' });
        const permissions = rolePermissions(body.permissions);
        if (!permissions) return sendJson(res, 400, { error: 'Allow at least one screen for this role.' });
        const role = { id: `role-${crypto.randomUUID()}`, name, permissions };
        store.roles.push(role);
        save();
        return sendJson(res, 201, { role });
      }
      const roleId = decodeURIComponent(pathname.slice('/api/admin/roles/'.length));
      const index = store.roles.findIndex((role) => role.id === roleId);
      if (index < 0) return sendJson(res, 404, { error: 'Role not found.' });
      if (method === 'PUT') {
        const body = await readBody(req);
        const name = String(body.name || '').trim();
        if (name.length < 2 || name.length > 60) return sendJson(res, 400, { error: 'Role name must be between 2 and 60 characters.' });
        if (store.roles.some((role) => role.id !== roleId && role.name.toLowerCase() === name.toLowerCase())) return sendJson(res, 409, { error: 'That role name already exists.' });
        const permissions = rolePermissions(body.permissions);
        if (!permissions) return sendJson(res, 400, { error: 'Allow at least one screen for this role.' });
        if (roleId === 'role-admin' && !['roleMaster', 'userMaster'].every((permission) => permissions.includes(permission))) {
          return sendJson(res, 400, { error: 'The Super Admin role must retain both master screens.' });
        }
        store.roles[index] = { ...store.roles[index], name, permissions };
        save();
        return sendJson(res, 200, { role: store.roles[index] });
      }
      if (method === 'DELETE') {
        if (store.users.some((user) => user.roleId === roleId)) return sendJson(res, 409, { error: 'Reassign users before deleting this role.' });
        store.roles.splice(index, 1);
        save();
        return sendJson(res, 200, { ok: true });
      }
      return sendJson(res, 405, { error: 'Method not allowed.' });
    }

    if (pathname === '/api/admin/users' || pathname.startsWith('/api/admin/users/')) {
      const session = requirePermission(req, res, 'userMaster');
      if (!session) return;
      if (method === 'GET' && pathname === '/api/admin/users') {
        return sendJson(res, 200, {
          users: store.users.map((user) => ({ ...publicUser(user, store), active: user.active })),
          roles: store.roles.map(({ id, name }) => ({ id, name }))
        });
      }
      if (method === 'POST' && pathname === '/api/admin/users') {
        const body = await readBody(req);
        const checked = validateUserInput(body, store);
        if (checked.error) return sendJson(res, 400, { error: checked.error });
        if (!validPassword(body.password)) return sendJson(res, 400, { error: 'Password must be between 8 and 128 characters.' });
        const user = { id: crypto.randomUUID(), empId: String(body.empId || '').trim(), ...checked.value, passwordHash: hashPassword(body.password), active: true };
        store.users.push(user);
        save();
        return sendJson(res, 201, { user: { ...publicUser(user, store), active: user.active } });
      }
      const userId = decodeURIComponent(pathname.slice('/api/admin/users/'.length));
      const index = store.users.findIndex((user) => user.id === userId);
      if (index < 0) return sendJson(res, 404, { error: 'User not found.' });
      if (method === 'PUT') {
        const body = await readBody(req);
        const checked = validateUserInput(body, store, userId);
        if (checked.error) return sendJson(res, 400, { error: checked.error });
        const wasActive = store.users[index].active;
        if (body.password && !validPassword(body.password)) return sendJson(res, 400, { error: 'Password must be between 8 and 128 characters.' });
        const user = { ...store.users[index], ...checked.value, empId: String(body.empId ?? store.users[index].empId).trim(), active: body.active === undefined ? wasActive : Boolean(body.active) };
        if (body.password) user.passwordHash = hashPassword(body.password);
        if (!user.active && userId === session.user.id) return sendJson(res, 400, { error: 'You cannot deactivate your own account.' });
        const removesLastAdmin = store.users[index].roleId === 'role-admin' && store.users[index].active && (user.roleId !== 'role-admin' || !user.active) && store.users.filter((item) => item.active && item.roleId === 'role-admin').length <= 1;
        if (removesLastAdmin) return sendJson(res, 400, { error: 'At least one active Super Admin is required.' });
        store.users[index] = user;
        save();
        return sendJson(res, 200, { user: { ...publicUser(user, store), active: user.active } });
      }
      if (method === 'DELETE') {
        const user = store.users[index];
        if (user.id === session.user.id) return sendJson(res, 400, { error: 'You cannot delete your own account.' });
        if (user.active && user.roleId === 'role-admin' && store.users.filter((item) => item.active && item.roleId === 'role-admin').length <= 1) return sendJson(res, 400, { error: 'At least one active Super Admin is required.' });
        store.users.splice(index, 1);
        save();
        return sendJson(res, 200, { ok: true });
      }
      return sendJson(res, 405, { error: 'Method not allowed.' });
    }

    return sendJson(res, 404, { error: 'API route not found.' });
  }

  async function handleRequest(req, res) {
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch {
      return sendJson(res, 400, { error: 'Invalid request URL.' });
    }
    if (url.pathname.startsWith('/api/')) {
      try {
        return await handleApi(req, res, url);
      } catch (error) {
        console.error('WFM API error:', error);
        return sendJson(res, error.status || 500, { error: error.status ? error.message : 'Unexpected server error.' });
      }
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'Method not allowed.' });
    let requestPath;
    try {
      requestPath = decodeURIComponent(url.pathname);
    } catch {
      return sendJson(res, 400, { error: 'Invalid request path.' });
    }
    const relativePath = requestPath === '/' || requestPath === '/index.html' ? 'wfm.html' : requestPath.slice(1);
    const filePath = path.resolve(STATIC_DIR, relativePath);
    if (filePath !== STATIC_DIR && !filePath.startsWith(`${STATIC_DIR}${path.sep}`)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('403 Forbidden');
    }
    fs.stat(filePath, (error, stats) => {
      if (error || !stats.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end('<h1>404 Not Found</h1>');
      }
      res.writeHead(200, { 'Content-Type': MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(filePath).pipe(res);
    });
  }

  const server = http.createServer(handleRequest);
  server.wfmStore = store;
  return server;
}

if (require.main === module) {
  const server = createServer();
  server.listen(PORT, () => {
    console.log(`\n  WFM server running at http://localhost:${PORT}`);
    console.log(`  Serving ${STATIC_DIR}`);
    console.log('  Press Ctrl+C to stop\n');
  });
}

module.exports = { createServer, FUNCTIONS, DEFAULT_ROLES, DEFAULT_USERS };
