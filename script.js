// Application State - Version 15 
// (Instant Tab Switching + Yahoo Finance Quote Bulk Fetch + CoinGecko Fallback)
const STATE = {
    watchlists: {}, 
    currentTab: '',
    refreshInterval: parseInt(localStorage.getItem('refreshInterval')) || 0,
    apiSource: localStorage.getItem('apiSource') || 'yahoofinance',
    intervalId: null,
    lastData: {}, // GLOBAL CACHE for instant tab switching
    sortCol: null,
    sortAsc: true,
    keys: {
        finnhub: localStorage.getItem('FINNHUB_API_KEY') || ''
    }
};

const KNOWN_CRYPTOS = ['BTC','ETH','USDT','BNB','SOL','USDC','XRP','ADA','DOGE','SHIB','AVAX','DOT','LINK','TRX','MATIC','LTC','BCH','XLM','NEAR','UNI','ZETA','IO','APT','SUI','RENDER','FET','BNSOL','TON','TAO','LINEA','L3'];

// Proxy Rotation
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
    fetchDataAllTabs(true); // Fetch all symbols across all tabs at startup
});

function initDataMigrate() {
    let savedLists = JSON.parse(localStorage.getItem('watchlists'));
    if (!savedLists) {
        let oldSingleList = JSON.parse(localStorage.getItem('watchlist')) || ['NVDA', 'AAPL', 'BTC-USD', 'L3-USD'];
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
        const key = prompt(`Enter Finnhub API Key:`);
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

// --- Tabs Management (Zero Latency Switch) ---
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

// INSTANT TAB SWITCH: Just re-render table from STATE.lastData
function switchTab(tabName) {
    if (STATE.currentTab === tabName) return;
    STATE.currentTab = tabName; 
    localStorage.setItem('currentTab', tabName);
    STATE.sortCol = null; 
    document.getElementById('orig-order-cb').checked = true;
    updateSortIcons(); 
    renderTabs(); 
    renderTable(); // <--- Renders instantly from cache, no network fetch here
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


// --- GLOBAL FETCH: Fetch all symbols across all tabs concurrently ---
async function fetchDataAllTabs(showStatusLoader = false) {
    // Get unique symbols across all tabs
    const allSymbols = new Set();
    Object.values(STATE.watchlists).forEach(list => list.forEach(sym => allSymbols.add(sym)));
    
    const uniqueSymbols = Array.from(allSymbols);
    if (uniqueSymbols.length === 0) return updateStatus('yellow', 'Watchlist Empty');

    if(showStatusLoader) updateStatus('yellow', 'Fetching...');
    
    const cryptos = uniqueSymbols.filter(s => s.includes('-'));
    const stocks = uniqueSymbols.filter(s => !s.includes('-'));

    try {
        const promises = [];
        if (cryptos.length > 0) promises.push(fetchCryptoEngine(cryptos));
        if (stocks.length > 0) {
            if (STATE.apiSource === 'finnhub') {
                promises.push(fetchFinnhubConcurrent(STATE.keys.finnhub, stocks));
            } else {
                promises.push(fetchYahooQuoteBulk(stocks));
            }
        }
        
        await Promise.all(promises);
        
        document.getElementById('last-updated-time').textContent = new Date().toLocaleTimeString();
        updateStatus('green', 'Connected');
        renderTable();
    } catch (err) {
        updateStatus('red', 'Fetch Error');
        showAlert(`Error: ${err.message}. Showing last data.`);
        renderTable();
    }
}

// --- 1. YAHOO FINANCE BULK QUOTE FETCH (HIGH PERFORMANCE & CORRECT CHANGE) ---
async function fetchYahooQuoteBulk(stockList) {
    // Fetch in chunks of 50 to avoid URL length limits
    const chunkSize = 50;
    for (let i = 0; i < stockList.length; i += chunkSize) {
        const chunk = stockList.slice(i, i + chunkSize);
        const symbols = chunk.join(',');
        
        // Use v7/finance/quote endpoint for extremely fast & accurate daily changes
        const targetUrl = encodeURIComponent(`https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbols}`);
        
        let success = false;
        let attempts = 0;
        
        while (!success && attempts < PROXIES.length) {
            const proxyUrl = PROXIES[proxyIndex];
            try {
                const res = await fetch(proxyUrl + targetUrl, { cache: 'no-store' });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                
                let data = await res.json();
                if (proxyUrl.includes('allorigins') && data.contents) data = JSON.parse(data.contents);
                
                if (data && data.quoteResponse && data.quoteResponse.result) {
                    data.quoteResponse.result.forEach(q => {
                        const sym = q.symbol;
                        
                        // Exact calculation based on previous close
                        const currentPrice = q.regularMarketPrice;
                        const prevClose = q.regularMarketPreviousClose;
                        
                        const changeDay = currentPrice - prevClose;
                        const changePct = prevClose ? (changeDay / prevClose) * 100 : 0;
                        
                        // Merge with existing state (to preserve 365D/1Y Return if already fetched)
                        STATE.lastData[sym] = {
                            ...STATE.lastData[sym],
                            symbol: sym,
                            price: currentPrice,
                            changeDay: changeDay,         // ACCURATE
                            changePct: changePct,         // ACCURATE
                            high52: q.fiftyTwoWeekHigh,
                            low52: q.fiftyTwoWeekLow
                        };
                    });
                    success = true;
                    // Trigger silent background fetch for 1 Year return data
                    fetchYahooHistoricalQuietly(chunk);
                } else {
                    throw new Error("Invalid format");
                }
            } catch (e) {
                proxyIndex = (proxyIndex + 1) % PROXIES.length;
                attempts++;
            }
        }
    }
}

// Background Historical Fetch for 1Y Return (so it doesn't slow down the main load)
async function fetchYahooHistoricalQuietly(chunk) {
    const symbols = chunk.join(',');
    const targetUrl = encodeURIComponent(`https://query1.finance.yahoo.com/v7/finance/spark?symbols=${symbols}&range=1y&interval=1d`);
    const proxyUrl = PROXIES[proxyIndex];
    
    try {
        const res = await fetch(proxyUrl + targetUrl);
        let data = await res.json();
        if (proxyUrl.includes('allorigins') && data.contents) data = JSON.parse(data.contents);
        
        if(data && data.spark && data.spark.result) {
            data.spark.result.forEach(item => {
                const sym = item.symbol;
                if(!item.response || !item.response[0] || !item.response[0].indicators) return;
                
                const closePrices = item.response[0].indicators.quote[0].close;
                if(!closePrices || closePrices.length === 0) return;
                
                const validPrices = closePrices.filter(p => p !== null);
                if(validPrices.length === 0) return;
                
                const price1Y = validPrices[0]; 
                const currentPrice = STATE.lastData[sym]?.price;
                if (currentPrice) {
                    const change365 = currentPrice - price1Y;
                    const return1Y = price1Y ? (change365 / price1Y) * 100 : 0;
                    
                    STATE.lastData[sym].change365 = change365;
                    STATE.lastData[sym].return1Y = return1Y;
                }
            });
            // Re-render silently to show the background data
            renderTable();
        }
    } catch (e) {}
}


// --- 2. CRYPTO ENGINE (BINANCE + COINGECKO FALLBACK) ---
async function fetchCryptoEngine(cryptos) {
    // 1. Try Binance Bulk first
    let binanceTickers = [];
    try {
        const res = await fetch(`https://api.binance.com/api/v3/ticker/24hr`);
        if(res.ok) binanceTickers = await res.json();
    } catch(e) { console.error("Binance down", e); }

    for(const sym of cryptos) {
        const token = sym.split('-')[0].toUpperCase();
        
        // Match multiple base pairs (solves BNSOL, etc. if listed on Binance)
        const bMatch = binanceTickers.find(t => t.symbol === token + 'USDT') ||
                       binanceTickers.find(t => t.symbol === token + 'USDC') ||
                       binanceTickers.find(t => t.symbol === token + 'FDUSD') ||
                       binanceTickers.find(t => t.symbol === token + 'BTC') ||
                       binanceTickers.find(t => t.symbol === token + 'BNB');

        if(bMatch) {
            STATE.lastData[sym] = {
                ...STATE.lastData[sym],
                symbol: sym,
                price: parseFloat(bMatch.lastPrice),
                changeDay: parseFloat(bMatch.priceChange),
                changePct: parseFloat(bMatch.priceChangePercent)
            };
            fetchBinanceHistoricalQuietly(sym, bMatch.symbol);
        } else {
            // 2. Fallback to CoinGecko (Solves L3, LINEA, etc.)
            await fetchCoinGeckoFallback(sym, token);
        }
    }
}

async function fetchBinanceHistoricalQuietly(sym, pair) {
    try {
        const kRes = await fetch(`https://api.binance.com/api/v3/klines?symbol=${pair}&interval=1w&limit=52`);
        if(kRes.ok) {
            const kData = await kRes.json();
            if(kData && kData.length > 0) {
                let high52 = -Infinity, low52 = Infinity;
                kData.forEach(candle => {
                    let h = parseFloat(candle[2]), l = parseFloat(candle[3]);
                    if(h > high52) high52 = h; if(l < low52) low52 = l;
                });
                let price1Y = parseFloat(kData[0][4]); 
                let currPrice = STATE.lastData[sym].price;
                STATE.lastData[sym].high52 = high52;
                STATE.lastData[sym].low52 = low52;
                STATE.lastData[sym].change365 = currPrice - price1Y;
                STATE.lastData[sym].return1Y = price1Y ? ((currPrice - price1Y) / price1Y) * 100 : 0;
                renderTable(); 
            }
        }
    } catch(e){}
}

// CoinGecko API Fallback for non-Binance coins (Free, No Auth required for basic endpoints)
async function fetchCoinGeckoFallback(sym, token) {
    try {
        // Smart mapping for common complex tokens
        const knownIds = {
            'L3': 'layer3',
            'LINEA': 'linea',
            'BNSOL': 'binance-staked-sol'
        };
        
        let cgId = knownIds[token.toUpperCase()] || token.toLowerCase();

        // If not in known list, use CoinGecko search API to find the correct ID
        if (!knownIds[token.toUpperCase()]) {
            const searchRes = await fetch(`https://api.coingecko.com/api/v3/search?query=${token}`);
            if(searchRes.ok) {
                const searchData = await searchRes.json();
                if(searchData.coins && searchData.coins.length > 0) {
                    // Get the exact match or first result
                    const exactMatch = searchData.coins.find(c => c.symbol.toUpperCase() === token.toUpperCase());
                    cgId = exactMatch ? exactMatch.id : searchData.coins[0].id;
                }
            }
        }

        // Fetch price & 24h change
        const priceRes = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${cgId}&vs_currencies=usd&include_24hr_change=true`);
        if(priceRes.ok) {
            const priceData = await priceRes.json();
            if(priceData[cgId]) {
                const price = priceData[cgId].usd;
                const changePct = priceData[cgId].usd_24h_change || 0;
                // Calculate absolute change based on percentage
                const changeDay = price - (price / (1 + (changePct / 100)));

                STATE.lastData[sym] = {
                    ...STATE.lastData[sym], // Keep historical data if already fetched
                    symbol: sym,
                    price: price,
                    changeDay: changeDay,
                    changePct: changePct
                };
                renderTable();
            }
        }
    } catch(e) { console.error(`CoinGecko fallback failed for ${token}`, e); }
}

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

// --- RENDER TABLE ---
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

function exportSyncCode() {
    const data = { watchlists: STATE.watchlists, currentTab: STATE.currentTab };
    prompt("Copy this Sync Code:", btoa(JSON.stringify(data)));
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
        }
    } catch(e) { showAlert("Failed to import Sync Code."); }
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
