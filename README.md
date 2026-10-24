# RevoQueue Uninstaller (Clone do Revo Uninstaller com Fila / Lote)

Ferramenta desenvolvida para Windows inspirada no **Revo Uninstaller Pro** e **Bulk Crap Uninstaller**, projetada especificamente para desinstalar múltiplos programas sequencialmente em fila (modo lote/batch) e realizar a varredura profunda de sobras no Registro e Disco.

---

## 🚀 Principais Funcionalidades

1. **Fila de Desinstalação em Lote (Batch Uninstall Queue)**:
   - Permite selecionar quantos programas quiser com caixas de seleção (*checkboxes*).
   - Executa a desinstalação sequencialmente (um após o outro) para evitar erros do Windows Installer (*"Another installation is in progress"*).
   - Suporte a **Modo Silencioso Automático** (`/qn`, `/SILENT`, `/VERYSILENT`, `/S`, etc.) para remover aplicativos sem necessidade de clicar manualmente em telas de assistentes.

2. **Varredura e Limpeza Profunda de Sobras (Deep Leftover Cleaner)**:
   - Idêntico ao diferencial clássico do Revo Uninstaller:
     - **Registro do Windows**: Varre chaves em `HKLM\Software`, `HKCU\Software`, `HKLM\Software\Wow6432Node` e entradas residuais de desinstalação.
     - **Sistema de Arquivos**: Localiza pastas residuais em `Program Files`, `Program Files (x86)`, `ProgramData`, `%APPDATA%`, `%LOCALAPPDATA%` e atalhos na Área de Trabalho e Menu Iniciar.
   - Opção de **Limpeza Automática** na fila ou **Inspeção Manual** com árvore detalhada antes de apagar.

3. **Ponto de Restauração do Windows**:
   - Criação integrada de Pontos de Restauração do Sistema antes de iniciar a desinstalação em lote.

4. **Busca Instantânea & Filtros Inteligentes**:
   - Filtre instantaneamente por nome, fabricante ou versão (`Ctrl+F`).
   - Filtros rápidos para programas pesados (> 500 MB), instalados recentemente ou com suporte a desinstalação silenciosa.

---

## 🖥️ Como Iniciar a Aplicação

Basta dar dois cliques no arquivo:
```bat
Iniciar_Desinstalador.bat
```
Ou pelo terminal:
```bash
npm start
```

---

## 📁 Estrutura do Projeto

- `main.js`: Processo principal do Electron com orquestrador de fila IPC.
- `preload.js`: Bridge segura de comunicação com a interface.
- `core/`:
  - `inventory.js`: Coleta programas instalados via Registro do Windows.
  - `uninstaller.js`: Disparador de desinstaladores com detecção silenciosa.
  - `leftovers.js`: Motor de busca e limpeza de sobras no Registro e Disco.
  - `restore.js`: Gerenciador de Ponto de Restauração.
- `src/`:
  - `index.html`: Interface visual moderna estilo Windows 11 / Revo Pro.
  - `css/style.css`: Tema escuro elegante com animações e responsividade.
  - `js/app.js`: Lógica de seleção múltipla, estatísticas, modais e barra de progresso.
