// Configura adaptador universal para rodar nativo no Electron ou via Web App
const API_BASE = window.location.protocol.startsWith('http') ? '' : 'http://localhost:38456';

if (!window.api || !window.api.getInstalledApps) {
    let batchListeners = [];
    let scanProgressListeners = [];
    try {
        const evtSource = new EventSource(`${API_BASE}/api/events`);
        evtSource.onmessage = (e) => {
            try {
                const data = JSON.parse(e.data);
                if (data.type === 'scan-progress') {
                    scanProgressListeners.forEach(cb => cb(data));
                } else {
                    batchListeners.forEach(cb => cb(data));
                }
            } catch (err) {}
        };
    } catch (e) {}

    window.api = {
        getInstalledApps: () => fetch(`${API_BASE}/api/apps`).then(r => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.json();
        }),
        getWindowsApps: () => fetch(`${API_BASE}/api/windows-apps`).then(r => r.json()),
        scanLeftovers: (app, scanLevel) => fetch(`${API_BASE}/api/scan`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ app, scanLevel })
        }).then(r => r.json()),
        cleanLeftovers: (items) => fetch(`${API_BASE}/api/clean`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(items)
        }).then(r => r.json()),
        createRestorePoint: (desc) => fetch(`${API_BASE}/api/restore`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ desc })
        }).then(r => r.json()),
        runSingleUninstall: (app, options) => fetch(`${API_BASE}/api/uninstall`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ app, options })
        }).then(r => r.json()),
        startBatchUninstall: (apps, options) => fetch(`${API_BASE}/api/batch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ apps, options })
        }).then(r => r.json()),
        cancelBatch: () => fetch(`${API_BASE}/api/cancel-batch`, { method: 'POST' }).then(r => r.json()),
        scanOrphans: () => fetch(`${API_BASE}/api/scan-orphans`).then(r => r.json()),
        cleanOrphans: (items) => fetch(`${API_BASE}/api/clean-orphans`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(items)
        }).then(r => r.json()),
        checkForUpdates: () => fetch(`${API_BASE}/api/check-update`).then(r => r.json()),
        applyUpdate: () => fetch(`${API_BASE}/api/apply-update`, { method: 'POST' }).then(r => r.json()),
        openFolder: () => {},
        onBatchStatus: (cb) => {
            batchListeners.push(cb);
            return () => { batchListeners = batchListeners.filter(l => l !== cb); };
        },
        onScanProgress: (cb) => {
            scanProgressListeners.push(cb);
            return () => { scanProgressListeners = scanProgressListeners.filter(l => l !== cb); };
        }
    };
}

// Estado global da aplicação
let allApps = [];
let filteredApps = [];
let selectedAppIds = new Set();
let currentFilter = 'all';
let currentSort = { column: 'name', asc: true };
let currentLeftovers = null;
let currentLeftoverApp = null;
let currentTab = 'programs';
let cachedPrograms = null;
let cachedWindowsApps = null;

// Elementos da UI
const appsTable = document.getElementById('appsTable');
const appsTableBody = document.getElementById('appsTableBody');
const loadingState = document.getElementById('loadingState');
const loadingProgressBar = document.getElementById('loadingProgressBar');
const loadingPercentLabel = document.getElementById('loadingPercentLabel');
const loadingStepLabel = document.getElementById('loadingStepLabel');
const emptyState = document.getElementById('emptyState');
const searchInput = document.getElementById('searchInput');
const btnClearSearch = document.getElementById('btnClearSearch');
const checkSelectAllHeader = document.getElementById('checkSelectAllHeader');

// Estatísticas
const statTotalApps = document.getElementById('statTotalApps');
const statTotalSize = document.getElementById('statTotalSize');
const statSelectedCount = document.getElementById('statSelectedCount');

// Barra Slim de Fila
const batchBar = document.getElementById('batchBar');
const batchCountStrong = document.getElementById('batchCountStrong');
const batchSizeSpan = document.getElementById('batchSizeSpan');
const batchBadgeCount = document.getElementById('batchBadgeCount');
const batchBarTitle = document.getElementById('batchBarTitle');
const batchBarSubtitle = document.getElementById('batchBarSubtitle');
const btnStartBatch = document.getElementById('btnStartBatch');
const btnCancelSelection = document.getElementById('btnCancelSelection');
const optSilent = document.getElementById('optSilent');
const optScanLeftovers = document.getElementById('optScanLeftovers');
const optAutoClean = document.getElementById('optAutoClean');
const optRestorePoint = document.getElementById('optRestorePoint');
const optRecycleBin = document.getElementById('optRecycleBin');
const btnCheckUpdate = document.getElementById('btnCheckUpdate');
const updateDot = document.getElementById('updateDot');
const updateBtnText = document.getElementById('updateBtnText');

// Modais
const batchModal = document.getElementById('batchModal');
const batchQueueList = document.getElementById('batchQueueList');
const batchProgressBar = document.getElementById('batchProgressBar');
const batchProgressLabel = document.getElementById('batchProgressLabel');
const batchCurrentAction = document.getElementById('batchCurrentAction');
const batchModalFooter = document.getElementById('batchModalFooter');
const btnAbortBatch = document.getElementById('btnAbortBatch');
const btnCloseBatchModal = document.getElementById('btnCloseBatchModal');

const leftoverModal = document.getElementById('leftoverModal');
const leftoverAppTitle = document.getElementById('leftoverAppTitle');
const leftoverAppSubtitle = document.getElementById('leftoverAppSubtitle');
const leftoverRegCount = document.getElementById('leftoverRegCount');
const leftoverFileCount = document.getElementById('leftoverFileCount');
const leftoverTotalSize = document.getElementById('leftoverTotalSize');
const leftoverRegList = document.getElementById('leftoverRegList');
const leftoverFileList = document.getElementById('leftoverFileList');
const btnCleanSelectedLeftovers = document.getElementById('btnCleanSelectedLeftovers');

// Inicialização
document.addEventListener('DOMContentLoaded', () => {
    console.log('>>> DOMContentLoaded: window.api existe?', !!window.api);
    if (window.api) {
        console.log('>>> Métodos disponíveis em window.api:', Object.keys(window.api));
    }
    setupScanProgressListener();
    loadApps();
    setupEventListeners();
    setupBatchListener();
    checkAppUpdates(false);
});

function setupEventListeners() {
    // Busca instantânea
    searchInput.addEventListener('input', (e) => {
        const val = e.target.value.trim();
        btnClearSearch.classList.toggle('hidden', !val);
        applyFiltersAndRender();
    });

    btnClearSearch.addEventListener('click', () => {
        searchInput.value = '';
        btnClearSearch.classList.add('hidden');
        searchInput.focus();
        applyFiltersAndRender();
    });

    // Atalho de teclado Ctrl+F
    window.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
            e.preventDefault();
            searchInput.focus();
            searchInput.select();
        }
    });

    // Filtros rápidos
    document.querySelectorAll('.filter-chips .chip').forEach(chip => {
        chip.addEventListener('click', () => {
            document.querySelectorAll('.filter-chips .chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            currentFilter = chip.dataset.filter;
            applyFiltersAndRender();
        });
    });

    // Ordenação de colunas
    document.querySelectorAll('th.sortable').forEach(th => {
        th.addEventListener('click', () => {
            const col = th.dataset.sort;
            if (currentSort.column === col) {
                currentSort.asc = !currentSort.asc;
            } else {
                currentSort.column = col;
                currentSort.asc = true;
            }
            updateSortIcons();
            applyFiltersAndRender();
        });
    });

    // Seleção em massa
    document.getElementById('btnSelectAll').addEventListener('click', selectAllVisible);
    document.getElementById('btnDeselectAll').addEventListener('click', deselectAll);
    document.getElementById('btnInvertSelection').addEventListener('click', invertSelection);
    btnCancelSelection.addEventListener('click', deselectAll);

    checkSelectAllHeader.addEventListener('change', (e) => {
        if (e.target.checked) {
            selectAllVisible();
        } else {
            deselectAll();
        }
    });

    // Botões de Ação
    document.getElementById('btnRefresh').addEventListener('click', () => {
        showToast('Atualizando lista de aplicativos...', 'info');
        refreshCurrentInventory(true);
    });

    // Abas do Ribbon com Cache Instantâneo (0ms)
    const tabPrograms = document.getElementById('tabPrograms');
    const tabWindowsApps = document.getElementById('tabWindowsApps');

    function switchTab(tab) {
        if (currentTab === tab && allApps && allApps.length > 0) return;
        currentTab = tab;

        if (tab === 'programs') {
            tabPrograms.classList.add('active');
            tabWindowsApps.classList.remove('active');
            if (cachedPrograms !== null) {
                allApps = cachedPrograms;
                loadingState.classList.add('hidden');
                emptyState.classList.add('hidden');
                appsTable.classList.remove('hidden');
                applyFiltersAndRender();
                return;
            }
            loadApps(0, false);
        } else {
            tabWindowsApps.classList.add('active');
            tabPrograms.classList.remove('active');
            if (cachedWindowsApps !== null) {
                allApps = cachedWindowsApps;
                loadingState.classList.add('hidden');
                emptyState.classList.add('hidden');
                appsTable.classList.remove('hidden');
                applyFiltersAndRender();
                return;
            }
            loadWindowsApps(false);
        }
    }

    tabPrograms.addEventListener('click', () => switchTab('programs'));
    tabWindowsApps.addEventListener('click', () => switchTab('windows-apps'));

    // Botão Desinstalar Fila no Header
    document.getElementById('btnHeaderBatch').addEventListener('click', () => {
        openBatchConfirmModal();
    });

    // Modal de Confirmação Pré-Desinstalação em Fila
    document.getElementById('btnCancelBatchConfirm').addEventListener('click', () => {
        document.getElementById('batchConfirmModal').classList.add('hidden');
    });
    document.getElementById('btnCloseBatchConfirm').addEventListener('click', () => {
        document.getElementById('batchConfirmModal').classList.add('hidden');
    });
    document.getElementById('btnProceedBatch').addEventListener('click', () => {
        document.getElementById('batchConfirmModal').classList.add('hidden');
        executeBatch();
    });

    // Standalone Residual Scanner (Resíduos Órfãos)
    document.getElementById('btnOrphanScanner').addEventListener('click', openOrphanModal);
    document.getElementById('btnCloseOrphanModal').addEventListener('click', closeOrphanModal);
    document.getElementById('btnCancelOrphan').addEventListener('click', closeOrphanModal);
    document.getElementById('btnStartOrphanScan').addEventListener('click', runOrphanScan);
    document.getElementById('btnCleanSelectedOrphans').addEventListener('click', cleanSelectedOrphans);
    document.getElementById('btnOrphanSelectAll').addEventListener('click', () => setOrphanSelection('all'));
    document.getElementById('btnOrphanSelectSafe').addEventListener('click', () => setOrphanSelection('safe'));
    document.getElementById('btnOrphanDeselectAll').addEventListener('click', () => setOrphanSelection('none'));

    const checkOrphanHeaderAll = document.getElementById('checkOrphanHeaderAll');
    if (checkOrphanHeaderAll) {
        checkOrphanHeaderAll.addEventListener('change', (e) => {
            const checked = e.target.checked;
            const filtered = orphanItems.filter(item => {
                if (currentOrphanFilter === 'safe') return item.Risk === 'Safe';
                if (currentOrphanFilter === 'review') return item.Risk === 'Review';
                return true;
            });
            filtered.forEach(item => { item.Selected = checked; });
            renderOrphanItems();
        });
    }

    document.querySelectorAll('.orphan-filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.orphan-filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentOrphanFilter = btn.dataset.orphanFilter;
            renderOrphanItems();
        });
    });

    // Modal de Opções com Persistência
    const optionsModal = document.getElementById('optionsModal');
    const cfgRestorePoint = document.getElementById('cfgRestorePoint');
    const cfgRecycleBin = document.getElementById('cfgRecycleBin');
    const cfgKillProcesses = document.getElementById('cfgKillProcesses');
    const cfgDeepServices = document.getElementById('cfgDeepServices');
    const cfgAutoCheckUpdates = document.getElementById('cfgAutoCheckUpdates');

    function loadSavedOptions() {
        try {
            const saved = JSON.parse(localStorage.getItem('queu_options') || '{}');
            if (saved.restorePoint !== undefined) cfgRestorePoint.checked = saved.restorePoint;
            if (saved.recycleBin !== undefined) {
                cfgRecycleBin.checked = saved.recycleBin;
                if (optRecycleBin) optRecycleBin.checked = saved.recycleBin;
            }
            if (saved.killProcesses !== undefined) cfgKillProcesses.checked = saved.killProcesses;
            if (saved.deepServices !== undefined) cfgDeepServices.checked = saved.deepServices;
            if (saved.autoCheckUpdates !== undefined) cfgAutoCheckUpdates.checked = saved.autoCheckUpdates;
        } catch (e) {}
    }
    loadSavedOptions();

    document.getElementById('btnOptionsModal').addEventListener('click', () => {
        loadSavedOptions();
        optionsModal.classList.remove('hidden');
    });
    document.getElementById('btnCloseOptions').addEventListener('click', () => {
        optionsModal.classList.add('hidden');
    });
    document.getElementById('btnSaveOptions').addEventListener('click', () => {
        const toSave = {
            restorePoint: cfgRestorePoint.checked,
            recycleBin: cfgRecycleBin.checked,
            killProcesses: cfgKillProcesses.checked,
            deepServices: cfgDeepServices.checked,
            autoCheckUpdates: cfgAutoCheckUpdates.checked
        };
        localStorage.setItem('queu_options', JSON.stringify(toSave));
        if (optRecycleBin) optRecycleBin.checked = toSave.recycleBin;
        if (optRestorePoint) optRestorePoint.checked = toSave.restorePoint;
        optionsModal.classList.add('hidden');
        showToast('Configurações salvas e aplicadas com sucesso!', 'success');
    });

    btnCheckUpdate.addEventListener('click', () => {
        checkAppUpdates(true);
    });

    document.getElementById('btnCreateRestore').addEventListener('click', async () => {
        showToast('Criando ponto de restauração no Windows...', 'info');
        const res = await window.api.createRestorePoint('Ponto Manual Queu Uninstaller');
        if (res.Success) {
            showToast(res.Message, 'success');
        } else {
            showToast(res.Message, 'error');
        }
    });

    // Fila de desinstalação
    btnStartBatch.addEventListener('click', openBatchConfirmModal);
    btnAbortBatch.addEventListener('click', async () => {
        btnAbortBatch.disabled = true;
        btnAbortBatch.textContent = 'Cancelando...';
        await window.api.cancelBatch();
    });

    btnCloseBatchModal.addEventListener('click', () => {
        batchModal.classList.add('hidden');
        deselectAll();
        cachedPrograms = null;
        cachedWindowsApps = null;
        refreshCurrentInventory(true);
    });

    // Modal de Sobras
    document.getElementById('btnCloseLeftoverModal').addEventListener('click', () => {
        leftoverModal.classList.add('hidden');
        refreshCurrentInventory();
    });
    document.getElementById('btnCancelLeftover').addEventListener('click', () => {
        leftoverModal.classList.add('hidden');
        refreshCurrentInventory();
    });
    btnCleanSelectedLeftovers.addEventListener('click', executeLeftoverClean);
}

function refreshCurrentInventory(force = true) {
    if (currentTab === 'windows-apps') {
        if (force) cachedWindowsApps = null;
        return loadWindowsApps(force);
    } else {
        if (force) cachedPrograms = null;
        return loadApps(0, force);
    }
}

function runProgressAnimation({ barElem, percentElem, labelElem, steps, duration = 2000 }) {
    let currentPct = 10;
    let stepIndex = 0;
    if (barElem) barElem.style.width = '10%';
    if (percentElem) percentElem.textContent = '10%';
    if (labelElem && steps && steps.length > 0) labelElem.textContent = steps[0];

    const stepInterval = setInterval(() => {
        if (currentPct < 90) {
            currentPct += Math.floor(Math.random() * 8) + 4;
            if (currentPct > 90) currentPct = 90;
            if (barElem) barElem.style.width = `${currentPct}%`;
            if (percentElem) percentElem.textContent = `${currentPct}%`;
        }
        if (steps && steps.length > 0) {
            stepIndex = (stepIndex + 1) % steps.length;
            if (labelElem) labelElem.textContent = steps[stepIndex];
        }
    }, Math.max(300, Math.floor(duration / (steps ? steps.length : 5))));

    return {
        finish: () => new Promise(resolve => {
            clearInterval(stepInterval);
            if (barElem) barElem.style.width = '100%';
            if (percentElem) percentElem.textContent = '100%';
            if (labelElem) labelElem.textContent = 'Concluído!';
            setTimeout(resolve, 100);
        }),
        stop: () => {
            clearInterval(stepInterval);
        }
    };
}
const runIndeterminateLoading = runProgressAnimation;

function setupScanProgressListener() {
    if (window.api && typeof window.api.onScanProgress === 'function') {
        window.api.onScanProgress(({ pct, step }) => {
            if (loadingProgressBar) loadingProgressBar.style.width = `${pct}%`;
            if (loadingPercentLabel) loadingPercentLabel.textContent = `${pct}%`;
            if (loadingStepLabel && step) loadingStepLabel.textContent = step;
        });
    }
    if (window.api && typeof window.api.onOrphanScanProgress === 'function') {
        window.api.onOrphanScanProgress(({ pct, step }) => {
            const bar = document.getElementById('orphanProgressBar');
            const pctLbl = document.getElementById('orphanPercentLabel');
            const stepLbl = document.getElementById('orphanStepLabel');
            if (bar) bar.style.width = `${pct}%`;
            if (pctLbl) pctLbl.textContent = `${pct}%`;
            if (stepLbl && step) stepLbl.textContent = step;
        });
    }
}

function updateFooterStats() {
    const isWindowsApps = currentTab === 'windows-apps';
    const typeLabel = isWindowsApps ? 'app da Store' : 'programa';
    const pluralLabel = isWindowsApps ? 'apps da Store' : 'programas';

    const totalCount = allApps.length;
    const filteredCount = filteredApps.length;

    if (filteredCount === totalCount) {
        statTotalApps.textContent = `${totalCount} ${totalCount === 1 ? typeLabel : pluralLabel}`;
    } else {
        statTotalApps.textContent = `${filteredCount} de ${totalCount} ${pluralLabel}`;
    }

    const totalKb = allApps.reduce((acc, app) => acc + (app.EstimatedSizeKb || 0), 0);
    if (totalKb > 0) {
        statTotalSize.textContent = formatSize(totalKb * 1024);
    } else {
        statTotalSize.textContent = isWindowsApps ? '--' : '0 MB';
    }
}

async function loadWindowsApps(force = false) {
    currentTab = 'windows-apps';
    if (!force && cachedWindowsApps !== null) {
        allApps = cachedWindowsApps;
        loadingState.classList.add('hidden');
        appsTable.classList.remove('hidden');
        emptyState.classList.add('hidden');
        applyFiltersAndRender();
        return;
    }

    loadingState.classList.remove('hidden');
    appsTable.classList.add('hidden');
    emptyState.classList.add('hidden');
    statTotalApps.textContent = 'Buscando Windows Apps...';

    const titleElem = document.getElementById('loadingTitle');
    const subElem = document.getElementById('loadingSub');
    if (titleElem) titleElem.textContent = 'Buscando Aplicativos da Microsoft Store...';
    if (subElem) subElem.textContent = 'Consultando pacotes Appx/MSIX instalados e metadados';

    if (loadingProgressBar) loadingProgressBar.style.width = '0%';
    if (loadingPercentLabel) loadingPercentLabel.textContent = '0%';
    if (loadingStepLabel) loadingStepLabel.textContent = 'Consultando catálogo Appx/MSIX no Windows...';

    try {
        allApps = await window.api.getWindowsApps();
        cachedWindowsApps = allApps;
        if (loadingProgressBar) loadingProgressBar.style.width = '100%';
        if (loadingPercentLabel) loadingPercentLabel.textContent = '100%';
        if (loadingStepLabel) loadingStepLabel.textContent = 'Concluído!';
        await new Promise(r => setTimeout(r, 120));
        loadingState.classList.add('hidden');
        appsTable.classList.remove('hidden');
        applyFiltersAndRender();
    } catch (err) {
        showToast(`Erro ao listar Windows Apps: ${err.message}`, 'error');
        loadingState.classList.add('hidden');
        emptyState.classList.remove('hidden');
    }
}

// Carregar inventário de programas
async function loadApps(retryCount = 0, force = false) {
    currentTab = 'programs';
    if (!force && cachedPrograms !== null) {
        allApps = cachedPrograms;
        loadingState.classList.add('hidden');
        appsTable.classList.remove('hidden');
        emptyState.classList.add('hidden');
        applyFiltersAndRender();
        return;
    }

    loadingState.classList.remove('hidden');
    appsTable.classList.add('hidden');
    emptyState.classList.add('hidden');
    statTotalApps.textContent = 'Examinando programas...';

    const titleElem = document.getElementById('loadingTitle');
    const subElem = document.getElementById('loadingSub');
    if (titleElem) titleElem.textContent = 'Examinando Registro e Sistema do Windows...';
    if (subElem) subElem.textContent = 'Detectando aplicativos instalados, ícones nativos e estimativa de tamanho';

    if (loadingProgressBar) loadingProgressBar.style.width = '0%';
    if (loadingPercentLabel) loadingPercentLabel.textContent = '0%';
    if (loadingStepLabel) loadingStepLabel.textContent = 'Iniciando varredura do sistema...';

    try {
        allApps = await window.api.getInstalledApps();
        cachedPrograms = allApps;
        if (loadingProgressBar) loadingProgressBar.style.width = '100%';
        if (loadingPercentLabel) loadingPercentLabel.textContent = '100%';
        if (loadingStepLabel) loadingStepLabel.textContent = 'Concluído!';
        await new Promise(r => setTimeout(r, 120));
        loadingState.classList.add('hidden');
        appsTable.classList.remove('hidden');
        applyFiltersAndRender();
    } catch (err) {
        if (retryCount < 2) {
            console.log('Tentando reconectar em 1 segundo...');
            setTimeout(() => loadApps(retryCount + 1, force), 1000);
            return;
        }

        showToast(`Erro ao obter lista de programas: ${err.message}`, 'error');
        loadingState.classList.add('hidden');
        emptyState.classList.remove('hidden');
    }
}

// Filtros e Renderização
function applyFiltersAndRender() {
    const term = searchInput.value.toLowerCase().trim();

    filteredApps = allApps.filter(app => {
        // Busca textual
        if (term) {
            const nameMatch = (app.DisplayName || '').toLowerCase().includes(term);
            const pubMatch = (app.Publisher || '').toLowerCase().includes(term);
            const idMatch = (app.Id || '').toLowerCase().includes(term);
            if (!nameMatch && !pubMatch && !idMatch) return false;
        }

        // Filtros rápidos
        if (currentFilter === 'large') {
            return (app.EstimatedSizeKb || 0) >= 500 * 1024; // > 500MB
        }
        if (currentFilter === 'silent') {
            return !!(app.QuietUninstallString && app.QuietUninstallString.trim());
        }
        if (currentFilter === 'recent') {
            return !!app.InstallDate;
        }

        return true;
    });

    // Ordenação
    filteredApps.sort((a, b) => {
        let valA = a.DisplayName || '';
        let valB = b.DisplayName || '';

        if (currentSort.column === 'size') {
            valA = a.EstimatedSizeKb || 0;
            valB = b.EstimatedSizeKb || 0;
        } else if (currentSort.column === 'version') {
            valA = a.DisplayVersion || '';
            valB = b.DisplayVersion || '';
        } else if (currentSort.column === 'date') {
            valA = a.InstallDate || '';
            valB = b.InstallDate || '';
        }

        if (valA < valB) return currentSort.asc ? -1 : 1;
        if (valA > valB) return currentSort.asc ? 1 : -1;
        return 0;
    });

    renderTable();
    updateBatchBar();
    updateFooterStats();
}

function isGameApp(app) {
    const text = `${app.DisplayName || ''} ${app.Publisher || ''} ${app.Comments || ''}`.toLowerCase();
    const gameKeywords = [
        'game', 'simulator', 'adventure', 'steam', 'hydra', 'gog', 
        'rpg', 'remastered', 'edition', 'craft', 'need for speed', 
        'alba', 'goat', 'ubisoft', 'epic games', 'riot games', 'blizzard', 
        'rockstar', 'ea sports', 'electronic arts', 'bethesda', 'capcom', 
        'valve', 'bandai', 'square enix', 'playstation', 'xbox'
    ];
    return gameKeywords.some(kw => text.includes(kw));
}

function renderTable() {
    appsTableBody.innerHTML = '';

    if (filteredApps.length === 0) {
        appsTable.classList.add('hidden');
        emptyState.classList.remove('hidden');
        return;
    }

    appsTable.classList.remove('hidden');
    emptyState.classList.add('hidden');

    const fragment = document.createDocumentFragment();

    filteredApps.forEach(app => {
        const isSelected = selectedAppIds.has(app.Id);
        const tr = document.createElement('tr');
        if (isSelected) tr.classList.add('selected');

        const initialLetter = (app.DisplayName || 'A').charAt(0).toUpperCase();
        const badgeClass = getBadgeClass(app.InstallerType);
        const sizeFormatted = app.EstimatedSizeKb ? formatSize(app.EstimatedSizeKb * 1024) : 'Desconhecido';
        const dateFormatted = formatDate(app.InstallDate);
        const archBadge = app.Architecture === '64-bit' ? 'badge-64' : 'badge-32';

        let iconHtml = '';
        if (app.IconBase64) {
            iconHtml = `<img src="${app.IconBase64}" class="app-icon-img" alt="${escapeHtml(app.DisplayName)}" onerror="this.outerHTML='<div class=\\'app-icon-fallback\\'>${initialLetter}</div>'">`;
        } else if (isGameApp(app)) {
            iconHtml = `
                <div class="app-icon-game" title="Jogo / Simulador">
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="6" y1="12" x2="10" y2="12"></line>
                        <line x1="8" y1="10" x2="8" y2="14"></line>
                        <line x1="15" y1="13" x2="15.01" y2="13"></line>
                        <line x1="18" y1="11" x2="18.01" y2="11"></line>
                        <rect x="2" y="6" width="20" height="12" rx="6"></rect>
                    </svg>
                </div>
            `;
        } else {
            iconHtml = `<div class="app-icon-fallback">${initialLetter}</div>`;
        }

        let cleanSiteDisplay = '';
        if (app.WebSite) {
            cleanSiteDisplay = app.WebSite.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '');
            if (cleanSiteDisplay.length > 25) {
                cleanSiteDisplay = cleanSiteDisplay.substring(0, 22) + '...';
            }
        }
        const siteHtml = app.WebSite 
            ? `<a href="${escapeHtml(app.WebSite)}" target="_blank" class="publisher-link" title="${escapeHtml(app.WebSite)}" onclick="event.stopPropagation()">${escapeHtml(cleanSiteDisplay)}</a>`
            : `<span style="color: var(--text-muted);">-</span>`;

        tr.innerHTML = `
            <td class="text-center">
                <input type="checkbox" class="row-check" data-id="${escapeHtml(app.Id)}" ${isSelected ? 'checked' : ''}>
            </td>
            <td>
                <div class="app-info-cell">
                    ${iconHtml}
                    <div class="app-names">
                        <span class="app-display-name">
                            ${escapeHtml(app.DisplayName)}
                            ${app.IsOrphan ? '<span class="badge-orphan" title="Arquivos ausentes no disco. Apenas chave de registro encontrada.">👻 Órfão</span>' : ''}
                        </span>
                    </div>
                </div>
            </td>
            <td><b>${sizeFormatted}</b></td>
            <td>${escapeHtml(app.DisplayVersion || '--')}</td>
            <td><span class="badge-arch ${archBadge}">${escapeHtml(app.Architecture || '64-bit')}</span></td>
            <td>${dateFormatted}</td>
            <td>${escapeHtml(app.Publisher || 'Não informado')}</td>
            <td>${siteHtml}</td>
            <td class="text-center">
                <div class="row-actions">
                    <button class="btn-icon-action danger" data-action="uninstall" data-id="${escapeHtml(app.Id)}" title="Desinstalar este aplicativo">
                        Desinstalar
                    </button>
                </div>
            </td>
        `;

        // Checkbox row click
        const checkbox = tr.querySelector('.row-check');
        checkbox.addEventListener('change', (e) => {
            toggleAppSelection(app.Id, e.target.checked);
        });

        // Clique na linha também pode marcar/desmarcar
        tr.addEventListener('click', (e) => {
            if (e.target.closest('button') || e.target.closest('input')) return;
            const newChecked = !checkbox.checked;
            checkbox.checked = newChecked;
            toggleAppSelection(app.Id, newChecked);
        });

        // Ação individual de desinstalação
        const btnUnin = tr.querySelector('[data-action="uninstall"]');
        btnUnin.addEventListener('click', (e) => {
            e.stopPropagation();
            singleUninstall(app);
        });

        fragment.appendChild(tr);
    });

    appsTableBody.appendChild(fragment);

    // Atualiza checkbox mestre do header
    const allVisibleSelected = filteredApps.length > 0 && filteredApps.every(a => selectedAppIds.has(a.Id));
    checkSelectAllHeader.checked = allVisibleSelected;
}

// Seleção e Barra Flutuante
function toggleAppSelection(appId, isSelected) {
    if (isSelected) {
        selectedAppIds.add(appId);
    } else {
        selectedAppIds.delete(appId);
    }
    updateBatchBar();

    // Atualiza classe da linha
    const row = document.querySelector(`.row-check[data-id="${appId}"]`);
    if (row) {
        row.closest('tr').classList.toggle('selected', isSelected);
    }
}

function selectAllVisible() {
    filteredApps.forEach(a => selectedAppIds.add(a.Id));
    document.querySelectorAll('.row-check').forEach(c => c.checked = true);
    document.querySelectorAll('#appsTableBody tr').forEach(r => r.classList.add('selected'));
    checkSelectAllHeader.checked = true;
    updateBatchBar();
}

function deselectAll() {
    selectedAppIds.clear();
    document.querySelectorAll('.row-check').forEach(c => c.checked = false);
    document.querySelectorAll('#appsTableBody tr').forEach(r => r.classList.remove('selected'));
    checkSelectAllHeader.checked = false;
    updateBatchBar();
}

function invertSelection() {
    filteredApps.forEach(a => {
        if (selectedAppIds.has(a.Id)) {
            selectedAppIds.delete(a.Id);
        } else {
            selectedAppIds.add(a.Id);
        }
    });
    renderTable();
    updateBatchBar();
    updateFooterStats();
}

function updateBatchBar() {
    const count = selectedAppIds.size;
    const selectedApps = allApps.filter(a => selectedAppIds.has(a.Id));
    const totalKb = selectedApps.reduce((acc, a) => acc + (a.EstimatedSizeKb || 0), 0);
    const sizeStr = totalKb > 0 ? formatSize(totalKb * 1024) : '0 MB';

    statSelectedCount.textContent = `${count} selecionado${count !== 1 ? 's' : ''} (~${sizeStr})`;

    const tableContainer = document.querySelector('.table-container');

    if (count === 0) {
        batchBar.classList.add('hidden');
        if (tableContainer) tableContainer.classList.remove('has-batch-bar');
        return;
    }

    batchBar.classList.remove('hidden');
    if (tableContainer) tableContainer.classList.add('has-batch-bar');

    const countStrong = document.getElementById('batchCountStrong');
    const sizeSpan = document.getElementById('batchSizeSpan');
    if (countStrong) countStrong.textContent = count;
    if (sizeSpan) sizeSpan.textContent = `(~${sizeStr})`;

    if (batchBadgeCount) batchBadgeCount.textContent = count;
    if (batchBarTitle) batchBarTitle.textContent = `${count} programa${count > 1 ? 's' : ''} na fila de remoção`;
    if (batchBarSubtitle) batchBarSubtitle.textContent = `Espaço total estimado a liberar: ~${sizeStr}`;

    btnStartBatch.innerHTML = `
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="5 3 19 12 5 21 5 3"/>
        </svg>
        <span>Desinstalar Fila (${count})</span>
    `;
}

// Modal de Confirmação Pré-Desinstalação em Fila (Safety Confirmation)
function openBatchConfirmModal() {
    const selectedApps = allApps.filter(a => selectedAppIds.has(a.Id));
    if (selectedApps.length === 0) {
        showToast('Nenhum programa selecionado. Marque os programas que deseja desinstalar na fila.', 'info');
        return;
    }
    const count = selectedApps.length;
    const totalKb = selectedApps.reduce((acc, a) => acc + (a.EstimatedSizeKb || 0), 0);
    const sizeStr = totalKb > 0 ? formatSize(totalKb * 1024) : '0 MB';

    document.getElementById('confirmBatchCount').textContent = count;
    document.getElementById('confirmBatchSize').textContent = sizeStr;

    const listContainer = document.getElementById('confirmBatchList');
    listContainer.innerHTML = '';

    selectedApps.forEach(app => {
        const item = document.createElement('div');
        item.className = 'batch-confirm-item';

        const iconHtml = app.IconBase64
            ? `<img src="data:image/png;base64,${app.IconBase64}" class="batch-confirm-app-icon" alt="">`
            : `<div class="app-icon-placeholder" style="width: 28px; height: 28px; font-size: 0.8rem;">${(app.DisplayName || '?')[0].toUpperCase()}</div>`;

        const appSize = (app.EstimatedSizeKb && app.EstimatedSizeKb > 0)
            ? formatSize(app.EstimatedSizeKb * 1024)
            : '--';

        item.innerHTML = `
            ${iconHtml}
            <div class="batch-confirm-app-details">
                <div class="batch-confirm-app-name">${escapeHtml(app.DisplayName)}</div>
                <div class="batch-confirm-app-meta">${escapeHtml(app.Publisher || 'Fabricante não informado')} • v${escapeHtml(app.DisplayVersion || 'N/A')}</div>
            </div>
            <div class="batch-confirm-app-size">${appSize}</div>
        `;
        listContainer.appendChild(item);
    });

    document.getElementById('batchConfirmModal').classList.remove('hidden');
}

// Execução da Fila em Lote (Batch Queue)
async function executeBatch() {
    const selectedApps = allApps.filter(a => selectedAppIds.has(a.Id));
    if (selectedApps.length === 0) return;

    // Prepara a UI do Modal da Fila
    batchModal.classList.remove('hidden');
    batchModalFooter.style.display = 'none';
    btnAbortBatch.disabled = false;
    btnAbortBatch.textContent = 'Interromper Fila';
    batchProgressBar.style.width = '0%';
    batchProgressLabel.textContent = `Progresso: 0 de ${selectedApps.length} (0%)`;
    batchCurrentAction.textContent = 'Preparando fila...';

    // Renderiza a lista de itens da fila
    batchQueueList.innerHTML = '';
    selectedApps.forEach((app, idx) => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'batch-queue-item';
        itemDiv.id = `queueItem_${idx}`;
        itemDiv.innerHTML = `
            <div>
                <div class="queue-app-title">${idx + 1}. ${escapeHtml(app.DisplayName)}</div>
                <div class="queue-app-sub">${escapeHtml(app.Publisher || 'Fabricante não informado')} - ${escapeHtml(app.InstallerType)}</div>
            </div>
            <span class="status-badge waiting" id="badge_${idx}">Aguardando</span>
        `;
        batchQueueList.appendChild(itemDiv);
    });

    const options = {
        silentMode: optSilent.checked,
        scanLeftovers: optScanLeftovers.checked,
        autoCleanLeftovers: optAutoClean.checked,
        createRestorePoint: optRestorePoint.checked,
        scanLevel: 'Moderate'
    };

    await window.api.startBatchUninstall(selectedApps, options);
}

// Listener de Status da Fila via IPC
function setupBatchListener() {
    window.api.onBatchStatus((data) => {
        if (data.type === 'status-update') {
            batchCurrentAction.textContent = data.message;
        } else if (data.type === 'app-start') {
            const idx = data.index;
            const total = data.total;
            const percent = Math.round((idx / total) * 100);

            batchProgressBar.style.width = `${percent}%`;
            batchProgressLabel.textContent = `Progresso: ${idx} de ${total} (${percent}%)`;
            const isOrphan = data.isOrphan || (data.app && data.app.IsOrphan);
            batchCurrentAction.textContent = isOrphan 
                ? `Removendo entrada órfã do Registro: ${data.app.DisplayName}` 
                : `Desinstalando: ${data.app.DisplayName}`;

            document.querySelectorAll('.batch-queue-item').forEach(el => el.classList.remove('active'));
            const currentItem = document.getElementById(`queueItem_${idx}`);
            if (currentItem) {
                currentItem.classList.add('active');
                currentItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }

            const badge = document.getElementById(`badge_${idx}`);
            if (badge) {
                badge.className = 'status-badge uninstalling';
                badge.textContent = isOrphan ? 'Removendo órfão...' : 'Desinstalando...';
            }
        } else if (data.type === 'app-scanning') {
            const idx = data.index;
            batchCurrentAction.textContent = `Varrendo sobras: ${data.app.DisplayName}`;
            const badge = document.getElementById(`badge_${idx}`);
            if (badge) {
                badge.className = 'status-badge scanning';
                badge.textContent = 'Varrendo sobras...';
            }
        } else if (data.type === 'app-cleaning') {
            const idx = data.index;
            batchCurrentAction.textContent = `Limpando sobras de ${data.app.DisplayName}`;
            const badge = document.getElementById(`badge_${idx}`);
            if (badge) {
                badge.className = 'status-badge cleaning';
                badge.textContent = 'Limpando sobras...';
            }
        } else if (data.type === 'app-done') {
            const idx = data.index;
            const badge = document.getElementById(`badge_${idx}`);
            const item = document.getElementById(`queueItem_${idx}`);
            if (item) item.classList.add('done');

            if (badge) {
                const s = data.summary;
                let text = 'Concluído';
                if (s.leftovers && s.leftovers.TotalFileSystemCount + s.leftovers.TotalRegistryCount > 0) {
                    text += ` (${s.leftovers.TotalRegistryCount} reg / ${s.leftovers.TotalFileSystemCount} pastas limpas)`;
                }
                badge.className = 'status-badge completed';
                badge.textContent = text;
            }
        } else if (data.type === 'batch-completed' || data.type === 'batch-cancelled') {
            batchProgressBar.style.width = '100%';
            batchProgressLabel.textContent = `Fila finalizada!`;
            batchCurrentAction.textContent = data.type === 'batch-cancelled' ? 'Fila interrompida pelo usuário.' : 'Todos os aplicativos da fila foram processados.';
            btnAbortBatch.style.display = 'none';
            batchModalFooter.style.display = 'flex';
            document.getElementById('batchSummaryText').textContent = data.type === 'batch-cancelled' 
                ? 'Operação interrompida. Os itens concluídos foram removidos com sucesso.' 
                : 'Sucesso! Todos os aplicativos selecionados foram removidos e o sistema foi limpo.';
        }
    });
}

// Desinstalação individual direta
async function singleUninstall(app) {
    if (app.IsOrphan) {
        const confirm = window.confirm(
            `Remover entrada órfã de "${app.DisplayName}" do Registro do Windows?\n\n` +
            `• Os arquivos do programa já foram excluídos do disco anteriormente.\n` +
            `• O Queu Uninstaller removerá com segurança a chave residual do Registro e atalhos mortos.`
        );
        if (!confirm) return;

        showToast(`Removendo entrada órfã de ${app.DisplayName}...`, 'info');
        const res = await window.api.runSingleUninstall(app, { silent: true });

        // Remove imediatamente da lista em memória e dos caches
        allApps = allApps.filter(a => a.Id !== app.Id);
        if (cachedPrograms) cachedPrograms = cachedPrograms.filter(a => a.Id !== app.Id);
        if (cachedWindowsApps) cachedWindowsApps = cachedWindowsApps.filter(a => a.Id !== app.Id);
        selectedAppIds.delete(app.Id);
        applyFiltersAndRender();

        showToast(`Entrada órfã de "${app.DisplayName}" removida com sucesso!`, 'success');
        return;
    }

    const confirm = window.confirm(`Deseja desinstalar "${app.DisplayName}" agora?\n\nApós o desinstalador, o Queu Uninstaller fará a varredura profunda de sobras no Registro e Pastas.`);
    if (!confirm) return;

    showToast(`Iniciando desinstalação de ${app.DisplayName}...`, 'info');
    const res = await window.api.runSingleUninstall(app, { silent: false });

    // Remove imediatamente da lista em memória para refletir a nova contagem e tamanho no rodapé
    allApps = allApps.filter(a => a.Id !== app.Id);
    if (cachedPrograms) cachedPrograms = cachedPrograms.filter(a => a.Id !== app.Id);
    if (cachedWindowsApps) cachedWindowsApps = cachedWindowsApps.filter(a => a.Id !== app.Id);
    selectedAppIds.delete(app.Id);
    applyFiltersAndRender();

    showToast(`Desinstalador finalizado. Varrendo sobras...`, 'info');
    inspectLeftovers(app);
}

// Inspeção e Varredura Manual de Sobras
async function inspectLeftovers(app) {
    currentLeftoverApp = app;
    leftoverModal.classList.remove('hidden');
    leftoverAppTitle.textContent = `Sobras de: ${app.DisplayName}`;
    leftoverAppSubtitle.textContent = 'Varrendo Registro do Windows e Sistema de Arquivos...';
    leftoverRegCount.textContent = '...';
    leftoverFileCount.textContent = '...';
    leftoverTotalSize.textContent = '...';
    leftoverRegList.innerHTML = '<div style="padding: 10px; color: var(--text-muted);">Examinando chaves e pastas...</div>';
    leftoverFileList.innerHTML = '<div style="padding: 10px; color: var(--text-muted);">Examinando diretórios residuais...</div>';

    const progressBox = document.getElementById('leftoverProgressBox');
    if (progressBox) progressBox.style.display = 'block';

    const anim = runIndeterminateLoading({
        containerElem: document.querySelector('#leftoverProgressBox .progress-bar-container'),
        barElem: document.getElementById('leftoverProgressBar'),
        percentElem: document.getElementById('leftoverPercentLabel'),
        labelElem: document.getElementById('leftoverStepLabel'),
        steps: [
            'Varrendo chaves e valores no Registro (HKCU/HKLM)...',
            'Verificando subchaves de fabricantes e App Paths...',
            'Buscando diretórios residuais em AppData e Program Files...',
            'Checando regras de Firewall e atalhos órfãos...',
            'Consolidando sobras encontradas...'
        ]
    });

    try {
        const result = await window.api.scanLeftovers(app, 'Moderate');
        await anim.finish();
        if (progressBox) progressBox.style.display = 'none';
        currentLeftovers = result;

        leftoverRegCount.textContent = result.TotalRegistryCount;
        leftoverFileCount.textContent = result.TotalFileSystemCount;
        leftoverTotalSize.textContent = formatSize(result.TotalSizeBytes || 0);
        let subtitleText = `Varredura concluída: ${result.TotalRegistryCount} chaves no registro e ${result.TotalFileSystemCount} pastas/atalhos encontrados.`;
        if (result.TotalFirewallCount > 0) {
            subtitleText += ` (${result.TotalFirewallCount} regras órfãs de firewall detectadas)`;
        }
        leftoverAppSubtitle.textContent = subtitleText;

        // Renderiza itens do Registro
        leftoverRegList.innerHTML = '';
        if (result.RegistryLeftovers.length === 0) {
            leftoverRegList.innerHTML = '<div style="padding: 10px; color: var(--text-muted);">Nenhuma chave residual detectada no registro.</div>';
        } else {
            result.RegistryLeftovers.forEach((reg, i) => {
                const div = document.createElement('div');
                div.className = 'leftover-item';
                div.innerHTML = `
                    <input type="checkbox" id="regCheck_${i}" checked>
                    <div class="leftover-item-details">
                        <div class="leftover-path">${escapeHtml(reg.KeyPath || reg.PSPath)}</div>
                        <div class="leftover-desc">${escapeHtml(reg.Description)} (${reg.SubKeyCount || 0} subchaves, ${reg.ValueCount || 0} valores)</div>
                    </div>
                `;
                leftoverRegList.appendChild(div);
            });
        }

        // Renderiza itens do Sistema de Arquivos
        leftoverFileList.innerHTML = '';
        if (result.FileSystemLeftovers.length === 0) {
            leftoverFileList.innerHTML = '<div style="padding: 10px; color: var(--text-muted);">Nenhum arquivo ou pasta residual detectada.</div>';
        } else {
            result.FileSystemLeftovers.forEach((file, i) => {
                const div = document.createElement('div');
                div.className = 'leftover-item';
                const fSize = file.SizeBytes ? formatSize(file.SizeBytes) : '';
                div.innerHTML = `
                    <input type="checkbox" id="fileCheck_${i}" checked>
                    <div class="leftover-item-details">
                        <div class="leftover-path">${escapeHtml(file.Path)}</div>
                        <div class="leftover-desc">${escapeHtml(file.Description)} ${fSize ? '• ' + fSize : ''}</div>
                    </div>
                `;
                leftoverFileList.appendChild(div);
            });
        }

        btnCleanSelectedLeftovers.disabled = (result.TotalRegistryCount === 0 && result.TotalFileSystemCount === 0);
    } catch (err) {
        leftoverAppSubtitle.textContent = `Erro ao varrer: ${err.message}`;
    }
}

// Excluir sobras selecionadas no modal
async function executeLeftoverClean() {
    if (!currentLeftovers) return;

    // Filtra itens que estão com checkbox marcado
    const regToClean = [];
    currentLeftovers.RegistryLeftovers.forEach((reg, i) => {
        const chk = document.getElementById(`regCheck_${i}`);
        if (chk && chk.checked) regToClean.push(reg);
    });

    const filesToClean = [];
    currentLeftovers.FileSystemLeftovers.forEach((file, i) => {
        const chk = document.getElementById(`fileCheck_${i}`);
        if (chk && chk.checked) filesToClean.push(file);
    });

    if (regToClean.length === 0 && filesToClean.length === 0) {
        showToast('Nenhum item selecionado para exclusão.', 'error');
        return;
    }

    btnCleanSelectedLeftovers.disabled = true;
    btnCleanSelectedLeftovers.textContent = 'Excluindo sobras...';

    const cleanPayload = {
        RegistryLeftovers: regToClean,
        FileSystemLeftovers: filesToClean,
        FirewallRulesLeftovers: currentLeftovers.FirewallRulesLeftovers || []
    };

    const res = await window.api.cleanLeftovers(cleanPayload);

    btnCleanSelectedLeftovers.textContent = 'Excluir Sobras Selecionadas';
    btnCleanSelectedLeftovers.disabled = false;

    if (res.Success) {
        showToast(`Limpeza concluída! ${res.RemovedRegistryCount} chaves e ${res.RemovedFilesCount} arquivos/pastas removidos com sucesso.`, 'success');
        leftoverModal.classList.add('hidden');
        loadApps();
    } else {
        showToast(`Erro na limpeza: ${(res.Errors || []).join(', ')}`, 'error');
    }
}

// Verificação e aplicação de atualizações do GitHub
async function checkAppUpdates(isManual = false) {
    if (!window.api || !window.api.checkForUpdates) return;
    
    if (isManual) {
        updateBtnText.textContent = 'Verificando...';
        showToast('Verificando atualizações no GitHub...', 'info');
    }

    try {
        const res = await window.api.checkForUpdates();
        updateBtnText.textContent = 'Versão do App';

        if (res.hasUpdate) {
            if (updateDot) updateDot.classList.remove('hidden');
            const vText = res.remoteVersion || 'Nova versão';
            btnCheckUpdate.title = `Nova versão ${vText} disponível no GitHub! Clique para atualizar.`;
            if (isManual) {
                const confirmUpdate = window.confirm(
                    `🚀 Nova atualização disponível no GitHub!\n\nVersão mais recente: ${vText}\nSua versão atual: v${res.currentVersion}\n\nDeseja baixar e aplicar a atualização agora?`
                );
                if (confirmUpdate) {
                    applyAppUpdate();
                }
            } else {
                showToast(`Nova versão disponível (${vText})! Clique em "Versão do App" no topo para aplicar.`, 'info');
            }
        } else {
            if (updateDot) updateDot.classList.add('hidden');
            btnCheckUpdate.title = `Queu Uninstaller v${res.currentVersion} (Versão mais recente)`;
            if (isManual) {
                showToast(`O Queu Uninstaller já está na versão mais recente (v${res.currentVersion})!`, 'success');
            }
        }
    } catch (e) {
        updateBtnText.textContent = 'Versão do App';
        if (isManual) showToast(`Erro ao checar atualizações: ${e.message}`, 'error');
    }
}

async function applyAppUpdate() {
    updateBtnText.textContent = 'Atualizando...';
    showToast('Baixando nova versão do instalador... Aguarde.', 'info');
    try {
        const res = await window.api.applyUpdate();
        if (res.success) {
            showToast(res.message || 'Instalador iniciado! Conclua o assistente para atualizar.', 'success');
            updateBtnText.textContent = 'Versão do App';
        } else {
            showToast(`Falha ao atualizar: ${res.message}`, 'error');
            updateBtnText.textContent = 'Versão do App';
        }
    } catch (e) {
        showToast(`Erro na atualização: ${e.message}`, 'error');
        updateBtnText.textContent = 'Versão do App';
    }
}
function formatSize(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatDate(raw) {
    if (!raw || raw.length < 8) return '--';
    // Format YYYYMMDD -> DD/MM/YYYY
    const y = raw.substring(0, 4);
    const m = raw.substring(4, 6);
    const d = raw.substring(6, 8);
    return `${d}/${m}/${y}`;
}

function getBadgeClass(type) {
    switch (type) {
        case 'InnoSetup': return 'badge-inno';
        case 'MSI': return 'badge-msi';
        case 'NSIS': return 'badge-nsis';
        default: return 'badge-generic';
    }
}

function updateSortIcons() {
    document.querySelectorAll('th.sortable').forEach(th => {
        const icon = th.querySelector('.sort-icon');
        if (th.dataset.sort === currentSort.column) {
            icon.textContent = currentSort.asc ? '▲' : '▼';
            icon.style.opacity = '1';
        } else {
            icon.textContent = '↕';
            icon.style.opacity = '0.4';
        }
    });
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <span>${escapeHtml(message)}</span>
    `;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(15px)';
        setTimeout(() => toast.remove(), 250);
    }, 4000);
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// ==============================================================================
// Módulo de Varredura de Resíduos Órfãos (Standalone Residual Scanner)
// ==============================================================================
let orphanItems = [];
let currentOrphanFilter = 'all';

function openOrphanModal() {
    document.getElementById('orphanModal').classList.remove('hidden');
    if (orphanItems.length === 0) {
        runOrphanScan();
    }
}

function closeOrphanModal() {
    document.getElementById('orphanModal').classList.add('hidden');
}

async function runOrphanScan() {
    const loading = document.getElementById('orphanScanLoading');
    const listContainer = document.getElementById('orphanListContainer');
    const btnClean = document.getElementById('btnCleanSelectedOrphans');
    const statusText = document.getElementById('orphanStatusText');

    loading.classList.remove('hidden');
    listContainer.innerHTML = '';
    btnClean.disabled = true;
    statusText.textContent = 'Verificando resíduos órfãos...';

    const anim = runIndeterminateLoading({
        containerElem: document.querySelector('#orphanScanLoading .progress-bar-container'),
        barElem: document.getElementById('orphanProgressBar'),
        percentElem: document.getElementById('orphanPercentLabel'),
        labelElem: document.getElementById('orphanStepLabel'),
        steps: [
            'Mapeando programas atualmente instalados...',
            'Varrendo chaves órfãs no Registro (HKCU/HKLM)...',
            'Examinando entradas desativadas em App Paths...',
            'Localizando diretórios abandonados em AppData e Program Files...',
            'Classificando níveis de segurança (Seguro / Revisão)...'
        ]
    });

    try {
        const result = await window.api.scanOrphans();
        await anim.finish();
        orphanItems = result.Items || [];
        updateOrphanStats(result);
        renderOrphanItems();
        statusText.textContent = `Varredura concluída (${orphanItems.length} resíduos encontrados)`;
    } catch (e) {
        anim.stop();
        listContainer.innerHTML = `
            <div style="text-align: center; color: var(--accent-red); padding: 30px;">
                Erro ao varrer resíduos órfãos: ${escapeHtml(e.message)}
            </div>
        `;
        statusText.textContent = 'Erro na varredura';
    } finally {
        loading.classList.add('hidden');
    }
}

function updateOrphanStats(res) {
    const totalCount = res.TotalCount !== undefined ? res.TotalCount : orphanItems.length;
    const totalBytes = res.TotalSizeBytes !== undefined ? res.TotalSizeBytes : orphanItems.reduce((acc, i) => acc + (i.SizeBytes || 0), 0);
    const safeCount = res.SafeCount !== undefined ? res.SafeCount : orphanItems.filter(i => i.Risk === 'Safe').length;
    const reviewCount = res.ReviewCount !== undefined ? res.ReviewCount : orphanItems.filter(i => i.Risk === 'Review').length;

    document.getElementById('orphanFoundCount').textContent = totalCount;
    document.getElementById('orphanFoundSize').textContent = formatSize(totalBytes);
    document.getElementById('orphanSafeCount').textContent = safeCount;
    document.getElementById('orphanReviewCount').textContent = reviewCount;
}

function formatCleanOrphanPath(rawPath) {
    if (!rawPath) return '';
    return rawPath
        .replace(/Microsoft\.PowerShell\.Core\\Registry::/gi, '')
        .replace(/^HKEY_CURRENT_USER\\?/i, 'HKCU\\')
        .replace(/^HKEY_LOCAL_MACHINE\\?/i, 'HKLM\\');
}

function getOrphanTypeIcon(item) {
    const p = (item.Path || '').toLowerCase();
    const t = (item.Type || '').toLowerCase();
    if (t === 'apppath' || p.includes('app paths') || p.endsWith('.exe')) {
        return { icon: '⚡', title: 'Caminho de Executável (App Paths)' };
    }
    if (t === 'residualfolder' || p.startsWith('c:\\') || p.startsWith('\\\\')) {
        return { icon: '📁', title: 'Pasta Residual no Disco' };
    }
    return { icon: '🗝️', title: 'Chave Residual do Registro' };
}

function renderOrphanItems() {
    const listContainer = document.getElementById('orphanListContainer');
    listContainer.innerHTML = '';

    const filtered = orphanItems.filter(item => {
        if (currentOrphanFilter === 'safe') return item.Risk === 'Safe';
        if (currentOrphanFilter === 'review') return item.Risk === 'Review';
        return true;
    });

    const headerCheck = document.getElementById('checkOrphanHeaderAll');
    if (headerCheck) {
        headerCheck.checked = filtered.length > 0 && filtered.every(i => i.Selected);
    }

    if (filtered.length === 0) {
        listContainer.innerHTML = `
            <div style="text-align: center; color: var(--text-muted); padding: 40px 20px;">
                ${orphanItems.length === 0 ? 'Nenhum resíduo órfão encontrado no sistema. O computador está limpo!' : 'Nenhum item encontrado nesta categoria.'}
            </div>
        `;
        updateCleanButtonState();
        return;
    }

    const fragment = document.createDocumentFragment();

    filtered.forEach(item => {
        const row = document.createElement('div');
        row.className = `orphan-compact-row ${item.Selected ? 'selected' : ''}`;

        const isSafe = item.Risk === 'Safe';
        const badgeHtml = isSafe 
            ? `<span class="orphan-badge-safe">🟢 Seguro</span>`
            : `<span class="orphan-badge-review">🟡 Revisar</span>`;
        const sizeStr = item.SizeBytes > 0 ? formatSize(item.SizeBytes) : '--';
        const cleanPath = formatCleanOrphanPath(item.Path);
        const typeInfo = getOrphanTypeIcon(item);

        row.innerHTML = `
            <div class="orphan-col-check">
                <input type="checkbox" data-id="${item.Id}" ${item.Selected ? 'checked' : ''}>
            </div>
            <div class="orphan-col-icon" title="${typeInfo.title}">${typeInfo.icon}</div>
            <div class="orphan-col-name" title="${escapeHtml(item.Name)} (${escapeHtml(item.Reason || '')})">${escapeHtml(item.Name)}</div>
            <div class="orphan-col-status">${badgeHtml}</div>
            <div class="orphan-col-path" title="${escapeHtml(cleanPath)}">${escapeHtml(cleanPath)}</div>
            <div class="orphan-col-size">${sizeStr}</div>
        `;

        const chk = row.querySelector('input[type="checkbox"]');
        chk.addEventListener('change', (e) => {
            item.Selected = e.target.checked;
            row.classList.toggle('selected', item.Selected);
            updateCleanButtonState();
            if (headerCheck) {
                headerCheck.checked = filtered.every(i => i.Selected);
            }
        });

        row.addEventListener('click', (e) => {
            if (e.target.tagName !== 'INPUT') {
                chk.checked = !chk.checked;
                item.Selected = chk.checked;
                row.classList.toggle('selected', item.Selected);
                updateCleanButtonState();
                if (headerCheck) {
                    headerCheck.checked = filtered.every(i => i.Selected);
                }
            }
        });

        fragment.appendChild(row);
    });

    listContainer.appendChild(fragment);
    updateCleanButtonState();
}

function updateCleanButtonState() {
    const selectedCount = orphanItems.filter(i => i.Selected).length;
    const btnClean = document.getElementById('btnCleanSelectedOrphans');
    btnClean.disabled = selectedCount === 0;
    btnClean.innerHTML = `
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
        </svg>
        Excluir Resíduos Selecionados (${selectedCount})
    `;
}

function setOrphanSelection(mode) {
    orphanItems.forEach(item => {
        if (mode === 'all') item.Selected = true;
        else if (mode === 'none') item.Selected = false;
        else if (mode === 'safe') item.Selected = (item.Risk === 'Safe');
    });
    renderOrphanItems();
}

async function cleanSelectedOrphans() {
    const selected = orphanItems.filter(i => i.Selected);
    if (selected.length === 0) return;

    const confirm = window.confirm(
        `Deseja realmente excluir ${selected.length} resíduos órfãos selecionados?\n\n` +
        `• Um Ponto de Restauração será criado preventivamente no Windows.\n` +
        `• Arquivos e pastas serão enviados para a Lixeira do Windows.`
    );
    if (!confirm) return;

    const btnClean = document.getElementById('btnCleanSelectedOrphans');
    btnClean.disabled = true;
    btnClean.textContent = 'Limpando com segurança...';
    showToast('Iniciando limpeza de resíduos órfãos...', 'info');

    try {
        const result = await window.api.cleanOrphans(selected);
        if (result.Success && result.RemovedCount > 0) {
            const freed = result.RemovedBytes > 0 ? ` (~${formatSize(result.RemovedBytes)} liberados)` : '';
            showToast(`${result.RemovedCount} resíduos limpos com sucesso!${freed}`, 'success');
            await runOrphanScan();
        } else if (result.Errors && result.Errors.length > 0) {
            showToast(result.Errors[0], 'error');
            await runOrphanScan();
        } else {
            showToast('Nenhum resíduo pôde ser removido.', 'warning');
            await runOrphanScan();
        }
    } catch (e) {
        showToast(`Erro na limpeza: ${e.message}`, 'error');
    } finally {
        updateCleanButtonState();
    }
}
