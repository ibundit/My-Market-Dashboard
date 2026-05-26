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
    tdIndex: {}, // Tracks Twelve Data batching index per tab
    keys: {
        twelvedata: localStorage.getItem('TWELVE_DATA_API_KEY') || '',
        finnhub: localStorage.getItem('FINNHUB_API_KEY') || ''
    }
};

const MAX_CREDITS_PER_MIN = 8; 

const KNOWN_CRYPTOS = ['BTC','ETH','USDT','BNB','SOL','USDC','XRP','ADA','DOGE','SHIB','AVAX','DOT','LINK','TRX','MATIC','LTC','BCH','XLM','NEAR','UNI','ZETA','IO','APT','SUI','RENDER','FET'];

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
        ['TWELVE_DATA_API_KEY', 'FINNHUB_API_KEY'].forEach(key => {
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
        const keyName = (s === 'finnhub' ? 'Finnhub' : 'Twelve Data');
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
    document.getElementById('refresh-btn').addEventListener('click', () => fetchData(true));
    document.getElementById('add-tab-btn').addEventListener('click', addNewTab);
    
    document.getElementById('export-btn').addEventListener('click', exportSyncCode);
    document.getElementById('import-btn').addEventListener('click', importSyncCode);

    document.getElementById('source-select').addEventListener('change', (e) => {
        STATE.apiSource = e.target.value;
        localStorage.setItem('apiSource', STATE.apiSource);
        verifyKeyForCurrentSource();
        renderSkeleton();
        fetchData(true);
    });

    document.getElementById('refresh-select').addEventListener('change', (e) => {
        STATE.refreshInterval = parseInt(e.target.value);
        localStorage.setItem('refreshInterval', STATE.refreshInterval);
        setupAutoRefresh();
    });

    // Reset Sort Checkbox Logic
    document.getElementById('orig-order-cb').addEventListener('change', (e) => {
        if(e.target.checked) {
            STATE.sortCol = null;
            updateSortIcons();
            renderTable();
        }
    });

    document.querySelectorAll('th.sortable').forEach(th => {
        th.addEventListener('click', () => {
            document.getElementById('orig-order-cb').checked = false; // Uncheck original order
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

// --- Sync / Export / Import ---
function exportSyncCode() {
    const data = { watchlists: STATE.watchlists, currentTab: STATE.currentTab };
    const code = btoa(JSON.stringify(data));
    prompt("Copy this Sync Code and paste it on another device:", code);
}

function importSyncCode() {
    const code = prompt("Paste your Sync Code here:");
    if (!code) return;
    try {
        const data = JSON.parse(atob(code));
        if (data && data.watchlists) {
            STATE.watchlists = data.watchlists;
            STATE.currentTab = data.currentTab || Object.keys(data.watchlists)[0];
            localStorage.setItem('watchlists', JSON.stringify(STATE.watchlists));
            localStorage.setItem('currentTab', STATE.currentTab);
            renderTabs();
            renderSkeleton();
            fetchData(true);
            showAlert("Data imported successfully!");
        } else { throw new Error("Invalid format"); }
    } catch(e) {
        showAlert("Failed to import. Invalid Sync Code.");
    }
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
    STATE.sortCol = null; 
    document.getElementById('orig-order-cb').checked = true;
    updateSortIcons();
    renderTabs(); renderSkeleton(); fetchData(true);
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
    renderTabs(); renderSkeleton(); fetchData(true);
}

// --- Utils ---
function setupAutoRefresh() {
    if (STATE.intervalId) clearInterval(STATE.intervalId);
    if (STATE.refreshInterval > 0) STATE.intervalId = setInterval(() => fetchData(false), STATE.refreshInterval * 1000);
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
        renderSkeleton(); fetchData(true);
    }
    inputField.value = '';
}

window.removeSymbol = function(symbol) {
    STATE.watchlists[STATE.currentTab] = STATE.watchlists[STATE.currentTab].filter(s => s !== symbol);
    localStorage.setItem('watchlists', JSON.stringify(STATE.watchlists));
    delete STATE.lastData[symbol];
    renderTable();
};

// --- Logo Engine ---
function getLogoHtml(symbol) {
    const isCrypto = symbol.includes('-') || symbol.includes('/');
    const cleanSym = isCrypto ? symbol.split(/[-/]/)[0].toUpperCase() : symbol.toUpperCase();
    
    let url = '';
    if (isCrypto) {
        url = `https://assets.coincap.io/assets/icons/${cleanSym.toLowerCase()}@2x.png`;
    } else {
        url = `https://logo.clearbit.com/${cleanSym.toLowerCase()}.com`; 
    }
    
    const fallbackUrl = `https://api.dicebear.com/7.x/initials/svg?seed=${cleanSym}&backgroundColor=1e293b&textColor=f8fafc`;
    return `<img src="${url}" class="img-logo" onerror="this.src='${fallbackUrl}'">`;
}

// --- Data Engine ---
async function fetchData(forceResetBatch = false) {
    const currentList = STATE.watchlists[STATE.currentTab] || [];
    if (currentList.length === 0) return updateStatus('yellow', 'Watchlist Empty');

    updateStatus('yellow', 'Fetching...');
    
    const cryptoSymbols = currentList.filter(s => s.includes('-'));
    const stockSymbols = currentList.filter(s => !s.includes('-'));

    try {
        const fetchPromises = [];
        // Binance Bulk Fetch (Extremely fast, 1 call)
        if (cryptoSymbols.length > 0) fetchPromises.push(fetchBinanceBulk(cryptoSymbols));
        
        // Stocks
        if (stockSymbols.length > 0) {
            const currentKey = STATE.keys[STATE.apiSource];
            if (!currentKey) {
                showAlert(`Missing API Key for ${STATE.apiSource.toUpperCase()}`);
            } else {
                if (STATE.apiSource === 'twelvedata') {
                    // Twelve Data Batching Logic
                    if (STATE.tdIndex[STATE.currentTab] === undefined || forceResetBatch) {
                        STATE.tdIndex[STATE.currentTab] = 0;
                    }
                    let idx = STATE.tdIndex[STATE.currentTab];
                    let batch = stockSymbols.slice(idx, idx + 8);
                    
                    // Wrap around if we hit the end
                    if (batch.length < 8 && stockSymbols.length > 8) {
                        batch = batch.concat(stockSymbols.slice(0, 8 - batch.length));
                    }
                    
                    // Advance index
                    STATE.tdIndex[STATE.currentTab] = (idx + 8) % stockSymbols.length;
                    fetchPromises.push(fetchTwelveData(currentKey, batch));
                    
                } else if (STATE.apiSource === 'finnhub') {
                    // Finnhub Concurrent Fetch
                    fetchPromises.push(fetchFinnhubConcurrent(currentKey, stockSymbols));
                }
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

// 1. Binance Bulk Fetcher (Ultra Fast)
async function fetchBinanceBulk(cryptoList) {
    try {
        // Bulk API for 24h ticker returns ALL coins instantly
        const res = await fetch(`https://api.binance.com/api/v3/ticker/24hr`);
        if(!res.ok) return;
        const allTickers = await res.json();
        
        // Map data to local state
        cryptoList.forEach(sym => {
            const token = sym.split('-')[0].toUpperCase();
            const pair = token + 'USDT';
            const data = allTickers.find(t => t.symbol === pair);
            
            if (data) {
                // Initialize basic 24h data immediately
                if (!STATE.lastData[sym]) STATE.lastData[sym] = {};
                STATE.lastData[sym].symbol = sym;
                STATE.lastData[sym].price = parseFloat(data.lastPrice);
                STATE.lastData[sym].changeDay = parseFloat(data.priceChange);
                STATE.lastData[sym].changePct = parseFloat(data.priceChangePercent);
                
                // Fetch 52w klines asynchronously in background to not block UI
                fetchBinanceHistorical(sym, pair);
            }
        });
    } catch(e) { console.error(`Binance bulk failed`, e); }
}

// Background Historical Fetch for Binance
async function fetchBinanceHistorical(sym, pair) {
    try {
        const kRes = await fetch(`https://api.binance.com/api/v3/klines?symbol=${pair}&interval=1w&limit=52`);
        if(kRes.ok) {
            const kData = await kRes.json();
            if(kData && kData.length > 0) {
                let high52 = -Infinity;
                let low52 = Infinity;
                kData.forEach(candle => {
                    let h = parseFloat(candle[2]);
                    let l = parseFloat(candle[3]);
                    if(h > high52) high52 = h;
                    if(l < low52) low52 = l;
                });
                
                let price1Y = parseFloat(kData[0][4]); // Close price 52 weeks ago
                let currPrice = STATE.lastData[sym].price;
                let c365 = currPrice - price1Y;
                let r1Y = (c365 / price1Y) * 100;

                STATE.lastData[sym].high52 = high52;
                STATE.lastData[sym].low52 = low52;
                STATE.lastData[sym].change365 = c365;
                STATE.lastData[sym].return1Y = r1Y;
                renderTable(); // Re-render to show background data when ready
            }
        }
    } catch(e){}
}

// 2. Finnhub Concurrent Fetcher (Fast)
async function fetchFinnhubConcurrent(key, stockList) {
    // Run all fetches concurrently to speed up 47+ stocks
    const promises = stockList.map(async (sym) => {
        try {
            const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${sym}&token=${key}`);
            const q = await res.json();
            if (q.c) {
                STATE.lastData[sym] = {
                    symbol: sym,
                    price: q.c,
                    changeDay: q.d,
                    changePct: q.dp,
                    change365: null, return1Y: null,
                    high52: q.h, low52: q.l
                };
            }
        } catch(e) {}
    });
    await Promise.all(promises);
}

// 3. Twelve Data Batch Fetcher (Respects Limit)
async function fetchTwelveData(key, batchList) {
    if (batchList.length === 0) return;
    const formatted = batchList.join(',');
    const res = await fetch(`https://api.twelvedata.com/quote?symbol=${formatted}&apikey=${key}`);
    const data = await res.json();
    if (data.status === 'error') throw new Error(data.message);

    let norm = {};
    if (batchList.length === 1) norm[data.symbol] = data;
    else for (const k in data) norm[k] = data[k];

    for (const sym of batchList) {
        const q = norm[sym];
        if (!q || q.status === 'error') continue;
        
        // Preserve existing historical data if any
        let c365 = null, r1Y = null, h52 = null, l52 = null;
        if (STATE.lastData[sym]) {
             c365 = STATE.lastData[sym].change365;
             r1Y = STATE.lastData[sym].return1Y;
        }

        STATE.lastData[sym] = {
            symbol: sym,
            price: parseFloat(q.close),
            changeDay: parseFloat(q.change),
            changePct: parseFloat(q.percent_change),
            change365: c365, return1Y: r1Y,
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

    const origOrderCb = document.getElementById('orig-order-cb');
    if (origOrderCb.checked || !STATE.sortCol) {
        // Original Add Order (which matches currentList array)
        // No sort needed, already in order
    } else {
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
        <td class="drag-handle" title="Drag to reorder">☰</td>
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
function handleDragStart(e) { 
    dragSourceEl = this; 
    this.classList.add('dragging'); 
    e.dataTransfer.effectAllowed = 'move'; 
    e.dataTransfer.setData('text/html', this.innerHTML); 
}
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
    
    // Auto-check original order box since drag defines the new custom "original" order
    document.getElementById('orig-order-cb').checked = true;
    STATE.sortCol = null; 
    updateSortIcons();
    renderTable();
}
function setupDragAndDrop() { document.getElementById('table-body').addEventListener('dragover', e => e.preventDefault()); }
