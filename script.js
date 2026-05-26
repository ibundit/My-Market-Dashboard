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
        finnhub: localStorage.getItem('FINNHUB_API_KEY') || '',
        fmp: localStorage.getItem('FMP_API_KEY') || ''
    }
};

const MAX_CREDITS_PER_MIN = 8; 

// Known cryptos for shorthand (e.g. typing BTC adds BTC-USD)
const KNOWN_CRYPTOS = ['BTC','ETH','USDT','BNB','SOL','USDC','XRP','ADA','DOGE','SHIB','AVAX','DOT','LINK','TRX','MATIC','LTC','BCH','XLM','NEAR','UNI','ZETA','IO','APT','SUI'];

document.addEventListener('DOMContentLoaded', () => {
    initDataMigrate();
    initApiKeys();
    initUI();
    fetchData();
});

function initDataMigrate() {
    let savedLists = JSON.parse(localStorage.getItem('watchlists'));
    if (!savedLists) {
        let oldSingleList = JSON.parse(localStorage.getItem('watchlist')) || ['NVDA', 'AAPL', 'BTC-USD', 'NEAR-USD'];
        savedLists = { "Default": oldSingleList };
    }
    STATE.watchlists = savedLists;
    
    let savedTab = localStorage.getItem('currentTab');
    if (!savedTab || !STATE.watchlists[savedTab]) savedTab = Object.keys(STATE.watchlists)[0];
    STATE.currentTab = savedTab;
}

function initApiKeys() {
    if (window.APP_CONFIG) {
        ['TWELVE_DATA_API_KEY', 'FINNHUB_API_KEY', 'FMP_API_KEY'].forEach(key => {
            const stateKey = key.split('_')[0].toLowerCase();
            if (!STATE.keys[stateKey] && window.APP_CONFIG[key] !== 'PASTE_KEY_HERE') {
                STATE.keys[stateKey] = window.APP_CONFIG[key];
                localStorage.setItem(key, STATE.keys[stateKey]);
            }
        });
    }
    verifyKeyForCurrentSource();
}

function verifyKeyForCurrentSource() {
    const s = STATE.apiSource;
    if (!STATE.keys[s]) {
        const keyName = s === 'fmp' ? 'Financial Modeling Prep (FMP)' : (s === 'finnhub' ? 'Finnhub' : 'Twelve Data');
        const key = prompt(`Enter ${keyName} API Key (Required for Stocks):`);
        if (key) { 
            STATE.keys[s] = key; 
            localStorage.setItem(`${s.toUpperCase()}_API_KEY`, key); 
        }
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
        STATE.refreshInterval = parseInt(e.target.value);
        checkBudgetAndAdjust();
        localStorage.setItem('refreshInterval', STATE.refreshInterval);
        setupAutoRefresh();
    });

    document.querySelectorAll('th.sortable').forEach(th => {
        th.addEventListener('click', () => {
            const property = th.getAttribute('data-sort');
            if (STATE.sortCol === property) STATE.sortAsc = !STATE.sortAsc;
            else { STATE.sortCol = property; STATE.sortAsc = true; }
            updateSortIcons();
            renderTable();
        });
    });

    setupAutoRefresh();
    setupDragAndDrop();
    renderTabs();
    renderSkeleton();
}

// --- Tabs Management ---
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
    STATE.sortCol = null; updateSortIcons();
    renderTabs(); renderSkeleton(); fetchData();
}

function addNewTab() {
    const name = prompt("Enter name for the new Watchlist Tab:");
    if (!name || !name.trim()) return;
    const cleanName = name.trim();
    if (STATE.watchlists[cleanName]) return showAlert("A tab with this name already exists.");
    STATE.watchlists[cleanName] = [];
    localStorage.setItem('watchlists', JSON.stringify(STATE.watchlists));
    switchTab(cleanName);
}

function renameTab(oldName) {
    const newName = prompt("Enter new name for tab:", oldName);
    if (!newName || !newName.trim() || newName.trim() === oldName) return;
    const cleanName = newName.trim();
    if (STATE.watchlists[cleanName]) return showAlert("A tab with this name already exists.");
    STATE.watchlists[cleanName] = STATE.watchlists[oldName];
    delete STATE.watchlists[oldName];
    if (STATE.currentTab === oldName) { STATE.currentTab = cleanName; localStorage.setItem('currentTab', cleanName); }
    localStorage.setItem('watchlists', JSON.stringify(STATE.watchlists));
    renderTabs();
}

function deleteTab(tabName) {
    if (!confirm(`Are you sure you want to delete '${tabName}'?`)) return;
    delete STATE.watchlists[tabName];
    if (STATE.currentTab === tabName) {
        STATE.currentTab = Object.keys(STATE.watchlists)[0];
        localStorage.setItem('currentTab', STATE.currentTab);
    }
    localStorage.setItem('watchlists', JSON.stringify(STATE.watchlists));
    renderTabs(); renderSkeleton(); fetchData();
}

// --- Utils ---
function checkBudgetAndAdjust() {
    if (STATE.refreshInterval > 0 && STATE.apiSource === 'twelvedata') {
        const stocks = (STATE.watchlists[STATE.currentTab] || []).filter(s => !s.includes('-'));
        const requiredCredits = stocks.length * (60 / STATE.refreshInterval);
        if (requiredCredits > MAX_CREDITS_PER_MIN) {
            showAlert(`Too many stocks for Twelve Data free tier. Auto-refresh turned Off.`);
            STATE.refreshInterval = 0; document.getElementById('refresh-select').value = '0';
        }
    }
}

function setupAutoRefresh() {
    if (STATE.intervalId) clearInterval(STATE.intervalId);
    if (STATE.refreshInterval > 0) STATE.intervalId = setInterval(fetchData, STATE.refreshInterval * 1000);
}

function showAlert(msg) {
    const alerts = document.getElementById('alerts');
    const el = document.createElement('div'); el.className = 'alert'; el.textContent = msg;
    alerts.appendChild(el); setTimeout(() => el.remove(), 6000);
}

function updateStatus(status, text) {
    document.getElementById('connection-dot').className = `dot ${status}`;
    document.getElementById('market-status').textContent = text;
}

function updateSortIcons() {
    document.querySelectorAll('th.sortable').forEach(th => {
        const icon = th.querySelector('.sort-icon');
        icon.textContent = th.getAttribute('data-sort') === STATE.sortCol ? (STATE.sortAsc ? '▲' : '▼') : '';
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
        if (KNOWN_CRYPTOS.includes(sym)) sym = sym + '-USD';
        if (!currentList.includes(sym)) { currentList.push(sym); addedCount++; }
    });
    
    if (addedCount > 0) {
        localStorage.setItem('watchlists', JSON.stringify(STATE.watchlists));
        checkBudgetAndAdjust(); renderSkeleton(); fetchData();
    }
    inputField.value = '';
}

window.removeSymbol = function(symbol) {
    STATE.watchlists[STATE.currentTab] = STATE.watchlists[STATE.currentTab].filter(s => s !== symbol);
    localStorage.setItem('watchlists', JSON.stringify(STATE.watchlists));
    delete STATE.lastData[symbol];
    renderTable();
};

// --- Logo Engine v6 (Smart Hybrid) ---
function getLogoHtml(symbol) {
    const isCrypto = symbol.includes('-') || symbol.includes('/');
    const cleanSym = isCrypto ? symbol.split(/[-/]/)[0].toUpperCase() : symbol.toUpperCase();
    
    let url = '';
    if (isCrypto) {
        // CoinCap CDN covers almost all cryptos accurately and transparently
        url = `https://assets.coincap.io/assets/icons/${cleanSym.toLowerCase()}@2x.png`;
    } else {
        // FMP CDN for US Stocks (Transparent PNG)
        url = `https://financialmodelingprep.com/image-stock/${cleanSym}.png`;
    }
    
    // DiceBear fallback for minimalist transparent SVG initials if logo doesn't exist
    const fallbackUrl = `https://api.dicebear.com/7.x/initials/svg?seed=${cleanSym}&backgroundColor=1e293b&textColor=f8fafc`;
    return `<img src="${url}" class="img-logo" onerror="this.src='${fallbackUrl}'">`;
}

// --- Data Engine ---
async function fetchData() {
    const currentList = STATE.watchlists[STATE.currentTab] || [];
    if (currentList.length === 0) return updateStatus('yellow', 'Watchlist Empty');

    updateStatus('yellow', 'Fetching...');
    
    const cryptoSymbols = currentList.filter(s => s.includes('-'));
    const stockSymbols = currentList.filter(s => !s.includes('-'));

    try {
        const fetchPromises = [];
        // Crypto always goes to Binance (Free, No Key, Real-Time)
        if (cryptoSymbols.length > 0) fetchPromises.push(fetchBinance(cryptoSymbols));
        
        // Stocks go to selected source
        if (stockSymbols.length > 0) {
            const currentKey = STATE.keys[STATE.apiSource];
            if (!currentKey) {
                showAlert(`Missing API Key for ${STATE.apiSource.toUpperCase()}`);
            } else {
                if (STATE.apiSource === 'twelvedata') fetchPromises.push(fetchTwelveData(currentKey, stockSymbols));
                else if (STATE.apiSource === 'finnhub') fetchPromises.push(fetchFinnhub(currentKey, stockSymbols));
                else if (STATE.apiSource === 'fmp') fetchPromises.push(fetchFMP(currentKey, stockSymbols));
            }
        }
        
        await Promise.all(fetchPromises);
        
        document.getElementById('last-updated-time').textContent = new Date().toLocaleTimeString();
        updateStatus('green', 'Connected');
        renderTable();
    } catch (err) {
        updateStatus('red', 'Fetch Error');
        showAlert(`Error: ${err.message}. Showing last data.`);
        renderTable();
    }
}

// 1. Binance Fetcher (Crypto only)
async function fetchBinance(cryptoList) {
    for (const sym of cryptoList) {
        const token = sym.split('-')[0].toUpperCase();
        try {
            // 24hr Ticker endpoint
            const res = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${token}USDT`);
            if(!res.ok) continue;
            const data = await res.json();
            
            // Try fetching historical (1 Year) via klines (Weekly, limit 52)
            let c365 = null, r1Y = null;
            try {
                const kRes = await fetch(`https://api.binance.com/api/v3/klines?symbol=${token}USDT&interval=1w&limit=53`);
                if(kRes.ok) {
                    const kData = await kRes.json();
                    if(kData.length > 50) {
                        const price1Y = parseFloat(kData[0][4]); // close price of 52 weeks ago
                        const currPrice = parseFloat(data.lastPrice);
                        c365 = currPrice - price1Y;
                        r1Y = (c365 / price1Y) * 100;
                    }
                }
            } catch(e){}

            STATE.lastData[sym] = {
                symbol: sym,
                price: parseFloat(data.lastPrice),
                changeDay: parseFloat(data.priceChange),
                changePct: parseFloat(data.priceChangePercent),
                change365: c365,
                return1Y: r1Y,
                high52: parseFloat(data.highPrice), // Binance 24h high as contextual fallback
                low52: parseFloat(data.lowPrice)
            };
        } catch(e) { console.error(`Binance failed for ${sym}`, e); }
    }
}

// 2. Financial Modeling Prep (FMP) Fetcher
async function fetchFMP(key, stockList) {
    const symbols = stockList.join(',');
    const res = await fetch(`https://financialmodelingprep.com/api/v3/quote/${symbols}?apikey=${key}`);
    const data = await res.json();
    
    if (data.length === undefined) throw new Error(data['Error Message'] || 'FMP Error');
    
    data.forEach(q => {
        STATE.lastData[q.symbol] = {
            symbol: q.symbol,
            price: q.price,
            changeDay: q.change,
            changePct: q.changesPercentage,
            change365: null, // Basic quote doesn't have 1y return
            return1Y: null,
            high52: q.yearHigh,
            low52: q.yearLow
        };
    });
}

// 3. Finnhub Fetcher
async function fetchFinnhub(key, stockList) {
    for (const sym of stockList) {
        try {
            const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${sym}&token=${key}`);
            const q = await res.json();
            if (!q.c) continue;
            STATE.lastData[sym] = {
                symbol: sym,
                price: q.c,
                changeDay: q.d,
                changePct: q.dp,
                change365: null, return1Y: null,
                high52: q.h, low52: q.l
            };
        } catch(e) {}
    }
}

// 4. Twelve Data Fetcher
async function fetchTwelveData(key, stockList) {
    const formatted = stockList.join(',');
    const res = await fetch(`https://api.twelvedata.com/quote?symbol=${formatted}&apikey=${key}`);
    const data = await res.json();
    if (data.status === 'error') throw new Error(data.message);

    let norm = {};
    if (stockList.length === 1) norm[data.symbol] = data;
    else for (const k in data) norm[k] = data[k];

    for (const sym of stockList) {
        const q = norm[sym];
        if (!q || q.status === 'error') continue;
        STATE.lastData[sym] = {
            symbol: sym,
            price: parseFloat(q.close),
            changeDay: parseFloat(q.change),
            changePct: parseFloat(q.percent_change),
            change365: null, return1Y: null,
            high52: q.fifty_two_week ? parseFloat(q.fifty_two_week.high) : null,
            low52: q.fifty_two_week ? parseFloat(q.fifty_two_week.low) : null
        };
    }
}

// --- Rendering ---
function renderTable() {
    const tbody = document.getElementById('table-body');
    tbody.innerHTML = '';
    const currentList = STATE.watchlists[STATE.currentTab] || [];

    if (currentList.length === 0) {
        tbody.innerHTML = '<tr><td colspan="11" class="text-center">Watchlist empty</td></tr>'; return;
    }

    let items = currentList.map(sym => STATE.lastData[sym] || { symbol: sym });

    if (STATE.sortCol) {
        items.sort((a, b) => {
            let vA = a[STATE.sortCol], vB = b[STATE.sortCol];
            if (vA == null) return 1; if (vB == null) return -1;
            if (typeof vA === 'string') return STATE.sortAsc ? vA.localeCompare(vB) : vB.localeCompare(vA);
            return STATE.sortAsc ? vA - vB : vB - vA;
        });
    }

    items.forEach(item => tbody.appendChild(createRowElement(item)));
}

function createRowElement(item) {
    const tr = document.createElement('tr');
    tr.id = `row-${item.symbol}`; tr.draggable = true;
    
    const signDay = item.changeDay > 0 ? '+' : '';
    const sign365 = item.change365 > 0 ? '+' : '';

    const fmtMoney = (v) => v == null || isNaN(v) ? '—' : parseFloat(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
    const fmtPct = (v) => v == null || isNaN(v) ? '—' : parseFloat(v).toFixed(2) + '%';
    const getCol = (v) => v == null || isNaN(v) || v == 0 ? 'val-neutral' : v > 0 ? 'val-up' : 'val-down';

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
        <td class="text-center"><button class="btn danger" onclick="removeSymbol('${item.symbol}')">✕</button></td>
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
function handleDragStart(e) { dragSourceEl = this; this.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/html', this.innerHTML); }
function handleDragOver(e) {
    e.preventDefault(); e.dataTransfer.dropEffect = 'move';
    const tbody = document.getElementById('table-body');
    const children = Array.from(tbody.children);
    if (this !== dragSourceEl) {
        const currIdx = children.indexOf(dragSourceEl), targetIdx = children.indexOf(this);
        if (currIdx < targetIdx) tbody.insertBefore(dragSourceEl, this.nextSibling); 
        else tbody.insertBefore(dragSourceEl, this);
    }
}
function handleDrop(e) { e.preventDefault(); }
function handleDragEnd() {
    this.classList.remove('dragging');
    STATE.watchlists[STATE.currentTab] = Array.from(document.getElementById('table-body').children).map(tr => tr.id.replace('row-', ''));
    localStorage.setItem('watchlists', JSON.stringify(STATE.watchlists));
    STATE.sortCol = null; updateSortIcons();
}
function setupDragAndDrop() { document.getElementById('table-body').addEventListener('dragover', e => e.preventDefault()); }
