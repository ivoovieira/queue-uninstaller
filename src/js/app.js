// Configura adaptador universal para rodar nativo no Electron ou via Web App
const API_BASE = window.location.protocol.startsWith('http') ? '' : 'http://localhost:38456';

if (!window.api || !window.api.getInstalledApps) {
    let batchListeners = [];
    try {
        const evtSource = new EventSource(`${API_BASE}/api/events`);
        evtSource.onmessage = (e) => {
            try {
                const data = JSON.parse(e.data);
                batchListeners.forEach(cb => cb(data));
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
        checkForUpdates: () => fetch(`${API_BASE}/api/check-update`).then(r => r.json()),
        applyUpdate: () => fetch(`${API_BASE}/api/apply-update`, { method: 'POST' }).then(r => r.json()),
        openFolder: () => {},
        onBatchStatus: (cb) => {
            batchListeners.push(cb);
            return () => { batchListeners = batchListeners.filter(l => l !== cb); };
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

// Elementos da UI
const appsTable = document.getElementById('appsTable');
const appsTableBody = document.getElementById('appsTableBody');
const loadingState = document.getElementById('loadingState');
const emptyState = document.getElementById('emptyState');
const searchInput = document.getElementById('searchInput');
const btnClearSearch = document.getElementById('btnClearSearch');
const checkSelectAllHeader = document.getElementById('checkSelectAllHeader');

// Estatísticas
const statTotalApps = document.getElementById('statTotalApps');
const statTotalSize = document.getElementById('statTotalSize');
const statSelectedCount = document.getElementById('statSelectedCount');

// Barra Flutuante de Fila
const batchBar = document.getElementById('batchBar');
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
const badgeUpdate = document.getElementById('badgeUpdate');
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
    document.getElementById('btnRefresh').addEventListener('click', loadApps);

    // Abas do Ribbon
    const tabPrograms = document.getElementById('tabPrograms');
    const tabWindowsApps = document.getElementById('tabWindowsApps');

    tabPrograms.addEventListener('click', () => {
        tabPrograms.classList.add('active');
        tabWindowsApps.classList.remove('active');
        loadApps();
    });

    tabWindowsApps.addEventListener('click', async () => {
        tabWindowsApps.classList.add('active');
        tabPrograms.classList.remove('active');
        loadWindowsApps();
    });

    // Botão Desinstalar Fila no Header
    document.getElementById('btnHeaderBatch').addEventListener('click', () => {
        if (selectedAppIds.size === 0) {
            showToast('Nenhum programa selecionado. Marque os programas que deseja desinstalar na fila.', 'info');
            return;
        }
        executeBatch();
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
    btnStartBatch.addEventListener('click', executeBatch);
    btnAbortBatch.addEventListener('click', async () => {
        btnAbortBatch.disabled = true;
        btnAbortBatch.textContent = 'Cancelando...';
        await window.api.cancelBatch();
    });

    btnCloseBatchModal.addEventListener('click', () => {
        batchModal.classList.add('hidden');
        deselectAll();
        loadApps();
    });

    // Modal de Sobras
    document.getElementById('btnCloseLeftoverModal').addEventListener('click', () => {
        leftoverModal.classList.add('hidden');
    });
    document.getElementById('btnCancelLeftover').addEventListener('click', () => {
        leftoverModal.classList.add('hidden');
    });
    btnCleanSelectedLeftovers.addEventListener('click', executeLeftoverClean);
}

async function loadWindowsApps() {
    loadingState.classList.remove('hidden');
    appsTable.classList.add('hidden');
    emptyState.classList.add('hidden');
    statTotalApps.textContent = 'Buscando Windows Apps...';

    try {
        allApps = await window.api.getWindowsApps();
        statTotalApps.textContent = `${allApps.length} apps da Store`;
        statTotalSize.textContent = '--';
        loadingState.classList.add('hidden');
        appsTable.classList.remove('hidden');
        applyFiltersAndRender();
    } catch (err) {
        loadingState.innerHTML = `
            <div style="color: var(--accent-red); font-size: 2rem;">⚠️</div>
            <h3>Erro ao obter aplicativos da Store</h3>
            <p>${err.message}</p>
            <button class="btn btn-secondary" onclick="loadWindowsApps()">Tentar Novamente</button>
        `;
    }
}

// Carregar inventário de programas
async function loadApps(retryCount = 0) {
    loadingState.classList.remove('hidden');
    appsTable.classList.add('hidden');
    emptyState.classList.add('hidden');
    statTotalApps.textContent = 'Examinando...';

    try {
        allApps = await window.api.getInstalledApps();
        
        statTotalApps.textContent = `${allApps.length} programas`;
        const totalKb = allApps.reduce((acc, app) => acc + (app.EstimatedSizeKb || 0), 0);
        statTotalSize.textContent = formatSize(totalKb * 1024);

        loadingState.classList.add('hidden');
        appsTable.classList.remove('hidden');

        applyFiltersAndRender();
    } catch (err) {
        if (retryCount < 2) {
            console.log('Tentando reconectar em 1 segundo...');
            setTimeout(() => loadApps(retryCount + 1), 1000);
            return;
        }

        loadingState.innerHTML = `
            <div style="color: var(--accent-red); font-size: 2rem;">⚠️</div>
            <h3>Erro ao obter lista de programas</h3>
            <p>${err.message}</p>
            <button class="btn btn-secondary" onclick="loadApps(0)">Tentar Novamente</button>
        `;
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

        const iconHtml = app.IconBase64 
            ? `<img src="${app.IconBase64}" class="app-icon-img" alt="${escapeHtml(app.DisplayName)}" onerror="this.outerHTML='<div class=\\'app-icon-fallback\\'>${initialLetter}</div>'">`
            : `<div class="app-icon-fallback">${initialLetter}</div>`;

        const webSiteHtml = app.WebSite 
            ? ` <a href="${escapeHtml(app.WebSite)}" target="_blank" class="publisher-link" title="Visitar site: ${escapeHtml(app.WebSite)}" onclick="event.stopPropagation()">🌐</a>` 
            : '';

        tr.innerHTML = `
            <td class="text-center">
                <input type="checkbox" class="row-check" data-id="${escapeHtml(app.Id)}" ${isSelected ? 'checked' : ''}>
            </td>
            <td>
                <div class="app-info-cell">
                    ${iconHtml}
                    <div class="app-names">
                        <span class="app-display-name">${escapeHtml(app.DisplayName)}</span>
                    </div>
                </div>
            </td>
            <td><b>${sizeFormatted}</b></td>
            <td>${escapeHtml(app.DisplayVersion || '--')}</td>
            <td><span class="badge-arch ${archBadge}">${escapeHtml(app.Architecture || '64-bit')}</span></td>
            <td>${dateFormatted}</td>
            <td>${escapeHtml(app.Publisher || 'Não informado')}${webSiteHtml}</td>
            <td>
                <div class="row-actions">
                    <button class="btn-icon-action" data-action="scan" data-id="${escapeHtml(app.Id)}" title="Varrer sobras no Registro e Disco">
                        🔍 Sobras
                    </button>
                    <button class="btn-icon-action danger" data-action="uninstall" data-id="${escapeHtml(app.Id)}" title="Desinstalar este programa">
                        🗑️ Desinstalar
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

        // Ações individuais
        const btnScan = tr.querySelector('[data-action="scan"]');
        btnScan.addEventListener('click', (e) => {
            e.stopPropagation();
            inspectLeftovers(app);
        });

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
}

function updateBatchBar() {
    const count = selectedAppIds.size;
    const selectedApps = allApps.filter(a => selectedAppIds.has(a.Id));
    const totalKb = selectedApps.reduce((acc, a) => acc + (a.EstimatedSizeKb || 0), 0);
    const sizeStr = totalKb > 0 ? formatSize(totalKb * 1024) : '0 MB';

    statSelectedCount.textContent = `${count} selecionado${count !== 1 ? 's' : ''} (~${sizeStr})`;

    if (count === 0) {
        batchBar.classList.add('hidden');
        return;
    }

    batchBar.classList.remove('hidden');
    batchBadgeCount.textContent = count;
    batchBarTitle.textContent = `${count} programa${count > 1 ? 's' : ''} na fila de remoção`;
    batchBarSubtitle.textContent = `Espaço total estimado a liberar: ~${sizeStr}`;
    btnStartBatch.innerHTML = `
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="5 3 19 12 5 21 5 3"/>
        </svg>
        Desinstalar Fila (${count})
    `;
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
            batchCurrentAction.textContent = `Desinstalando: ${data.app.DisplayName}`;

            document.querySelectorAll('.batch-queue-item').forEach(el => el.classList.remove('active'));
            const currentItem = document.getElementById(`queueItem_${idx}`);
            if (currentItem) {
                currentItem.classList.add('active');
                currentItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }

            const badge = document.getElementById(`badge_${idx}`);
            if (badge) {
                badge.className = 'status-badge uninstalling';
                badge.textContent = 'Desinstalando...';
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
    const confirm = window.confirm(`Deseja desinstalar "${app.DisplayName}" agora?\n\nApós o desinstalador, o Queu Uninstaller fará a varredura profunda de sobras no Registro e Pastas.`);
    if (!confirm) return;

    showToast(`Iniciando desinstalação de ${app.DisplayName}...`, 'info');
    const res = await window.api.runSingleUninstall(app, { silent: false });

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

    try {
        const result = await window.api.scanLeftovers(app, 'Moderate');
        currentLeftovers = result;

        leftoverRegCount.textContent = result.TotalRegistryCount;
        leftoverFileCount.textContent = result.TotalFileSystemCount;
        leftoverTotalSize.textContent = formatSize(result.TotalSizeBytes || 0);
        leftoverAppSubtitle.textContent = `Varredura concluída: ${result.TotalRegistryCount} chaves no registro e ${result.TotalFileSystemCount} pastas/atalhos encontrados.`;

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
        FileSystemLeftovers: filesToClean
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
        updateBtnText.textContent = 'Atualizações';

        if (res.hasUpdate) {
            badgeUpdate.classList.remove('hidden');
            if (isManual) {
                const confirmUpdate = window.confirm(
                    `🚀 Nova atualização disponível no GitHub!\nVersão remota: commit ${res.remoteCommit} (atual: ${res.localCommit})\n\nDeseja baixar e aplicar a atualização agora?`
                );
                if (confirmUpdate) {
                    applyAppUpdate();
                }
            } else {
                showToast(`Nova atualização disponível (${res.remoteCommit})! Clique em "Atualizações" no topo para aplicar.`, 'info');
            }
        } else {
            badgeUpdate.classList.add('hidden');
            if (isManual) {
                showToast('O Queu Uninstaller já está na versão mais recente!', 'success');
            }
        }
    } catch (e) {
        updateBtnText.textContent = 'Atualizações';
        if (isManual) showToast(`Erro ao checar atualizações: ${e.message}`, 'error');
    }
}

async function applyAppUpdate() {
    updateBtnText.textContent = 'Atualizando...';
    showToast('Baixando atualização do GitHub... Aguarde.', 'info');
    try {
        const res = await window.api.applyUpdate();
        if (res.success) {
            showToast('Atualizado com sucesso! Reiniciando em instantes...', 'success');
            setTimeout(() => {
                window.location.reload();
            }, 1800);
        } else {
            showToast(`Falha ao atualizar: ${res.message}`, 'error');
            updateBtnText.textContent = 'Atualizações';
        }
    } catch (e) {
        showToast(`Erro na atualização: ${e.message}`, 'error');
        updateBtnText.textContent = 'Atualizações';
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
        toast.style.transform = 'translateX(100%)';
        setTimeout(() => toast.remove(), 300);
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
