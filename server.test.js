const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createServer } = require('../server');

async function startTestServer(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wfm-auth-'));
  const server = createServer({ dataFile: path.join(directory, 'store.json'), devOtp: true, ...options });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return `http://127.0.0.1:${server.address().port}`;
}

async function post(base, endpoint, body, cookie) {
  const response = await fetch(`${base}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body)
  });
  return { response, body: await response.json() };
}

async function signup(base, email) {
  const created = await post(base, '/api/auth/signup', { name: 'New Person', email, mobile: '9000000001', dept: 'IT', password: 'Password#123' });
  assert.equal(created.response.status, 201);
  return { verified: { response: created.response, body: created.body }, cookie: created.response.headers.get('set-cookie').split(';')[0] };
}

async function signIn(base, email, password = 'Admin@123') {
  const verified = await post(base, '/api/auth/login', { email, password });
  assert.equal(verified.response.status, 200);
  return { verified, cookie: verified.response.headers.get('set-cookie').split(';')[0] };
}

test('login creates a session and master APIs enforce role permissions', async (t) => {
  const base = await startTestServer(t);
  const anonymous = await fetch(`${base}/api/session`).then((response) => response.json());
  assert.equal(anonymous.user, null);

  const employee = await signup(base, 'sasank2@finsol.com');
  assert.equal(employee.verified.response.status, 201);
  assert.equal(employee.verified.body.user.role, 'Employee');
  assert.ok(employee.verified.body.user.permissions.includes('requests'));

  const session = await fetch(`${base}/api/session`, { headers: { Cookie: employee.cookie } }).then((response) => response.json());
  assert.equal(session.user.email, 'sasank2@finsol.com');
  const denied = await fetch(`${base}/api/admin/users`, { headers: { Cookie: employee.cookie } });
  assert.equal(denied.status, 403);

  const admin = await signIn(base, 'cxo@finsol.com');
  const rolesResponse = await fetch(`${base}/api/admin/roles`, { headers: { Cookie: admin.cookie } });
  const roles = await rolesResponse.json();
  assert.equal(rolesResponse.status, 200);
  assert.equal(roles.functions.length, 8);
  const adminRole = roles.roles.find((role) => role.id === 'role-admin');
  const renamedAdminResponse = await fetch(`${base}/api/admin/roles/role-admin`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: admin.cookie },
    body: JSON.stringify({ name: 'Workspace Owner', permissions: adminRole.permissions })
  });
  assert.equal(renamedAdminResponse.status, 200);
  const adminRoleLockout = await fetch(`${base}/api/admin/roles/role-admin`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: admin.cookie },
    body: JSON.stringify({ name: 'Workspace Owner', permissions: ['dashboard', 'userMaster'] })
  });
  assert.equal(adminRoleLockout.status, 400);

  const adminUsers = await fetch(`${base}/api/admin/users`, { headers: { Cookie: admin.cookie } }).then((response) => response.json());
  const adminUser = adminUsers.users.find((user) => user.id === 'ADMIN1');
  const demoteLastAdmin = await fetch(`${base}/api/admin/users/ADMIN1`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: admin.cookie },
    body: JSON.stringify({ ...adminUser, roleId: 'role-employee' })
  });
  assert.equal(demoteLastAdmin.status, 400);
  const deleteSelf = await fetch(`${base}/api/admin/users/ADMIN1`, { method: 'DELETE', headers: { Cookie: admin.cookie } });
  assert.equal(deleteSelf.status, 400);

  const screenlessRole = await post(base, '/api/admin/roles', { name: 'No Screens', permissions: ['updateTickets'] }, admin.cookie);
  assert.equal(screenlessRole.response.status, 400);
  const createdRole = await post(base, '/api/admin/roles', { name: 'Read Only', permissions: ['dashboard', 'invalid'] }, admin.cookie);
  assert.equal(createdRole.response.status, 201);
  assert.deepEqual(createdRole.body.role.permissions, ['dashboard']);

  const createdUser = await post(base, '/api/admin/users', {
    name: 'Taylor Reader', email: 'taylor@example.test', mobile: '+1 555 010 2233', dept: 'IT', roleId: createdRole.body.role.id, password: 'Reader#1234'
  }, admin.cookie);
  assert.equal(createdUser.response.status, 201);
  assert.deepEqual(createdUser.body.user.permissions, ['dashboard']);

  const readOnly = await signIn(base, 'taylor@example.test', 'Reader#1234');
  const restricted = await fetch(`${base}/api/admin/roles`, { headers: { Cookie: readOnly.cookie } });
  assert.equal(restricted.status, 403);

  const deleted = await fetch(`${base}/api/admin/users/${encodeURIComponent(createdUser.body.user.id)}`, { method: 'DELETE', headers: { Cookie: admin.cookie } });
  assert.equal(deleted.status, 200);
  const remainingUsers = await fetch(`${base}/api/admin/users`, { headers: { Cookie: admin.cookie } }).then((response) => response.json());
  assert.equal(remainingUsers.users.some((user) => user.email === 'taylor@example.test'), false);
});

test('signup validates input, forces the Employee role, and rejects duplicates', async (t) => {
  const base = await startTestServer(t);
  const good = { name: 'Jo Doe', email: 'Jo@Example.test', mobile: '9000000002', dept: 'HR', password: 'Password#123' };
  const weak = await post(base, '/api/auth/signup', { ...good, password: 'short' });
  assert.equal(weak.response.status, 400);
  const escalated = await post(base, '/api/auth/signup', { ...good, roleId: 'role-admin' });
  assert.equal(escalated.response.status, 201);
  assert.equal(escalated.body.user.role, 'Employee');
  assert.equal(escalated.body.user.permissions.includes('userMaster'), false);
  const duplicate = await post(base, '/api/auth/signup', good);
  assert.equal(duplicate.response.status, 400);
  const login = await post(base, '/api/auth/login', { email: 'jo@example.test', password: 'Password#123' });
  assert.equal(login.response.status, 200);
});

test('login rejects wrong passwords, unknown users, passwordless seed users, and brute force', async (t) => {
  const base = await startTestServer(t, { maxLoginAttempts: 4 });
  const wrong = await post(base, '/api/auth/login', { email: 'cxo@finsol.com', password: 'nope-nope' });
  const unknown = await post(base, '/api/auth/login', { email: 'nobody@example.test', password: 'nope-nope' });
  const seeded = await post(base, '/api/auth/login', { email: 'sasank@finsol.com', password: '' });
  assert.equal(wrong.response.status, 401);
  assert.equal(unknown.body.error, wrong.body.error);
  assert.equal(seeded.response.status, 401);
  await post(base, '/api/auth/login', { email: 'cxo@finsol.com', password: 'Admin@123' });
  const blocked = await post(base, '/api/auth/login', { email: 'cxo@finsol.com', password: 'Admin@123' });
  assert.equal(blocked.response.status, 429);
});

test('production has no default admin password', async (t) => {
  const base = await startTestServer(t, { env: { NODE_ENV: 'production' } });
  const result = await post(base, '/api/auth/login', { email: 'cxo@finsol.com', password: 'Admin@123' });
  assert.equal(result.response.status, 401);
});

test('tickets live on the server, are scoped per role, and enforce workflow rules', async (t) => {
  const base = await startTestServer(t);
  const get = (cookie) => fetch(`${base}/api/tickets`, { headers: { Cookie: cookie } }).then((r) => r.json());
  const anon = await fetch(`${base}/api/tickets`);
  assert.equal(anon.status, 401);

  const teacher = await signup(base, 'teacher@school.test');
  const other = await signup(base, 'other@school.test');
  const admin = await signIn(base, 'cxo@finsol.com');
  const ticketBody = { dept: 'IT', category: 'Printer Issue', floor: 'Ground Floor', priority: 3, title: 'Printer jam', description: 'Paper stuck' };
  const bad = await post(base, '/api/tickets', { ...ticketBody, floor: 'Roof' }, teacher.cookie);
  assert.equal(bad.response.status, 400);
  const created = await post(base, '/api/tickets', ticketBody, teacher.cookie);
  assert.equal(created.response.status, 201);
  const id = created.body.ticket.id;

  assert.equal((await get(teacher.cookie)).tickets.length, 1);
  assert.equal((await get(other.cookie)).tickets.length, 0);
  assert.equal((await get(admin.cookie)).tickets.length, 1);
  assert.equal((await get(admin.cookie)).notifications.length, 1);

  const employeeAssign = await post(base, `/api/tickets/${id}/assign`, { assigneeId: 'TECH01' }, teacher.cookie);
  assert.equal(employeeAssign.response.status, 403);
  const otherUpdate = await post(base, `/api/tickets/${id}/update`, { status: 'Resolved', remark: 'x' }, other.cookie);
  assert.equal(otherUpdate.response.status, 404);
  const employeeResolve = await post(base, `/api/tickets/${id}/update`, { status: 'Resolved', remark: 'x' }, teacher.cookie);
  assert.equal(employeeResolve.response.status, 400);

  const assigned = await post(base, `/api/tickets/${id}/assign`, { assigneeId: 'TECH01' }, admin.cookie);
  assert.equal(assigned.body.ticket.status, 'Assigned');
  const noEta = await post(base, `/api/tickets/${id}/update`, { status: 'In Progress', remark: 'start' }, admin.cookie);
  assert.equal(noEta.response.status, 400);
  const eta = new Date(Date.now() + 86400000);
  const started = await post(base, `/api/tickets/${id}/update`, { status: 'In Progress', remark: 'start', eta: eta.toISOString().slice(0, 16), etaUtc: eta.toISOString() }, admin.cookie);
  assert.equal(started.response.status, 200);
  const resolved = await post(base, `/api/tickets/${id}/update`, { status: 'Resolved', remark: 'fixed' }, admin.cookie);
  assert.equal(resolved.body.ticket.status, 'Resolved');
  const reopened = await post(base, `/api/tickets/${id}/update`, { status: 'Reopened', remark: 'still broken' }, teacher.cookie);
  assert.equal(reopened.body.ticket.status, 'Reopened');

  const mine = await get(teacher.cookie);
  assert.ok(mine.notifications.length >= 3);
  const read = await post(base, '/api/notifications/read', {}, teacher.cookie);
  assert.ok(read.body.notifications.every((n) => n.read));
});
