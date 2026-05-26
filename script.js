// Application State - Version 12 (Reverted to V9 Spark Endpoint + Performance/Accuracy Upgrades)
const STATE = {
    watchlists: {}, 
    currentTab: '',
    refreshInterval: parseInt(localStorage.getItem('refreshInterval')) || 0,
    apiSource: localStorage.getItem('apiSource') || 'yahoofinance',
    intervalId: null,
    lastData: {}, 
    sortCol: null,
    sortAsc: true,
    keys: {
        finnhub: localStorage.getItem('FINNHUB_API_KEY') || ''
    }
};

const KNOWN_CRYPTOS = ['BTC','ETH','USDT','BNB','SOL','USDC','XRP','ADA','DOGE','SHIB','AVAX','DOT','LINK','TRX','MATIC','LTC','BCH','XLM','NEAR','UNI','ZETA','IO','APT','SUI','RENDER','FET','BNSOL','TON','TAO'];

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
    renderSkeleton();
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
            renderTabs(); renderSkeleton(); fetchData(true);
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
function switchTab(tabName) {
    if (STATE.currentTab === tabName) return;
    STATE.currentTab = tabName; localStorage.setItem('currentTab', tabName);
    STATE.sortCol = null; document.getElementById('orig-order-cb').checked = true;
    updateSortIcons(); renderTabs(); renderSkeleton(); fetchData(true);
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
    localStorage.setItem('watchlists', JSON.stringify(STATE.watchlists)); renderTabs(); renderSkeleton(); fetchData(true);
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
    if (addedCount > 0) { localStorage.setItem('watchlists', JSON.stringify(STATE.watchlists)); renderSkeleton(); fetchData(true); }
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

async function fetchData(force = false) {
    const currentList = STATE.watchlists[STATE.currentTab] || [];
    if (currentList.length === 0) return updateStatus('yellow', 'Watchlist Empty');

    updateStatus('yellow', 'Fetching...');
    
    const cryptoSymbols = currentList.filter(s => s.includes('-'));
    const stockSymbols = currentList.filter(s => !s.includes('-'));

    try {
        const fetchPromises = [];
        
        if (cryptoSymbols.length > 0) fetchPromises.push(fetchBinanceBulk(cryptoSymbols));
        
        if (stockSymbols.length > 0) {
            if (STATE.apiSource === 'finnhub') {
                const key = STATE.keys.finnhub;
                if (!key) showAlert(`Missing API Key for FINNHUB`);
                else fetchPromises.push(fetchFinnhubConcurrent(key, stockSymbols));
            } else if (STATE.apiSource === 'yahoofinance') {
                // Reverted to v9 logic (Spark API) but optimized concurrently
                fetchPromises.push(fetchYahooFinanceSparkAPI(stockSymbols));
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

// 1. Binance Bulk Fetcher (Smart Pair Matching from v10/v11 - Keeps working for BNSOL etc)
async function fetchBinanceBulk(cryptoList) {
    try {
        const res = await fetch(`https://api.binance.com/api/v3/ticker/24hr`);
        if(!res.ok) return;
        const allTickers = await res.json();
        
        cryptoList.forEach(sym => {
            const token = sym.split('-')[0].toUpperCase();
            const data = allTickers.find(t => t.symbol === token + 'USDT') ||
                         allTickers.find(t => t.symbol === token + 'USDC') ||
                         allTickers.find(t => t.symbol === token + 'FDUSD') ||
                         allTickers.find(t => t.symbol === token + 'BTC') ||
                         allTickers.find(t => t.symbol === token + 'BNB');
            
            if (data) {
                if (!STATE.lastData[sym]) STATE.lastData[sym] = {};
                STATE.lastData[sym].symbol = sym;
                STATE.lastData[sym].price = parseFloat(data.lastPrice);
                STATE.lastData[sym].changeDay = parseFloat(data.priceChange);
                STATE.lastData[sym].changePct = parseFloat(data.priceChangePercent);
                
                fetchBinanceHistorical(sym, data.symbol);
            }
        });
    } catch(e) { console.error(`Binance bulk failed`, e); }
}

// ฟังก์ชันสำรองสำหรับดึงเหรียญที่ไม่อยู่ใน Binance (เช่น L3) พร้อมคำนวณ 52W High/Low เอง
async function fetchCoinCapFallback(sym, token) {
    try {
        // 1. ค้นหา ID ของเหรียญในระบบ CoinCap ก่อน (CoinCap ใช้ชื่อเต็ม เช่น bitcoin, layer3)
        const searchRes = await fetch(`https://api.coincap.io/v2/assets?search=${token}&limit=1`);
        if(!searchRes.ok) return;
        const searchJson = await searchRes.json();
        
        if (searchJson.data && searchJson.data.length > 0) {
            const coinData = searchJson.data[0];
            const coinId = coinData.id; // จะได้ชื่อ ID เช่น 'layer3'
            
            if (!STATE.lastData[sym]) STATE.lastData[sym] = {};
            
            const currentPrice = parseFloat(coinData.priceUsd);
            const changePct = parseFloat(coinData.changePercent24Hr);
            
            STATE.lastData[sym].symbol = sym;
            STATE.lastData[sym].price = currentPrice;
            STATE.lastData[sym].changePct = changePct;
            STATE.lastData[sym].changeDay = currentPrice - (currentPrice / (1 + (changePct/100)));

            // 2. ดึงข้อมูลประวัติย้อนหลัง 1 ปี (365 วัน) เพื่อมาคำนวณ 52W High/Low
            const now = Date.now();
            const oneYearAgo = now - (365 * 24 * 60 * 60 * 1000);
            
            try {
                // เรียก API ประวัติราคาแบบรายวัน (interval=d1) ย้อนหลัง 1 ปี
                const histRes = await fetch(`https://api.coincap.io/v2/assets/${coinId}/history?interval=d1&start=${oneYearAgo}&end=${now}`);
                if (histRes.ok) {
                    const histJson = await histRes.json();
                    const historyData = histJson.data;
                    
                    if (historyData && historyData.length > 0) {
                        // ดึงราคาปิดของทุกวันออกมาใส่ Array
                        const validPrices = historyData.map(item => parseFloat(item.priceUsd));
                        
                        // คำนวณ 52W High / Low โดยเอา Array มาหาค่า Max/Min (รวมราคาปัจจุบันเข้าไปด้วย)
                        const high52 = Math.max(...validPrices, currentPrice);
                        const low52 = Math.min(...validPrices, currentPrice);
                        
                        // คำนวณ 1Y Return และ 365D Change
                        const price1Y = validPrices[0]; // ราคาของวันแรกสุดในข้อมูล (1 ปีที่แล้ว)
                        const change365 = currentPrice - price1Y;
                        const return1Y = price1Y ? (change365 / price1Y) * 100 : 0;
                        
                        // บันทึกค่าลง State
                        STATE.lastData[sym].high52 = high52;
                        STATE.lastData[sym].low52 = low52;
                        STATE.lastData[sym].change365 = change365;
                        STATE.lastData[sym].return1Y = return1Y;
                    }
                }
            } catch(histError) { 
                console.error(`Failed to fetch history for ${coinId}`, histError); 
            }
            
            // สั่งอัปเดตตาราง
            renderTable();
        }
    } catch(e) { 
        console.error(`CoinCap fallback failed for ${token}`, e); 
    }
}

async function fetchBinanceHistorical(sym, pair) {
    try {
        const kRes = await fetch(`https://api.binance.com/api/v3/klines?symbol=${pair}&interval=1w&limit=52`);
        if(kRes.ok) {
            const kData = await kRes.json();
            if(kData && kData.length > 0) {
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

// 2. REVERTED TO V9: Yahoo Finance Spark API (with High Performance Concurrency & Accuracy Fix)
const delay = ms => new Promise(res => setTimeout(res, ms));

async function fetchYahooFinanceSparkAPI(stockList) {
    if(stockList.length === 0) return;
    
    const chunkSize = 15; // Safe chunk size for URLs
    const batchPromises = [];
    
    for (let i = 0; i < stockList.length; i += chunkSize) {
        const chunk = stockList.slice(i, i + chunkSize);
        
        // Stagger requests to avoid 429 Rate Limit from proxy (e.g. 0ms, 300ms, 600ms)
        const staggerDelay = (i / chunkSize) * 300; 
        
        const p = delay(staggerDelay).then(() => fetchYahooChunk(chunk));
        batchPromises.push(p);
    }
    
    await Promise.all(batchPromises);
}

async function fetchYahooChunk(chunk) {
    const symbols = chunk.join(',');
    // Reverting exactly to the v9 endpoint
    const targetUrl = encodeURIComponent(`https://query1.finance.yahoo.com/v7/finance/spark?symbols=${symbols}&range=1y&interval=1d`);
    
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
            
            if(data && data.spark && data.spark.result) {
                data.spark.result.forEach(item => {
                    const sym = item.symbol;
                    if(!item.response || !item.response[0] || !item.response[0].indicators) return;
                    
                    const meta = item.response[0].meta;
                    const closePrices = item.response[0].indicators.quote[0].close;
                    
                    if(!closePrices || closePrices.length === 0) return;
                    
                    // Filter out nulls
                    const validPrices = closePrices.filter(p => p !== null && p !== undefined);
                    if(validPrices.length === 0) return;
                    
                    // EXACT ACCURACY CALCULATIONS
                    const currentPrice = meta.regularMarketPrice;
                    const prevClose = meta.previousClose || meta.chartPreviousClose;
                    
                    // Change & Change % (Daily)
                    const changeDay = currentPrice - prevClose;
                    const changePct = prevClose ? (changeDay / prevClose) * 100 : 0;
                    
                    // 1Y Return & 365D Change
                    const price1Y = validPrices[0]; // Oldest price from 1 year ago
                    const change365 = currentPrice - price1Y;
                    const return1Y = price1Y ? (change365 / price1Y) * 100 : 0;
                    
                    // 52W High / Low (calculated strictly from all valid array data + current price)
                    const high52 = Math.max(...validPrices, currentPrice);
                    const low52 = Math.min(...validPrices, currentPrice);
                    
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
                throw new Error("Invalid Yahoo format");
            }
        } catch (e) {
            proxyIndex = (proxyIndex + 1) % PROXIES.length;
            attempts++;
        }
    }
}

// 3. Finnhub Concurrent Fetcher (Fast)
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
