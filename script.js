// Application State - Version 13 (Optimized State Render + Yahoo Finance Bulk Fix + Multi-API Fallback)
const STATE = {
    watchlists: {}, 
    currentTab: '',
    refreshInterval: parseInt(localStorage.getItem('refreshInterval')) || 0,
    apiSource: localStorage.getItem('apiSource') || 'yahoofinance',
    intervalId: null,
    lastData: {}, // Holds data for ALL symbols globally
    sortCol: null,
    sortAsc: true,
    keys: {
        finnhub: localStorage.getItem('FINNHUB_API_KEY') || ''
    }
};

const KNOWN_CRYPTOS = ['BTC','ETH','USDT','BNB','SOL','USDC','XRP','ADA','DOGE','SHIB','AVAX','DOT','LINK','TRX','MATIC','LTC','BCH','XLM','NEAR','UNI','ZETA','IO','APT','SUI','RENDER','FET','BNSOL','TON','TAO','LINEA','L3'];

// Proxies for Yahoo API Rotation (from v9)
const PROXIES = [
    'https://api.allorigins.win/raw?url=',
    'https://corsproxy.io/?url=',
    'https://api.codetabs.com/v1/proxy?quest='
];
let proxyIndex = 0;

document.addEventListener('DOMContentLoaded', () => {
    initDataMigrate();
    initApiKeys();
    initUI();
    // Pre-load background fetch for ALL items across ALL tabs for seamless instant render
    fetchDataAllTabs(true);
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
        ['FINNHUB_API_KEY'].forEach(key => {
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
    if (s === 'finnhub' && !STATE.keys[s]) {
        const key = prompt(`Enter Finnhub API Key (Required for Stocks via Finnhub):`);
        if (key) { 
            STATE.keys[s] = key; 
            localStorage.setItem(`FINNHUB_API_KEY`, key); 
        }
    }
}

function initUI() {
    document.getElementById('refresh-select').value = STATE.refreshInterval;
    document.getElementById('source-select').value = STATE.apiSource;
    
    document.getElementById('add-btn').addEventListener('click', addSymbols);
    document.getElementById('symbol-input').addEventListener('keypress', (e) => { if (e.key === 'Enter') addSymbols(); });
    document.getElementById('refresh-btn').addEventListener('click', () => fetchDataAllTabs(true));
    document.getElementById('add-tab-btn').addEventListener('click', addNewTab);
    
    document.getElementById('export-btn').addEventListener('click', exportSyncCode);
    document.getElementById('import-btn').addEventListener('click', importSyncCode);

    document.getElementById('source-select').addEventListener('change', (e) => {
        STATE.apiSource = e.target.value;
        localStorage.setItem('apiSource', STATE.apiSource);
        verifyKeyForCurrentSource();
        renderSkeleton();
        fetchDataAllTabs(true);
    });

    document.getElementById('refresh-select').addEventListener('change', (e) => {
        STATE.refreshInterval = parseInt(e.target.value);
        localStorage.setItem('refreshInterval', STATE.refreshInterval);
        setupAutoRefresh();
    });

    document.getElementById('orig-order-cb').addEventListener('change', (e) => {
        if(e.target.checked) {
            STATE.sortCol = null;
            updateSortIcons();
            renderTable();
        }
    });

    document.querySelectorAll('th.sortable').forEach(th => {
        th.addEventListener('click', () => {
            document.getElementById('orig-order-cb').checked = false; 
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
}

// --- Sync ---
function exportSyncCode() {
    const data = { watchlists: STATE.watchlists, currentTab: STATE.currentTab };
    const code = btoa(JSON.stringify(data));
    prompt("Copy this Sync Code:", code);
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
            renderTabs(); renderSkeleton(); fetchDataAllTabs(true);
            showAlert("Data imported successfully!");
        } else { throw new Error("Invalid format"); }
    } catch(e) { showAlert("Failed to import. Invalid Sync Code."); }
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

// SOLVED: Changing tabs renders INSTANTLY (0 seconds) without flashing "Fetching..." or re-loading network data
function switchTab(tabName) {
    if (STATE.currentTab === tabName) return;
    STATE.currentTab = tabName; 
    localStorage.setItem('currentTab', tabName);
    STATE.sortCol = null; 
    document.getElementById('orig-order-cb').checked = true;
    updateSortIcons(); 
    renderTabs(); 
    renderTable(); // Instant presentation from existing memory cache
}

function addNewTab() {
    const name = prompt("Tab Name:");
    if (!name || !name.trim()) return;
    if (STATE.watchlists[name.trim()]) return showAlert("Exists.");
    STATE.watchlists[name.trim()] = []; localStorage.setItem('watchlists', JSON.stringify(STATE.watchlists)); switchTab(name.trim());
}
function renameTab(oldName) {
    const newName = prompt("New Name:", oldName);
    if (!newName || !newName.trim() || newName.trim() === oldName) return;
    if (STATE.watchlists[newName.trim()]) return showAlert("Exists.");
    STATE.watchlists[newName.trim()] = STATE.watchlists[oldName]; delete STATE.watchlists[oldName];
    if (STATE.currentTab === oldName) { STATE.currentTab = newName.trim(); localStorage.setItem('currentTab', newName.trim()); }
    localStorage.setItem('watchlists', JSON.stringify(STATE.watchlists)); renderTabs();
}
function deleteTab(tabName) {
    if (!confirm(`Delete '${tabName}'?`)) return;
    delete STATE.watchlists[tabName];
    if (STATE.currentTab === tabName) { STATE.currentTab = Object.keys(STATE.watchlists)[0]; localStorage.setItem('currentTab', STATE.currentTab); }
    localStorage.setItem('watchlists', JSON.stringify(STATE.watchlists)); renderTabs(); renderTable();
}

// --- Utils ---
function setupAutoRefresh() {
    if (STATE.intervalId) clearInterval(STATE.intervalId);
    if (STATE.refreshInterval > 0) STATE.intervalId = setInterval(() => fetchDataAllTabs(false), STATE.refreshInterval * 1000);
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
    if (addedCount > 0) { localStorage.setItem('watchlists', JSON.stringify(STATE.watchlists)); renderSkeleton(); fetchDataAllTabs(true); }
    inputField.value = '';
}
window.removeSymbol = function(symbol) {
    STATE.watchlists[STATE.currentTab] = STATE.watchlists[STATE.currentTab].filter(s => s !== symbol);
    localStorage.setItem('watchlists', JSON.stringify(STATE.watchlists));
    delete STATE.lastData[symbol]; renderTable();
};

function getLogoHtml(symbol) {
    const isCrypto = symbol.includes('-') || symbol.includes('/');
    const cleanSym = isCrypto ? symbol.split(/[-/]/)[0].toUpperCase() : symbol.toUpperCase();
    let url = isCrypto 
        ? `https://assets.coincap.io/assets/icons/${cleanSym.toLowerCase()}@2x.png`
        : `https://financialmodelingprep.com/image-stock/${cleanSym}.png`;
    const fallbackUrl = `https://api.dicebear.com/7.x/initials/svg?seed=${cleanSym}&backgroundColor=1e293b&textColor=f8fafc`;
    return `<img src="${url}" class="img-logo" onerror="this.src='${fallbackUrl}'">`;
}

// Fetch globally for ALL unique assets across all tabs in one consolidated pass
async function fetchDataAllTabs(showStatusLoader = false) {
    // Extract unique symbols from all lists combined
    const allUniqueSymbols = new Set();
    Object.values(STATE.watchlists).forEach(list => {
        list.forEach(sym => allUniqueSymbols.add(sym));
    });
    
    const uniqueSymbolsArray = Array.from(allUniqueSymbols);
    if (uniqueSymbolsArray.length === 0) {
        renderTable();
        return updateStatus('yellow', 'Watchlists Empty');
    }

    if (showStatusLoader) updateStatus('yellow', 'Fetching Background Market Data...');
    
    const cryptoSymbols = uniqueSymbolsArray.filter(s => s.includes('-'));
    const stockSymbols = uniqueSymbolsArray.filter(s => !s.includes('-'));

    try {
        const fetchPromises = [];
        
        if (cryptoSymbols.length > 0) {
            fetchPromises.push(fetchBinanceBulk(cryptoSymbols));
        }
        
        if (stockSymbols.length > 0) {
            if (STATE.apiSource === 'finnhub') {
                const key = STATE.keys.finnhub;
                if (!key) showAlert(`Missing API Key for FINNHUB`);
                else fetchPromises.push(fetchFinnhubConcurrent(key, stockSymbols));
            } else if (STATE.apiSource === 'yahoofinance') {
                // HIGH PERFORMANCE BULK FETCH V9
                fetchPromises.push(fetchYahooFinanceSparkBulk(stockSymbols));
            }
        }
        
        await Promise.all(fetchPromises);
        document.getElementById('last-updated-time').textContent = new Date().toLocaleTimeString();
        updateStatus('green', 'Connected');
        renderTable(); // Draw current active tab view immediately
    } catch (err) {
        updateStatus('red', 'Fetch Error');
        console.error(err);
        renderTable();
    }
}

// 1. Yahoo Finance Spark BULK Fetcher (Optimized for ultra performance and precise Change/Change% columns)
async function fetchYahooFinanceSparkBulk(stockList) {
    if (stockList.length === 0) return;
    
    // Package symbols into single comma-delimited list to hit the endpoint in ONE single fast batch
    const symbolsJoined = stockList.join(',');
    const targetUrl = encodeURIComponent(`https://query1.finance.yahoo.com/v7/finance/spark?symbols=${symbolsJoined}&range=1y&interval=1d`);
    
    let success = false;
    let attempts = 0;
    
    while (!success && attempts < PROXIES.length) {
        const proxyUrl = PROXIES[proxyIndex];
        try {
            const res = await fetch(proxyUrl + targetUrl, { cache: 'no-store' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            
            let data = await res.json();
            if (proxyUrl.includes('allorigins') && data.contents) {
                data = JSON.parse(data.contents);
            }
            
            if (data && data.spark && data.spark.result) {
                data.spark.result.forEach(item => {
                    const sym = item.symbol;
                    if (!item.response || !item.response[0]) return;
                    
                    const responseObj = item.response[0];
                    const meta = responseObj.meta;
                    
                    // FIXED: Pull accurate daily changes directly derived from Yahoo's current calculation versus real-time market close definitions
                    const currentPrice = meta.regularMarketPrice;
                    const changeDay = meta.regularMarketChange !== undefined ? meta.regularMarketChange : (currentPrice - (meta.previousClose || meta.chartPreviousClose || currentPrice));
                    const changePct = meta.regularMarketChangePercent !== undefined ? meta.regularMarketChangePercent : (meta.previousClose ? (changeDay / meta.previousClose) * 100 : 0);
                    
                    // Extract historical prices safely
                    let high52 = currentPrice;
                    let low52 = currentPrice;
                    let change365 = null;
                    let return1Y = null;
                    
                    if (responseObj.indicators && responseObj.indicators.quote && responseObj.indicators.quote[0]) {
                        const closePrices = responseObj.indicators.quote[0].close;
                        if (closePrices && closePrices.length > 0) {
                            const validPrices = closePrices.filter(p => p !== null && p !== undefined);
                            if (validPrices.length > 0) {
                                high52 = Math.max(...validPrices, currentPrice);
                                low52 = Math.min(...validPrices, currentPrice);
                                
                                const price1Y = validPrices[0];
                                change365 = currentPrice - price1Y;
                                return1Y = price1Y ? (change365 / price1Y) * 100 : 0;
                            }
                        }
                    }
                    
                    STATE.lastData[sym] = {
                        symbol: sym,
                        price: currentPrice,
                        changeDay: changeDay,
                        changePct: changePct,
                        change365: change365,
                        return1Y: return1Y,
                        high52: high52,
                        low52: low52
                    };
                });
                success = true;
            } else {
                throw new Error("Invalid structure returned");
            }
        } catch (e) {
            console.warn(`Proxy index ${proxyIndex} failed, shifting to alternative proxy...`);
            proxyIndex = (proxyIndex + 1) % PROXIES.length;
            attempts++;
        }
    }
}

// 2. Binance API - Enhanced Pairs Matching (USDT -> USDC -> FDUSD -> BTC -> BNB) + Free Multi-API Fallback for BNSOL, LINEA, L3
async function fetchBinanceBulk(cryptoList) {
    try {
        const res = await fetch(`https://api.binance.com/api/v3/ticker/24hr`);
        if (!res.ok) return;
        const allTickers = await res.json();
        
        for (const sym of cryptoList) {
            const token = sym.split('-')[0].toUpperCase();
            
            // Comprehensive pair checking mechanism to capture newer or special tokens like BNSOL, LINEA, etc.
            const data = allTickers.find(t => t.symbol === token + 'USDT') ||
                         allTickers.find(t => t.symbol === token + 'USDC') ||
                         allTickers.find(t => t.symbol === token + 'FDUSD') ||
                         allTickers.find(t => t.symbol === token + 'TRY') ||
                         allTickers.find(t => t.symbol === token + 'BTC') ||
                         allTickers.find(t => t.symbol === token + 'BNB');
            
            if (data) {
                // Found on Binance
                if (!STATE.lastData[sym]) STATE.lastData[sym] = {};
                STATE.lastData[sym].symbol = sym;
                STATE.lastData[sym].price = parseFloat(data.lastPrice);
                STATE.lastData[sym].changeDay = parseFloat(data.priceChange);
                STATE.lastData[sym].changePct = parseFloat(data.priceChangePercent);
                
                fetchBinanceHistorical(sym, data.symbol);
            } else {
                // FALLBACK MECHANISM: If completely missing on Binance (e.g. L3 or specific custom variants), route through public CoinCap asset indexing
                await fetchCoinCapFallback(sym, token);
            }
        }
    } catch(e) { 
        console.error(`Binance bulk system processing exception`, e); 
    }
}

async function fetchBinanceHistorical(sym, pair) {
    try {
        const kRes = await fetch(`https://api.binance.com/api/v3/klines?symbol=${pair}&interval=1w&limit=52`);
        if (kRes.ok) {
            const kData = await kRes.json();
            if (kData && kData.length > 0) {
                let high52 = -Infinity;
                let low52 = Infinity;
                kData.forEach(candle => {
                    let h = parseFloat(candle[2]), l = parseFloat(candle[3]);
                    if(h > high52) high52 = h; if(l < low52) low52 = l;
                });
                
                let price1Y = parseFloat(kData[0][4]); 
                let currPrice = STATE.lastData[sym].price;
                let c365 = currPrice - price1Y;
                let r1Y = (c365 / price1Y) * 100;

                STATE.lastData[sym].high52 = high52;
                STATE.lastData[sym].low52 = low52;
                STATE.lastData[sym].change365 = c365;
                STATE.lastData[sym].return1Y = r1Y;
                renderTable(); 
            }
        }
    } catch(e){}
}

// 3. Fallback Multi-API Processing Engine (CoinCap Assets Routing + Automated Native 52W Math Arrays)
async function fetchCoinCapFallback(sym, token) {
    try {
        // Find accurate internal crypto slug (e.g. "layer3", "linea")
        const searchRes = await fetch(`https://api.coincap.io/v2/assets?search=${token}&limit=1`);
        if (!searchRes.ok) return;
        const searchJson = await searchRes.json();
        
        if (searchJson.data && searchJson.data.length > 0) {
            const coinData = searchJson.data[0];
            const coinId = coinData.id;
            
            if (!STATE.lastData[sym]) STATE.lastData[sym] = {};
            
            const currentPrice = parseFloat(coinData.priceUsd);
            const changePct = parseFloat(coinData.changePercent24Hr);
            
            STATE.lastData[sym].symbol = sym;
            STATE.lastData[sym].price = currentPrice;
            STATE.lastData[sym].changePct = changePct;
            STATE.lastData[sym].changeDay = currentPrice - (currentPrice / (1 + (changePct/100)));

            // Request 1-Year chronological intervals to parse historical milestones manually inside JavaScript execution context
            const now = Date.now();
            const oneYearAgo = now - (365 * 24 * 60 * 60 * 1000);
            
            try {
                const histRes = await fetch(`https://api.coincap.io/v2/assets/${coinId}/history?interval=d1&start=${oneYearAgo}&end=${now}`);
                if (histRes.ok) {
                    const histJson = await histRes.json();
                    const historyData = histJson.data;
                    
                    if (historyData && historyData.length > 0) {
                        const validPrices = historyData.map(item => parseFloat(item.priceUsd));
                        
                        const high52 = Math.max(...validPrices, currentPrice);
                        const low52 = Math.min(...validPrices, currentPrice);
                        
                        const price1Y = validPrices[0];
                        const change365 = currentPrice - price1Y;
                        const return1Y = price1Y ? (change365 / price1Y) * 100 : 0;
                        
                        STATE.lastData[sym].high52 = high52;
                        STATE.lastData[sym].low52 = low52;
                        STATE.lastData[sym].change365 = change365;
                        STATE.lastData[sym].return1Y = return1Y;
                    }
                }
            } catch(hErr) { 
                console.error(`Historical matrix mapping failure for context ${coinId}`, hErr); 
            }
            renderTable();
        }
    } catch(e) { 
        console.error(`CoinCap Fallback exception handling array map for ${token}`, e); 
    }
}

// 4. Finnhub Fallback Processor
async function fetchFinnhubConcurrent(key, stockList) {
    const promises = stockList.map(async (sym) => {
        try {
            const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${sym}&token=${key}`);
            const q = await res.json();
            if (q.c) {
                STATE.lastData[sym] = {
                    symbol: sym, price: q.c, changeDay: q.d, changePct: q.dp,
                    change365: null, return1Y: null, high52: q.h, low52: q.l
                };
            }
        } catch(e) {}
    });
    await Promise.all(promises);
}

function renderTable() {
    const tbody = document.getElementById('table-body');
    tbody.innerHTML = '';
    const currentList = STATE.watchlists[STATE.currentTab] || [];
    if (currentList.length === 0) { tbody.innerHTML = '<tr><td colspan="11" class="text-center">Watchlist empty</td></tr>'; return; }

    let items = currentList.map(sym => STATE.lastData[sym] || { symbol: sym });
    const origOrderCb = document.getElementById('orig-order-cb');
    
    if (!origOrderCb.checked && STATE.sortCol) {
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
    document.getElementById('orig-order-cb').checked = true; STATE.sortCol = null; 
    updateSortIcons(); renderTable();
}
function setupDragAndDrop() { document.getElementById('table-body').addEventListener('dragover', e => e.preventDefault()); }
