// Application State
const STATE = {
    watchlists: {}, 
    currentTab: '',
    refreshInterval: parseInt(localStorage.getItem('refreshInterval')) || 0,
    apiSource: localStorage.getItem('apiSource') || 'twelvedata',
    intervalId: null,
    lastData: {}, 
    sortCol: null,
    sortAsc: true,
    keys: {
        twelvedata: localStorage.getItem('TWELVE_DATA_API_KEY') || '',
        finnhub: localStorage.getItem('FINNHUB_API_KEY') || ''
    }
};

const MAX_CREDITS_PER_MIN = 8; 

const KNOWN_CRYPTOS = ['BTC','ETH','USDT','BNB','SOL','USDC','XRP','ADA','DOGE','SHIB','AVAX','DOT','LINK','TRX','MATIC','LTC','BCH','XLM','NEAR','UNI'];

// Mapping for Clearbit API (Transparent US Stock Logos)
const STOCK_DOMAINS = {
    'AAPL': 'apple.com', 'NVDA': 'nvidia.com', 'TSLA': 'tesla.com', 'MSFT': 'microsoft.com',
    'SPY': 'ssga.com', 'ANET': 'arista.com', 'AMZN': 'amazon.com', 'GOOGL': 'google.com',
    'GOOG': 'google.com', 'META': 'meta.com', 'NFLX': 'netflix.com', 'AMD': 'amd.com', 
    'QQQ': 'invesco.com', 'INTC': 'intel.com', 'BABA': 'alibabagroup.com', 'V': 'visa.com',
    'JNJ': 'jnj.com', 'WMT': 'walmart.com', 'JPM': 'jpmorganchase.com', 'MA': 'mastercard.com',
    'PG': 'pg.com', 'HD': 'homedepot.com', 'CVX': 'chevron.com', 'LLY': 'lilly.com',
    'BAC': 'bankofamerica.com', 'KO': 'coca-colacompany.com', 'TSM': 'tsmc.com',
    'DIS': 'thewaltdisneycompany.com', 'ADBE': 'adobe.com', 'CRM': 'salesforce.com',
    'CSCO': 'cisco.com', 'NKE': 'nike.com', 'XOM': 'exxonmobil.com'
};

document.addEventListener('DOMContentLoaded', () => {
    initDataMigrate();
    initApiKeys();
    initUI();
    fetchData();
});

function initDataMigrate() {
    let savedLists = JSON.parse(localStorage.getItem('watchlists'));
    let oldSingleList = JSON.parse(localStorage.getItem('watchlist'));
    
    if (!savedLists) {
        savedLists = { "Default": oldSingleList || ['NVDA', 'ANET', 'SPY', 'BTC-USD'] };
        localStorage.setItem('watchlists', JSON.stringify(savedLists));
    }
    
    STATE.watchlists = savedLists;
    
    let savedTab = localStorage.getItem('currentTab');
    if (!savedTab || !STATE.watchlists[savedTab]) {
        savedTab = Object.keys(STATE.watchlists)[0];
    }
    STATE.currentTab = savedTab;
}

function initApiKeys() {
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
    
    document.getElementById('add-btn').addEventListener('click', addSymbols);
    document.getElementById('symbol-input').addEventListener('keypress', (e) => { if (e.key === 'Enter') addSymbols(); });
    document.getElementById('refresh-btn').addEventListener('click', fetchData);
    
    document.getElementById('add-tab-btn').addEventListener('click', addNewTab);
    
    document.getElementById('source-select').addEventListener('change', (e) => {
        STATE.apiSource = e.target.value;
        localStorage.setItem('apiSource', STATE.apiSource);
        verifyKeyForCurrentSource();
        renderSkeleton();
        fetchData();
    });

    document.getElementById('refresh-select').addEventListener('change', (e) => {
        const newInterval = parseInt(e.target.value);
        STATE.refreshInterval = newInterval;
        checkBudgetAndAdjust();
        localStorage.setItem('refreshInterval', STATE.refreshInterval);
        setupAutoRefresh();
    });

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
    renderTabs();
    renderSkeleton();
}

// --- Tab Management ---
function renderTabs() {
    const container = document.getElementById('tabs-list');
    container.innerHTML = '';
    
    const tabNames = Object.keys(STATE.watchlists);
    
    tabNames.forEach(tabName => {
        const div = document.createElement('div');
        div.className = `tab ${tabName === STATE.currentTab ? 'active' : ''}`;
        
        const showDelete = tabNames.length > 1;
        
        div.innerHTML = `
            <span class="tab-name">${tabName}</span>
            <span class="tab-action edit" title="Rename" onclick="event.stopPropagation(); renameTab('${tabName}')">✏️</span>
            ${showDelete ? `<span class="tab-action delete" title="Delete" onclick="event.stopPropagation(); deleteTab('${tabName}')">✕</span>` : ''}
        `;
        
        div.onclick = () => switchTab(tabName);
        container.appendChild(div);
    });
}

function switchTab(tabName) {
    if (STATE.currentTab === tabName) return;
    STATE.currentTab = tabName;
    localStorage.setItem('currentTab', tabName);
    
    checkBudgetAndAdjust();
    
    STATE.sortCol = null;
    updateSortIcons();
    
    renderTabs();
    renderSkeleton();
    fetchData();
}

function addNewTab() {
    const name = prompt("Enter name for the new Watchlist Tab:");
    if (!name || !name.trim()) return;
    const cleanName = name.trim();
    if (STATE.watchlists[cleanName]) { showAlert("A tab with this name already exists."); return; }
    STATE.watchlists[cleanName] = [];
    saveWatchlists();
    switchTab(cleanName);
}

function renameTab(oldName) {
    const newName = prompt("Enter new name for tab:", oldName);
    if (!newName || !newName.trim() || newName.trim() === oldName) return;
    const cleanName = newName.trim();
    if (STATE.watchlists[cleanName]) { showAlert("A tab with this name already exists."); return; }
    
    STATE.watchlists[cleanName] = STATE.watchlists[oldName];
    delete STATE.watchlists[oldName];
    
    if (STATE.currentTab === oldName) {
        STATE.currentTab = cleanName;
        localStorage.setItem('currentTab', cleanName);
    }
    saveWatchlists();
    renderTabs();
}

function deleteTab(tabName) {
    if (!confirm(`Are you sure you want to delete the tab '${tabName}'?`)) return;
    delete STATE.watchlists[tabName];
    if (STATE.currentTab === tabName) {
        STATE.currentTab = Object.keys(STATE.watchlists)[0];
        localStorage.setItem('currentTab', STATE.currentTab);
    }
    saveWatchlists();
    renderTabs();
    renderSkeleton();
    fetchData();
}

function saveWatchlists() {
    localStorage.setItem('watchlists', JSON.stringify(STATE.watchlists));
}

// --- Background Core ---
function checkBudgetAndAdjust() {
    if (STATE.refreshInterval > 0 && STATE.apiSource === 'twelvedata') {
        const currentList = STATE.watchlists[STATE.currentTab] || [];
        const requiredCredits = currentList.length * (60 / STATE.refreshInterval);
        
        if (requiredCredits > MAX_CREDITS_PER_MIN) {
            showAlert(`Watchlist size (${currentList.length}) exceeds Twelve Data limit for ${STATE.refreshInterval}s refresh. Auto-refresh turned Off.`);
            STATE.refreshInterval = 0;
            document.getElementById('refresh-select').value = '0';
        }
    }
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

function addSymbols() {
    const inputField = document.getElementById('symbol-input');
    const rawInput = inputField.value;
    if (!rawInput.trim()) return;
    
    const symbolsToAdd = rawInput.split(',').map(s => s.trim().toUpperCase()).filter(s => s);
    const currentList = STATE.watchlists[STATE.currentTab];
    let addedCount = 0;

    symbolsToAdd.forEach(sym => {
        if (KNOWN_CRYPTOS.includes(sym)) { sym = sym + '-USD'; }
        if (!currentList.includes(sym)) {
            currentList.push(sym);
            addedCount++;
        }
    });
    
    if (addedCount > 0) {
        saveWatchlists();
        checkBudgetAndAdjust();
        renderSkeleton();
        fetchData();
    }
    inputField.value = '';
}

window.removeSymbol = function(symbol) {
    STATE.watchlists[STATE.currentTab] = STATE.watchlists[STATE.currentTab].filter(s => s !== symbol);
    saveWatchlists();
    delete STATE.lastData[symbol];
    renderTable();
};

// --- Logo System (Developer Alternative: APIs for Transparent Logos) ---
function getLogoHtml(symbol) {
    const isCrypto = symbol.includes('-') || symbol.includes('/');
    if (isCrypto) {
        const token = symbol.split(/[-/]/)[0].toLowerCase();
        // Using spothq CDN for highly crisp, transparent SVG crypto logos
        const url = `https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/svg/color/${token}.svg`;
        const fallbackUrl = `https://ui-avatars.com/api/?name=${token.toUpperCase()}&background=475569&color=fff&size=64&bold=true`;
        return `<img src="${url}" class="img-logo" onerror="this.src='${fallbackUrl}'">`;
    } else {
        const domain = STOCK_DOMAINS[symbol] || `${symbol.toLowerCase()}.com`;
        // Using Clearbit API for transparent, borderless US stock logos
        const url = `https://logo.clearbit.com/${domain}`;
        const fallbackUrl = `https://ui-avatars.com/api/?name=${symbol}&background=475569&color=fff&size=64&bold=true`;
        return `<img src="${url}" class="img-logo" onerror="this.src='${fallbackUrl}'">`;
    }
}

// --- Data Fetching ---
async function fetchData() {
    const currentKey = STATE.keys[STATE.apiSource];
    const currentList = STATE.watchlists[STATE.currentTab] || [];
    
    if (!currentKey) return updateStatus('red', 'Missing API Key');
    if (currentList.length === 0) return updateStatus('yellow', 'Watchlist Empty');

    updateStatus('yellow', 'Fetching...');
    
    try {
        if (STATE.apiSource === 'twelvedata') {
            await fetchTwelveData(currentKey, currentList);
        } else {
            await fetchFinnhub(currentKey, currentList);
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

async function fetchTwelveData(key, currentList) {
    const formatted = currentList.map(s => s.includes('-') ? s.replace('-', '/') : s).join(',');
    const res = await fetch(`https://api.twelvedata.com/quote?symbol=${formatted}&apikey=${key}`);
    const data = await res.json();
    
    if (data.status === 'error') throw new Error(data.message);

    let norm = {};
    if (currentList.length === 1) {
        const uiSym = data.symbol.replace('/', '-');
        norm[uiSym] = data;
    } else {
        for (const k in data) norm[k.replace('/', '-')] = data[k];
    }

    const today = new Date().toISOString().split('T')[0];
    const oneYearAgoMs = Date.now() - (365 * 24 * 60 * 60 * 1000);

    for (const sym of currentList) {
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

async function fetchFinnhub(key, currentList) {
    for (const sym of currentList) {
        try {
            let finnhubSymbol = sym;
            if (sym.includes('-')) {
                const pieces = sym.split('-');
                finnhubSymbol = `BINANCE:${pieces[0]}${pieces[1]}T`; 
            }

            const quoteRes = await fetch(`https://finnhub.io/api/v1/quote?symbol=${finnhubSymbol}&token=${key}`);
            const q = await quoteRes.json();
            if (!q.c) continue;

            STATE.lastData[sym] = {
                symbol: sym,
                price: q.c,
                changeDay: q.d,
                changePct: q.dp,
                change365: null, 
                return1Y: null,
                high52: q.h, 
                low52: q.l
            };
        } catch (e) { console.error(e); }
    }
}

// --- Rendering ---
function renderTable() {
    const tbody = document.getElementById('table-body');
    tbody.innerHTML = '';

    const currentList = STATE.watchlists[STATE.currentTab] || [];

    if (currentList.length === 0) {
        tbody.innerHTML = '<tr><td colspan="11" class="text-center">Current Watchlist is empty. Add a symbol above.</td></tr>';
        return;
    }

    let items = currentList.map(sym => STATE.lastData[sym] || { symbol: sym });

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
    
    const signDay = item.changeDay > 0 ? '+' : '';
    const sign365 = item.change365 > 0 ? '+' : '';

    const fmtMoney = (v) => v == null || isNaN(v) ? '—' : parseFloat(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const fmtPct = (v) => v == null || isNaN(v) ? '—' : parseFloat(v).toFixed(2) + '%';
    const getCol = (v) => v == null || isNaN(v) || v == 0 ? 'val-neutral' : v > 0 ? 'val-up' : 'val-down';

    // Core requirement: Hide "-USD" suffix in display while keeping functionality intact
    const displaySymbol = item.symbol.includes('-') ? item.symbol.split('-')[0] : item.symbol;

    tr.innerHTML = `
        <td class="drag-handle">☰</td>
        <td><div class="logo-container">${getLogoHtml(item.symbol)}</div></td>
        <td class="symbol-col">${displaySymbol}</td>
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
    
    tr.addEventListener('dragstart', handleDragStart);
    tr.addEventListener('dragover', handleDragOver);
    tr.addEventListener('drop', handleDrop);
    tr.addEventListener('dragend', handleDragEnd);
    
    return tr;
}

function renderSkeleton() {
    const tbody = document.getElementById('table-body');
    const currentList = STATE.watchlists[STATE.currentTab] || [];
    
    if (currentList.length === 0) return;
    tbody.innerHTML = currentList.map(() => `<tr><td colspan="11"><div class="skeleton"></div></td></tr>`).join('');
}

// --- Drag & Drop ---
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
    
    if (this !== dragSourceEl) {
        const currIdx = children.indexOf(dragSourceEl);
        const targetIdx = children.indexOf(this);
        if (currIdx < targetIdx) { tbody.insertBefore(dragSourceEl, this.nextSibling); } 
        else { tbody.insertBefore(dragSourceEl, this); }
    }
}

function handleDrop(e) { e.preventDefault(); }

function handleDragEnd() {
    this.classList.remove('dragging');
    const tbody = document.getElementById('table-body');
    STATE.watchlists[STATE.currentTab] = Array.from(tbody.children).map(tr => tr.id.replace('row-', ''));
    saveWatchlists();
    
    STATE.sortCol = null;
    updateSortIcons();
}

function setupDragAndDrop() {
    document.getElementById('table-body').addEventListener('dragover', (e) => e.preventDefault());
}
