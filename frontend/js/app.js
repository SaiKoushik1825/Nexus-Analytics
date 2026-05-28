// === CONFIG ===
const API_BASE = "http://localhost:5000";
const POLL_INTERVAL_MS = 3000; // Poll every 3 seconds

// === Login Logic ===
const loginForm = document.getElementById('loginForm');

if (loginForm) {
    loginForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const username = document.getElementById('username').value;
        
        if (username) {
            localStorage.setItem('nexus_user', username);
            
            document.querySelector('.login-container').style.transform = 'scale(0.95)';
            document.querySelector('.login-container').style.opacity = '0';
            
            setTimeout(() => {
                window.location.href = 'dashboard.html';
            }, 400);
        }
    });
}

// === Dashboard Logic ===
function initDashboard() {
    const user = localStorage.getItem('nexus_user');
    if (!user) {
        window.location.href = 'index.html';
        return;
    }

    const greetingEl = document.getElementById('userGreeting');
    if (greetingEl) greetingEl.textContent = `Welcome, ${user}`;

    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            localStorage.removeItem('nexus_user');
            window.location.href = 'index.html';
        });
    }

    // Start live feed from real backend
    startLiveFeed();
}

// === Status Banner ===
function showBanner(message, type = 'info') {
    let banner = document.getElementById('statusBanner');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'statusBanner';
        banner.style.cssText = `
            position: fixed; top: 70px; left: 50%; transform: translateX(-50%);
            padding: 10px 28px; border-radius: 24px; font-size: 0.85rem;
            font-weight: 600; z-index: 9999; transition: opacity 0.4s;
            box-shadow: 0 4px 24px rgba(0,0,0,0.3);
        `;
        document.body.appendChild(banner);
    }

    const colors = {
        info:    { bg: '#1e3a5f', text: '#74b9ff', border: '#2d6a9f' },
        success: { bg: '#1a3a2a', text: '#55efc4', border: '#00b894' },
        warning: { bg: '#3a2d10', text: '#fdcb6e', border: '#e17055' },
    };
    const c = colors[type] || colors.info;
    banner.style.background = c.bg;
    banner.style.color = c.text;
    banner.style.border = `1px solid ${c.border}`;
    banner.textContent = message;
    banner.style.opacity = '1';
}

function hideBanner() {
    const banner = document.getElementById('statusBanner');
    if (banner) {
        banner.style.opacity = '0';
        setTimeout(() => { if (banner.parentNode) banner.parentNode.removeChild(banner); }, 500);
    }
}

// === Previous scores to detect trends ===
let previousScores = {};

// === Fetch and render real data ===
async function fetchResults() {
    try {
        const res = await fetch(`${API_BASE}/api/results`);

        if (res.status === 202) {
            // Spark not ready yet
            showBanner('⏳ Spark pipeline starting up… waiting for first batch results.', 'warning');
            renderWaitingState();
            return;
        }

        if (!res.ok) {
            showBanner('⚠️ API error. Is api_server.py running on port 5000?', 'warning');
            return;
        }

        const data = await res.json();

        // Update stat cards
        const totalEdgesEl = document.getElementById('totalEdges');
        const activeVerticesEl = document.getElementById('activeVertices');
        const batchSpeedEl = document.getElementById('batchSpeed');

        if (totalEdgesEl) totalEdgesEl.textContent = Number(data.total_edges).toLocaleString();
        if (activeVerticesEl) activeVerticesEl.textContent = Number(data.active_vertices).toLocaleString();
        if (batchSpeedEl) batchSpeedEl.textContent = `Batch #${data.total_batches}`;

        // Compute trends vs last poll
        const influencers = data.top_influencers.map(inf => {
            const prevScore = previousScores[inf.user_id];
            let trend = 'flat';
            if (prevScore !== undefined) {
                const diff = parseFloat(inf.pagerank_score) - prevScore;
                if (diff > 0.005) trend = 'up';
                else if (diff < -0.005) trend = 'down';
            }
            previousScores[inf.user_id] = parseFloat(inf.pagerank_score);
            return { ...inf, trend };
        });

        const tableBody = document.getElementById('influencersTableBody');
        renderTable(influencers, tableBody);

        const lastUpdated = new Date(data.timestamp).toLocaleTimeString();
        showBanner(`✅ Live data — last Spark batch at ${lastUpdated}`, 'success');
        setTimeout(hideBanner, 3000);

    } catch (err) {
        showBanner('⚠️ Cannot reach API server (port 5000). Run: python3 api_server.py', 'warning');
        console.error('API fetch error:', err);
    }
}

function renderWaitingState() {
    const tableBody = document.getElementById('influencersTableBody');
    if (!tableBody) return;
    tableBody.innerHTML = `
        <tr>
            <td colspan="5" style="text-align:center; padding: 40px; color: var(--text-muted, #aaa); font-size: 0.95rem;">
                <div style="font-size: 2rem; margin-bottom: 10px;">⏳</div>
                Waiting for Spark to process the first batch…<br>
                <small>This usually takes 10–30 seconds after startup.</small>
            </td>
        </tr>
    `;

    const totalEdgesEl = document.getElementById('totalEdges');
    const activeVerticesEl = document.getElementById('activeVertices');
    const batchSpeedEl = document.getElementById('batchSpeed');
    if (totalEdgesEl) totalEdgesEl.textContent = '—';
    if (activeVerticesEl) activeVerticesEl.textContent = '—';
    if (batchSpeedEl) batchSpeedEl.textContent = 'Starting…';
}

function startLiveFeed() {
    // Show waiting state immediately
    renderWaitingState();
    showBanner('🔌 Connecting to Spark pipeline API…', 'info');

    // Fetch immediately, then poll every 3s
    fetchResults();
    setInterval(fetchResults, POLL_INTERVAL_MS);
}

// === Render Table ===
function renderTable(data, tableBody) {
    if (!tableBody) return;
    tableBody.innerHTML = '';

    const maxScore = Math.max(...data.map(d => parseFloat(d.pagerank_score)));

    data.forEach((inf, index) => {
        const rank = index + 1;
        let rankClass = 'rank-other';
        if (rank === 1) rankClass = 'rank-1';
        else if (rank === 2) rankClass = 'rank-2';
        else if (rank === 3) rankClass = 'rank-3';

        let trendIcon = '—';
        let trendClass = 'trend-flat';
        if (inf.trend === 'up')   { trendIcon = '↑'; trendClass = 'trend-up'; }
        if (inf.trend === 'down') { trendIcon = '↓'; trendClass = 'trend-down'; }

        const barWidth = Math.max(5, (parseFloat(inf.pagerank_score) / maxScore) * 100);

        const row = document.createElement('tr');
        row.innerHTML = `
            <td><span class="rank-badge ${rankClass}">#${rank}</span></td>
            <td><span class="user-id">User_${inf.user_id}</span></td>
            <td>
                <div style="font-weight: 600;">${parseFloat(inf.pagerank_score).toFixed(4)}</div>
                <div class="score-bar-container">
                    <div class="score-bar" style="width: ${barWidth}%;"></div>
                </div>
            </td>
            <td>${Number(inf.in_degree).toLocaleString()}</td>
            <td class="${trendClass}">${trendIcon}</td>
        `;
        tableBody.appendChild(row);
    });
}
