// Application State - Version 17 (High Performance Finnhub+Yahoo Hybrid & Premium Transparent Crypto Logos)
const STATE = {
    watchlists: {}, 
    currentTab: '',
    refreshInterval: parseInt(localStorage.getItem('refreshInterval')) || 0,
    apiSource: 'finnhub', // Hardcoded to optimized hybrid engine
    intervalId: null,
    lastData: {}, // Global cache
    sortCol: null,
    sortAsc: true,
    keys: {
        finnhub: localStorage.getItem('FINNHUB_API_KEY') || ''
    }
};

const KNOWN_CRYPTOS = ['BTC','ETH','USDT','BNB','SOL','USDC','XRP','ADA','DOGE','SHIB','AVAX','DOT','LINK','TRX','MATIC','LTC','BCH','XLM','NEAR','UNI','ZETA','IO','APT','SUI','RENDER','FET','BNSOL','TON','TAO','LINEA','L3'];

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
    fetchDataAllTabs(true);
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
        if (!STATE.keys.finnhub && window.APP_CONFIG.FINNHUB_API_KEY !== 'PASTE_KEY_HERE') {
            STATE.keys.finnhub = window.APP_CONFIG.FINNHUB_API_KEY;
            localStorage.setItem('FINNHUB_API_KEY', STATE.keys.finnhub);
        }
    }
    verifyKeyForCurrentSource();
}

function verifyKeyForCurrentSource() {
    if (!STATE.keys.finnhub) {
        const key = prompt(`Enter Finnhub API Key:`);
        if (key) { 
            STATE.keys.finnhub = key.trim(); 
            localStorage.setItem(`FINNHUB_API_KEY`, STATE.keys.finnhub); 
        }
    }
}

function initUI() {
    document.getElementById('refresh-select').value = STATE.refreshInterval;
    
    document.getElementById('add-btn').addEventListener('click', addSymbols);
    document.getElementById('symbol-input').addEventListener('keypress', (e) => { if (e.key === 'Enter') addSymbols(); });
    document.getElementById('refresh-btn').addEventListener('click', () => fetchDataAllTabs(true));
    document.getElementById('add-tab-btn').addEventListener('click', addNewTab);
    
    document.getElementById('export-btn').addEventListener('click', exportSyncCode);
    document.getElementById('import-btn').addEventListener('click', importSyncCode);

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
    renderTabs(); 
    renderTable(); 
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
    const isCrypto = symbol.includes('-');
    const cleanSym = isCrypto ? symbol.split('-')[0].toUpperCase() : symbol.toUpperCase();
    
    // 1. If explicit transparent premium CoinGecko logo was fetched, use it first
    if (STATE.lastData[symbol] && STATE.lastData[symbol].logoUrl) {
        return `<img src="${STATE.lastData[symbol].logoUrl}" class="img-logo" onerror="handleLogoError(this, '${cleanSym}', ${isCrypto})">`;
    }

    // 2. High Quality Default Multi-layer Fallback Pipeline (Transparent)
    let primaryUrl = isCrypto 
        ? `https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/128/color/${cleanSym.toLowerCase()}.png`
        : `https://financialmodelingprep.com/image-stock/${cleanSym}.png`;

    return `<img src="${primaryUrl}" class="img-logo" onerror="handleLogoError(this, '${cleanSym}', ${isCrypto})">`;
}

window.handleLogoError = function(img, cleanSym, isCrypto) {
    const step = img.getAttribute('data-fallback-step') || '0';
    if (step === '0') {
        img.setAttribute('data-fallback-step', '1');
        img.src = isCrypto 
            ? `https://assets.coincap.io/assets/icons/${cleanSym.toLowerCase()}@2x.png`
            : `https://api.dicebear.com/7.x/initials/svg?seed=${cleanSym}&backgroundColor=1e293b&textColor=f8fafc`;
    } else if (step === '1') {
        img.setAttribute('data-fallback-step', '2');
        img.src = `https://api.dicebear.com/7.x/initials/svg?seed=${cleanSym}&backgroundColor=1e293b&textColor=f8fafc`;
    }
};

// --- HIGH PERFORMANCE GLOBAL FETCH ENGINE ---
async function fetchDataAllTabs(showStatusLoader = false) {
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
            const currentKey = STATE.keys.finnhub;
            if (!currentKey) {
                showAlert(`Missing API Key for FINNHUB`);
                verifyKeyForCurrentSource();
            } else {
                promises.push(fetchFinnhubWithYahooFallback(stocks, currentKey));
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

// --- FULLY PARALLEL HYBRID DATA PIPELINE (MAXIMUM SPEED PERFORMANCE) ---
async function fetchFinnhubWithYahooFallback(stockList, finnhubKey) {
    if (!finnhubKey || stockList.length === 0) return;
    
    // Fire ALL requests concurrently to eliminate sequential network blocking bottlenecks
    const finnhubPromises = stockList.map(async (sym) => {
        try {
            const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${sym}&token=${finnhubKey}`);
            const q = await res.json();
            if (q.c) {
                if (!STATE.lastData[sym]) STATE.lastData[sym] = { symbol: sym };
                STATE.lastData[sym].price = q.c;
                STATE.lastData[sym].changeDay = q.d;
                STATE.lastData[sym].changePct = q.dp;
            }
        } catch(e) {}
    });

    const yahooPromise = fetchYahooSparkWithFinnhubFallback(stockList, finnhubKey, false);
    
    // Resolve everything in parallel execution
    await Promise.all([...finnhubPromises, yahooPromise]);
}

async function fetchYahooSparkWithFinnhubFallback(stockList, finnhubKey, yahooPrimary = false) {
    if(stockList.length === 0) return;
    
    const chunkSize = 20; // Expanded chunk sizes to reduce proxy roundtrips
    const batchPromises = [];
    
    for (let i = 0; i < stockList.length; i += chunkSize) {
        const chunk = stockList.slice(i, i + chunkSize);
        // Execute chunk fetches instantly in parallel, eliminating artificial delay blockings
        batchPromises.push(fetchYahooChunk(chunk, finnhubKey, yahooPrimary));
    }
    
    await Promise.all(batchPromises);
}

async function fetchYahooChunk(chunk, finnhubKey, yahooPrimary = false) {
    const symbols = chunk.join(',');
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
                    const validPrices = closePrices.filter(p => p !== null && p !== undefined);
                    if(validPrices.length === 0) return;
                    
                    const currentPrice = meta.regularMarketPrice;
                    const price1Y = validPrices[0];
                    const change365 = currentPrice - price1Y;
                    const return1Y = price1Y ? (change365 / price1Y) * 100 : 0;
                    
                    const high52 = Math.max(...validPrices, currentPrice);
                    const low52 = Math.min(...validPrices, currentPrice);

                    if (!STATE.lastData[sym]) STATE.lastData[sym] = { symbol: sym };
                    STATE.lastData[sym].change365 = change365;
                    STATE.lastData[sym].return1Y = return1Y;
                    STATE.lastData[sym].high52 = high52;
                    STATE.lastData[sym].low52 = low52;

                    if (yahooPrimary) {
                        STATE.lastData[sym].price = currentPrice;
                        const prevClose = meta.previousClose || meta.chartPreviousClose;
                        if (prevClose) {
                            STATE.lastData[sym].changeDay = currentPrice - prevClose;
                            STATE.lastData[sym].changePct = (STATE.lastData[sym].changeDay / prevClose) * 100;
                        }
                    }
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

// --- CRYPTO PIPELINE WITH TARGETED COINGECKO PREMIUM LOGO DISCOVERY ---
async function fetchCryptoEngine(cryptos) {
    let binanceTickers = [];
    try {
        const res = await fetch(`https://api.binance.com/api/v3/ticker/24hr`);
        if(res.ok) binanceTickers = await res.json();
    } catch(e) { console.error("Binance ticker API offline", e); }

    const cryptoPromises = cryptos.map(async (sym) => {
        const token = sym.split('-')[0].toUpperCase();
        
        const bMatch = binanceTickers.find(t => t.symbol === token + 'USDT') ||
                       binanceTickers.find(t => t.symbol === token + 'USDC') ||
                       binanceTickers.find(t => t.symbol === token + 'FDUSD') ||
                       binanceTickers.find(t => t.symbol === token + 'BTC');

        if(bMatch) {
            if (!STATE.lastData[sym]) STATE.lastData[sym] = { symbol: sym };
            STATE.lastData[sym].price = parseFloat(bMatch.lastPrice);
            STATE.lastData[sym].changeDay = parseFloat(bMatch.priceChange);
            STATE.lastData[sym].changePct = parseFloat(bMatch.priceChangePercent);
            
            // Instantly trigger silent background historical data resolution
            fetchBinanceHistoricalQuietly(sym, bMatch.symbol);
        } else {
            // Specialized premium discovery path for exotic custom assets (L3, LINEA, BNSOL, etc.)
            await fetchCoinGeckoFallback(sym, token);
        }
    });

    await Promise.all(cryptoPromises);
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

// Advanced CoinGecko Discovery: Fetches sharp transparent vector/large png assets natively
async function fetchCoinGeckoFallback(sym, token) {
    try {
        const knownIds = {
            'L3': 'layer3',
            'LINEA': 'linea',
            'BNSOL': 'binance-staked-sol'
        };
        
        let cgId = knownIds[token.toUpperCase()] || token.toLowerCase();
        let transparentPremiumLogo = null;

        // Execute precise search query to gather the exact CoinGecko Asset ID and crisp transparent logo asset
        const searchRes = await fetch(`https://api.coingecko.com/api/v3/search?query=${token}`);
        if(searchRes.ok) {
            const searchData = await searchRes.json();
            if(searchData.coins && searchData.coins.length > 0) {
                const exactMatch = searchData.coins.find(c => c.symbol.toUpperCase() === token.toUpperCase());
                const finalTarget = exactMatch || searchData.coins[0];
                cgId = finalTarget.id;
                if(finalTarget.large && !finalTarget.large.includes('missing_large.png')) {
                    transparentPremiumLogo = finalTarget.large; // Beautiful, high-resolution transparent asset
                }
            }
        }

        const priceRes = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${cgId}&vs_currencies=usd&include_24hr_change=true`);
        if(priceRes.ok) {
            const priceData = await priceRes.json();
            if(priceData[cgId]) {
                const currentPrice = priceData[cgId].usd;
                const changePct = priceData[cgId].usd_24h_change || 0;
                const changeDay = currentPrice - (currentPrice / (1 + (changePct / 100)));

                if (!STATE.lastData[sym]) STATE.lastData[sym] = { symbol: sym };
                STATE.lastData[sym].price = currentPrice;
                STATE.lastData[sym].changeDay = changeDay;
                STATE.lastData[sym].changePct = changePct;
                
                if (transparentPremiumLogo) {
                    STATE.lastData[sym].logoUrl = transparentPremiumLogo;
                }
                
                renderTable(); 
                await fetchCoinGeckoHistorical(sym, cgId, currentPrice);
            }
        }
    } catch(e) { console.error(`Premium CoinGecko fallback exception for ${token}`, e); }
}

async function fetchCoinGeckoHistorical(sym, cgId, currentPrice) {
    try {
        const histRes = await fetch(`https://api.coingecko.com/api/v3/coins/${cgId}/market_chart?vs_currency=usd&days=365&interval=daily`);
        if (histRes.ok) {
            const histData = await histRes.json();
            if (histData && histData.prices && histData.prices.length > 0) {
                const validPrices = histData.prices.map(p => p[1]).filter(p => p !== null && p !== undefined);
                if (validPrices.length > 0) {
                    const high52 = Math.max(...validPrices, currentPrice);
                    const low52 = Math.min(...validPrices, currentPrice);
                    const price1Y = validPrices[0]; 
                    const change365 = currentPrice - price1Y;
                    const return1Y = price1Y ? (change365 / price1Y) * 100 : 0;
                    
                    STATE.lastData[sym].high52 = high52;
                    STATE.lastData[sym].low52 = low52;
                    STATE.lastData[sym].change365 = change365;
                    STATE.lastData[sym].return1Y = return1Y;
                    renderTable();
                }
            }
        }
    } catch (e) {}
}

// --- RENDER TABLE ENGINE ---
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
