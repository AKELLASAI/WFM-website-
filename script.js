const tableBody = document.getElementById('assigneeTableBody');

function parseCsvLine(line) {
  const cells = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      cells.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  cells.push(current);
  return cells.map((cell) => cell.trim());
}

function parseCsv(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseCsvLine)
    .filter((row) => row.length > 1 && row.some(Boolean));
}

function renderFallbackRows() {
  const fallbackRows = [
    ['Meena Sharma', 'HR & Finance', '2', '1', '1', '50%'],
    ['Operations Team', 'IT', '8', '6', '2', '42%'],
    ['Support Desk', 'IT', '12', '9', '3', '38%'],
  ];

  renderRows(fallbackRows);
}

function renderRows(rows) {
  if (!tableBody) return;

  const dataRows = rows.slice(1);

  if (!dataRows.length) {
    renderFallbackRows();
    return;
  }

  const rowsHtml = dataRows
    .map((row) => {
      const [assignee, department, total, resolved, active, sla] = row;
      const slaValue = sla || '0%';
      return `
        <tr>
          <td>${assignee || 'N/A'}</td>
          <td>${department || 'N/A'}</td>
          <td>${total || '0'}</td>
          <td>${resolved || '0'}</td>
          <td>${active || '0'}</td>
          <td><span class="badge">${slaValue}</span></td>
        </tr>
      `;
    })
    .join('');

  tableBody.innerHTML = rowsHtml;
}

async function loadAssigneeData() {
  try {
    const response = await fetch('WFM-assignees-2026-09-25.csv', { cache: 'no-store' });

    if (!response.ok) {
      throw new Error('Unable to fetch CSV');
    }

    const text = await response.text();
    const rows = parseCsv(text);

    if (!rows.length) {
      throw new Error('No CSV rows available');
    }

    renderRows(rows);
  } catch (error) {
    console.warn('Falling back to sample WFM data:', error);
    renderFallbackRows();
  }
}

const slaHotspots = [
  { name: 'HR & Finance', value: '62%', type: 'At risk' },
  { name: 'IT Support', value: '54%', type: 'Recovering' },
  { name: 'Payroll', value: '48%', type: 'Escalated' },
];

const channelStats = [
  { label: 'Web', value: 82 },
  { label: 'Mobile', value: 76 },
  { label: 'Phone', value: 67 },
  { label: 'Email', value: 58 },
];

const activityFeedItems = [
  { title: 'VPN access request', detail: 'Assigned to IT Support • 12 min ago', tag: 'In progress' },
  { title: 'Salary discrepancy', detail: 'Escalated to HR & Finance • 21 min ago', tag: 'Pending review' },
  { title: 'Laptop replacement', detail: 'Resolved • 48 min ago', tag: 'Closed' },
  { title: 'Leave policy query', detail: 'Updated by payroll team • 1 hr ago', tag: 'Updated' },
];

function renderSlaList() {
  const list = document.getElementById('slaList');
  if (!list) return;

  list.innerHTML = slaHotspots
    .map(
      (item) => `
        <li>
          <div class="activity-details">
            <strong>${item.name}</strong>
            <span>${item.type}</span>
          </div>
          <small>${item.value}</small>
        </li>
      `
    )
    .join('');
}

function renderChannelBars() {
  const container = document.getElementById('channelBars');
  if (!container) return;

  container.innerHTML = channelStats
    .map(
      (item) => `
        <div class="channel-row">
          <div class="channel-label">
            <span>${item.label}</span>
            <span>${item.value}%</span>
          </div>
          <div class="channel-track">
            <div class="channel-fill" style="width: ${item.value}%"></div>
          </div>
        </div>
      `
    )
    .join('');
}

function renderActivityFeed() {
  const feed = document.getElementById('activityFeed');
  if (!feed) return;

  feed.innerHTML = activityFeedItems
    .map(
      (item) => `
        <li>
          <div class="activity-details">
            <strong>${item.title}</strong>
            <span>${item.detail}</span>
          </div>
          <small class="badge">${item.tag}</small>
        </li>
      `
    )
    .join('');
}

document.addEventListener('DOMContentLoaded', () => {
  renderSlaList();
  renderChannelBars();
  renderActivityFeed();
  loadAssigneeData();
});
