// Application State
const STATE = {
    watchlist: JSON.parse(localStorage.getItem('watchlist')) || ['NVDA', 'ANET', 'SPY', 'BTC-USD'],
    refreshInterval: parseInt(localStorage.getItem('refreshInterval')) || 0,
    apiSource: localStorage.getItem('apiSource') || 'twelvedata',
    intervalId: null,
    lastData: {}, // Holds computed, flattened row objects indexed by symbol
    sortCol: null,
    sortAsc: true,
    keys: {
        twelvedata: localStorage.getItem('TWELVE_DATA_API_KEY') || '',
        finnhub: localStorage.getItem('FINNHUB_API_KEY') || ''
    }
};

const MAX_CREDITS_PER_MIN = 8; // Free Twelve Data Limit

// Popular stock domain mapping for Clearbit Logos
const STOCK_DOMAINS = {
    'AAPL': 'apple.com', 'NVDA': 'nvidia.com', 'TSLA': 'tesla.com', 'MSFT': 'microsoft.com',
    'SPY': 'ssga.com', 'ANET': 'arista.com', 'AMZN': 'amazon.com', 'GOOGL': 'google.com',
    'META': 'meta.com', 'NFLX': 'netflix.com', 'AMD': 'amd.com', 'QQQ': 'invesco.com'
};

document.addEventListener('DOMContentLoaded', () => {
    initApiKeys();
    initUI();
    fetchData();
});

function initApiKeys() {
    // Sync from local-config if present
    if (window.APP_CONFIG) {
        if (!STATE.keys.twelvedata && window.APP_CONFIG.TWELVE_DATA_API_KEY !== 'PASTE_KEY_HERE') {
            STATE.keys.twelvedata = window.APP_CONFIG.TWELVE_DATA_API_KEY;
            localStorage.setItem('TWELVE_DATA_API_KEY', STATE.keys.twelvedata);
        }
        if (!STATE.keys.finnhub && window.APP_CONFIG.FINNHUB_API_KEY !== 'PASTE_KEY_HERE') {
            STATE.keys.finnhub = window.APP_CONFIG.FINNHUB_API_KEY;
            localStorage.setItem('FINNHUB_API_KEY', STATE.keys.finnhub);
        }
    }

    // Prompt if chosen source is missing a key
    verifyKeyForCurrentSource();
}

function verifyKeyForCurrentSource() {
    if (STATE.apiSource === 'twelvedata' && !STATE.keys.twelvedata) {
        const key = prompt("Enter Twelve Data API Key:");
        if (key) { STATE.keys.twelvedata = key; localStorage.setItem('TWELVE_DATA_API_KEY', key); }
    } else if (STATE.apiSource === 'finnhub' && !STATE.keys.finnhub) {
        const key = prompt("Enter Finnhub API Key:");
        if (key) { STATE.keys.finnhub = key; localStorage.setItem('FINNHUB_API_KEY', key); }
    }
}

function initUI() {
    document.getElementById('refresh-select').value = STATE.refreshInterval;
    document.getElementById('source-select').value = STATE.apiSource;
    
    // UI Observers
    document.getElementById('add-btn').addEventListener('click', addSymbol);
    document.getElementById('symbol-input').addEventListener('keypress', (e) => { if (e.key === 'Enter') addSymbol(); });
    document.getElementById('refresh-btn').addEventListener('click', fetchData);
    
    document.getElementById('source-select').addEventListener('change', (e) => {
        STATE.apiSource = e.target.value;
        localStorage.setItem('apiSource', STATE.apiSource);
        verifyKeyForCurrentSource();
        renderSkeleton();
        fetchData();
    });

    document.getElementById('refresh-select').addEventListener('change', (e) => {
        const newInterval = parseInt(e.target.value);
        if (newInterval > 0 && STATE.apiSource === 'twelvedata') {
            const requiredCredits = STATE.watchlist.length * (60 / newInterval);
            if (requiredCredits > MAX_CREDITS_PER_MIN) {
                showAlert(`Twelve Data tier limit restriction. Watchlist requires ${requiredCredits} credits/min. (Max: ${MAX_CREDITS_PER_MIN})`);
                e.target.value = STATE.refreshInterval;
                return;
            }
        }
        STATE.refreshInterval = newInterval;
        localStorage.setItem('refreshInterval', newInterval);
        setupAutoRefresh();
    });

    // Header Sort listeners
    document.querySelectorAll('th.sortable').forEach(th => {
        th.addEventListener('click', () => {
            const property = th.getAttribute('data-sort');
            if (STATE.sortCol === property) {
                STATE.sortAsc = !STATE.sortAsc;
            } else {
                STATE.sortCol = property;
                STATE.sortAsc = true;
            }
            updateSortIcons();
            renderTable();
        });
    });

    setupAutoRefresh();
    setupDragAndDrop();
    renderSkeleton();
}

function setupAutoRefresh() {
    if (STATE.intervalId) clearInterval(STATE.intervalId);
    if (STATE.refreshInterval > 0) {
        STATE.intervalId = setInterval(fetchData, STATE.refreshInterval * 1000);
    }
}

function showAlert(msg) {
    const alerts = document.getElementById('alerts');
    const el = document.createElement('div');
    el.className = 'alert';
    el.textContent = msg;
    alerts.appendChild(el);
    setTimeout(() => el.remove(), 6000);
}

function updateStatus(status, text) {
    document.getElementById('connection-dot').className = `dot ${status}`;
    document.getElementById('market-status').textContent = text;
}

function updateSortIcons() {
    document.querySelectorAll('th.sortable').forEach(th => {
        const icon = th.querySelector('.sort-icon');
        if (th.getAttribute('data-sort') === STATE.sortCol) {
            icon.textContent = STATE.sortAsc ? '▲' : '▼';
        } else {
            icon.textContent = '';
        }
    });
}

function addSymbol() {
    const input = document.getElementById('symbol-input');
    const symbol = input.value.trim().toUpperCase();
    if (!symbol) return;
    if (STATE.watchlist.includes(symbol)) return input.value = '';
    
    STATE.watchlist.push(symbol);
    localStorage.setItem('watchlist', JSON.stringify(STATE.watchlist));
    input.value = '';
    
    renderSkeleton();
    fetchData();
}

window.removeSymbol = function(symbol) {
    STATE.watchlist = STATE.watchlist.filter(s => s !== symbol);
    localStorage.setItem('watchlist', JSON.stringify(STATE.watchlist));
    delete STATE.lastData[symbol];
    renderTable();
};

// Logo URL Helper (Method 1: External Free CDNs)
function getLogoHtml(symbol) {
    const isCrypto = symbol.includes('-') || symbol.includes('/');
    if (isCrypto) {
        const token = symbol.split(/[-/]/)[0].toLowerCase();
        const url = `https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/32/color/${token}.png`;
        return `<img src="${url}" class="img-logo" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                <div class="text-logo" style="display:none;">${token.substring(0,2)}</div>`;
    } else {
        const domain = STOCK_DOMAINS[symbol];
        if (domain) {
            return `<img src="https://logo.clearbit.com/${domain}" class="img-logo" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                    <div class="text-logo" style="display:none;">${symbol.substring(0,2)}</div>`;
        }
        return `<div class="text-logo">${symbol.substring(0,2)}</div>`;
    }
}

// Data Processing Switchboard
async function fetchData() {
    const currentKey = STATE.keys[STATE.apiSource];
    if (!currentKey) return updateStatus('red', 'Missing API Key');
    if (STATE.watchlist.length === 0) return updateStatus('yellow', 'Watchlist Empty');

    updateStatus('yellow', 'Fetching...');
    
    try {
        if (STATE.apiSource === 'twelvedata') {
            await fetchTwelveData(currentKey);
        } else {
            await fetchFinnhub(currentKey);
        }
        document.getElementById('last-updated-time').textContent = new Date().toLocaleTimeString();
        updateStatus('green', 'Connected');
        renderTable();
    } catch (err) {
        updateStatus('red', 'Fetch Error');
        showAlert(`Error: ${err.message}. Retaining last successful data.`);
        renderTable();
    }
}

// Twelve Data Implementation
async function fetchTwelveData(key) {
    const formatted = STATE.watchlist.map(s => s.includes('-') ? s.replace('-', '/') : s).join(',');
    const res = await fetch(`https://api.twelvedata.com/quote?symbol=${formatted}&apikey=${key}`);
    const data = await res.json();
    
    if (data.status === 'error') throw new Error(data.message);

    let norm = {};
    if (STATE.watchlist.length === 1) {
        const uiSym = data.symbol.replace('/', '-');
        norm[uiSym] = data;
    } else {
        for (const k in data) norm[k.replace('/', '-')] = data[k];
    }

    // Historical Cache processing (1Y Change)
    const today = new Date().toISOString().split('T')[0];
    const oneYearAgoMs = Date.now() - (365 * 24 * 60 * 60 * 1000);

    for (const sym of STATE.watchlist) {
        const q = norm[sym];
        if (!q || q.status === 'error') continue;

        let price1Y = null;
        const cacheStr = localStorage.getItem(`ts_${sym}_${today}`);
        
        if (cacheStr) {
            price1Y = JSON.parse(cacheStr).price1YearAgo;
        } else {
            try {
                const apiSym = sym.includes('-') ? sym.replace('-', '/') : sym;
                const tsRes = await fetch(`https://api.twelvedata.com/time_series?symbol=${apiSym}&interval=1week&outputsize=54&apikey=${key}`);
                const tsData = await tsRes.json();
                if (tsData.values) {
                    let minDiff = Infinity;
                    for (let val of tsData.values) {
                        let diff = Math.abs(new Date(val.datetime).getTime() - oneYearAgoMs);
                        if (diff < minDiff) { minDiff = diff; price1Y = parseFloat(val.close); }
                    }
                    if (price1Y) localStorage.setItem(`ts_${sym}_${today}`, JSON.stringify({ price1YearAgo: price1Y }));
                }
            } catch(e){}
        }

        const price = parseFloat(q.close);
        let c365 = null, r1Y = null;
        if (price1Y && !isNaN(price)) {
            c365 = price - price1Y;
            r1Y = (c365 / price1Y) * 100;
        }

        STATE.lastData[sym] = {
            symbol: sym,
            name: q.name || '—',
            price: price,
            changeDay: parseFloat(q.change),
            changePct: parseFloat(q.percent_change),
            change365: c365,
            return1Y: r1Y,
            high52: q.fifty_two_week ? parseFloat(q.fifty_two_week.high) : null,
            low52: q.fifty_two_week ? parseFloat(q.fifty_two_week.low) : null
        };
    }
}

// Alternative Provider: Finnhub Implementation
async function fetchFinnhub(key) {
    for (const sym of STATE.watchlist) {
        try {
            let finnhubSymbol = sym;
            // Map simple crypto presentation BTC-USD to Finnhub compatible representation Binances
            if (sym.includes('-')) {
                const pieces = sym.split('-');
                finnhubSymbol = `BINANCE:${pieces[0]}${pieces[1]}T`; // e.g. BINANCE:BTCUSDT
            }

            const quoteRes = await fetch(`https://finnhub.io/api/v1/quote?symbol=${finnhubSymbol}&token=${key}`);
            const q = await quoteRes.json();

            if (!q.c) continue; // Skip if invalid profile returned

            // Finnhub doesn't serve asset name inside quote, supply default uppercase naming
            const name = sym.includes('-') ? `${sym.split('-')[0]} Crypto` : `${sym} Equity`;

            STATE.lastData[sym] = {
                symbol: sym,
                name: name,
                price: q.c,
                changeDay: q.d,
                changePct: q.dp,
                change365: null, // Finnhub core free endpoint does not include historical return
                return1Y: null,
                high52: q.h, // Day's boundaries assigned as contextual high/low under free endpoints
                low52: q.l
            };
        } catch (e) { console.error(e); }
    }
}

// Table Rendering & Multi-Sort
function renderTable() {
    const tbody = document.getElementById('table-body');
    tbody.innerHTML = '';

    if (STATE.watchlist.length === 0) {
        tbody.innerHTML = '<tr><td colspan="12" class="text-center">Watchlist empty</td></tr>';
        return;
    }

    // Prepare processing array matching current watchlist order
    let items = STATE.watchlist.map(sym => STATE.lastData[sym] || { symbol: sym });

    // Handle Active Header Sorting
    if (STATE.sortCol) {
        items.sort((a, b) => {
            let valA = a[STATE.sortCol];
            let valB = b[STATE.sortCol];

            if (valA == null) return 1;
            if (valB == null) return -1;

            if (typeof valA === 'string') {
                return STATE.sortAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
            } else {
                return STATE.sortAsc ? valA - valB : valB - valA;
            }
        });
    }

    items.forEach(item => {
        tbody.appendChild(createRowElement(item));
    });
}

function createRowElement(item) {
    const tr = document.createElement('tr');
    tr.id = `row-${item.symbol}`;
    tr.draggable = true;
    
    const err = !item.price;
    const signDay = item.changeDay > 0 ? '+' : '';
    const sign365 = item.change365 > 0 ? '+' : '';

    const fmtMoney = (v) => v == null || isNaN(v) ? '—' : parseFloat(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const fmtPct = (v) => v == null || isNaN(v) ? '—' : parseFloat(v).toFixed(2) + '%';
    const getCol = (v) => v == null || isNaN(v) || v == 0 ? 'val-neutral' : v > 0 ? 'val-up' : 'val-down';

    tr.innerHTML = `
        <td class="drag-handle">☰</td>
        <td><div class="logo-container">${getLogoHtml(item.symbol)}</div></td>
        <td class="symbol-col">${item.symbol}</td>
        <td class="name-col" title="${item.name || '—'}">${item.name || '—'}</td>
        <td class="text-right">${fmtMoney(item.price)}</td>
        <td class="text-right ${getCol(item.changeDay)}">${signDay}${fmtMoney(item.changeDay)}</td>
        <td class="text-right ${getCol(item.changePct)}">${signDay}${fmtPct(item.changePct)}</td>
        <td class="text-right ${getCol(item.change365)}">${sign365}${fmtMoney(item.change365)}</td>
        <td class="text-right ${getCol(item.return1Y)}">${sign365}${fmtPct(item.return1Y)}</td>
        <td class="text-right">${fmtMoney(item.high52)}</td>
        <td class="text-right">${fmtMoney(item.low52)}</td>
        <td class="text-center">
            <button class="btn danger" onclick="removeSymbol('${item.symbol}')">✕</button>
        </td>
    `;
    
    // Wire drag events back into dynamically created nodes
    tr.addEventListener('dragstart', handleDragStart);
    tr.addEventListener('dragover', handleDragOver);
    tr.addEventListener('drop', handleDrop);
    tr.addEventListener('dragend', handleDragEnd);
    
    return tr;
}

function renderSkeleton() {
    const tbody = document.getElementById('table-body');
    if (STATE.watchlist.length === 0) return;
    tbody.innerHTML = STATE.watchlist.map(() => `<tr><td colspan="12"><div class="skeleton"></div></td></tr>`).join('');
}

// Drag & Drop HTML5 Handler Core
let dragSourceEl = null;

function handleDragStart(e) {
    dragSourceEl = this;
    this.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/html', this.innerHTML);
}

function handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    
    const tbody = document.getElementById('table-body');
    const children = Array.from(tbody.children);
    const targetRow = this;
    
    if (targetRow !== dragSourceEl) {
        const currentIndex = children.indexOf(dragSourceEl);
        const targetIndex = children.indexOf(targetRow);
        
        if (currentIndex < targetIndex) {
            tbody.insertBefore(dragSourceEl, targetRow.nextSibling);
        } else {
            tbody.insertBefore(dragSourceEl, targetRow);
        }
    }
}

function handleDrop(e) {
    e.preventDefault();
}

function handleDragEnd() {
    this.classList.remove('dragging');
    
    // Persist new ordering schema into original underlying Watchlist Array
    const tbody = document.getElementById('table-body');
    const newOrder = Array.from(tbody.children).map(tr => tr.id.replace('row-', ''));
    
    STATE.watchlist = newOrder;
    localStorage.setItem('watchlist', JSON.stringify(STATE.watchlist));
    
    // Clear temporary sorts when manipulating order manually
    STATE.sortCol = null;
    updateSortIcons();
}

function setupDragAndDrop() {
    const tbody = document.getElementById('table-body');
    tbody.addEventListener('dragover', (e) => e.preventDefault());
}
